/* Address lookup tables for the launch create transaction.
 *
 * A create that carries the dev buy AND the first bundle wallets' buys (prepareLaunch `inlineMax`) only fits in 1232
 * bytes with lookup tables — measured on KUDOS-sized metadata: no table = dev buy only, static table = +1 wallet,
 * static + per-launch table = +3 wallets.
 *  - static table: the pump.fun programs, PDAs and fee recipients — created once (≈0.008 SOL rent, paid by the dev
 *    of the first launch that needs it), address kept in alt.json, re-created only when pump.fun's fee recipient list
 *    no longer matches it;
 *  - per-launch table: the curve, its token account, the creator vault and the ATA + volume account of the dev and of
 *    each inline wallet (≈0.004 SOL rent), deactivated once the launch settled and closed ~513 slots later: the rent
 *    goes back to the dev.
 * Everything here is best effort: no table → prepareLaunch keeps what fits (the dev buy alone at worst).
 *
 * 2026-10-06 (Cghynn…pump): both tables were created IN PARALLEL by the same dev — a table address is derived from
 * (authority, recent slot), so they got the same address, the launch then deactivated the "static" one. Every table
 * creation of one authority is now serialized (`withAuthority`) and never reuses a recent slot; a launch never
 * deactivates the static table.
 *
 * 2026-10-06 (BkzF3c…, Cghynn…): A TABLE IS ONLY USABLE ONCE ITS LAST EXTEND IS ROOTED (finalized). Leaders resolve
 * lookup tables against their root bank, ~32 slots (~13 s) behind the tip: both creates landed 34 and 37 slots after
 * their table's extend while every other transaction of the same wallets (no table) landed 4–10 slots after its
 * blockhash; processed − finalized was 33 slots. Waiting for a CONFIRMED slot past the extend (the old rule) only
 * moved the wait from before the send to after it. Hence:
 *  - a table is "ready" when getAddressLookupTable at commitment FINALIZED returns every address;
 *  - the per-launch table is built AHEAD of the click (`warmLaunchTable`: from the draft once its mint, dev and bundle
 *    wallets are known, and from /api/launch/prepare) so it is already rooted when Launch is clicked;
 *  - a launch never builds a table itself: a table started at click time would hold the create ~13 s. Proven on
 *    devnet by scripts/prove-alt-root-devnet.mjs. */
import { AddressLookupTableProgram, ComputeBudgetProgram, Connection as RawConnection, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type Connection, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { join } from "node:path";
import { ensureAlt } from "@/engine/solana/alt.js";
import { latestBlockhash, sendAndConfirm } from "@/engine/solana/send.js";
import { associatedTokenAddress, bondingCurvePda, bondingCurveV2Pda, creatorVaultPda, TOKEN_2022_PROGRAM, userVolumePda } from "@/engine/solana/pump/pdas.js";
import { isDevnet, readJson, store, writeJson } from "./store";

/** `holdUntil`: a table built ahead of a launch is not deactivated by the sweeper before this time (it may still be used) */
type LaunchTable = { address: string; authority: string; createdAt: number; deactivatedAt?: number; holdUntil?: number; mint?: string; cluster?: "devnet" };
/** `static` = mainnet; devnet keeps its own (a devnet session must never overwrite nor sweep the mainnet tables) */
type AltFile = { static: string | null; staticDevnet?: string | null; launches: LaunchTable[] };

const file = () => join(store().dir, "alt.json");
const load = (): AltFile => ({ static: null, launches: [], ...readJson<Partial<AltFile>>(file(), {}) });
const save = (f: AltFile) => writeJson(file(), f);
const devnet = () => isDevnet(store().settings);
const staticAddr = (): string | null => (devnet() ? (load().staticDevnet ?? null) : load().static);
const setStatic = (address: string) => save(devnet() ? { ...load(), staticDevnet: address } : { ...load(), static: address });
const onThisCluster = (r: LaunchTable) => (r.cluster === "devnet") === devnet();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** a warm table stays usable (not swept, not rebuilt) this long after its creation */
const WARM_HOLD_MS = 30 * 60_000;
/** ~400 ms per slot: a table's root ETA = (lastExtendedSlot − finalized slot + 1) slots */
const SLOT_MS = 400;

/** a connection without the queue's micro-cache (a table must be read fresh right after its extend) */
function fresh(): Connection {
  const url = store().sol.config.rpcUrl?.trim() || "https://api.mainnet-beta.solana.com";
  return new RawConnection(url, "confirmed");
}

/** the table as the leaders see it: read at commitment FINALIZED (null = absent or not rooted yet) */
async function rootedTable(conn: Connection, key: PublicKey): Promise<AddressLookupTableAccount | null> {
  return (await conn.getAddressLookupTable(key, { commitment: "finalized" }).catch(() => null))?.value ?? null;
}

type Glob = {
  __trenchStaticAlt?: Promise<void> | null;
  __trenchStaticCache?: { address: string; table: AddressLookupTableAccount; at: number } | null;
  __trenchAltLocks?: Map<string, Promise<unknown>>;
  __trenchAltSlots?: Map<string, number>;
  __trenchWarmAlt?: Map<string, WarmTable>;
};
const g = globalThis as unknown as Glob;

/** the static pump.fun table when it exists, is ACTIVE and ROOTED — never created here (a launch must not wait for it).
 *  Its addresses never change once built: kept in memory 10 min (one RPC read saved on the click path) */
export async function staticLookupTable(): Promise<AddressLookupTableAccount | null> {
  const addr = staticAddr();
  if (!addr) return null;
  const c = g.__trenchStaticCache;
  if (c && c.address === addr && Date.now() - c.at < 10 * 60_000) return c.table;
  try {
    const t = await rootedTable(fresh(), new PublicKey(addr));
    if (!t || !t.isActive()) return null;
    g.__trenchStaticCache = { address: addr, table: t, at: Date.now() };
    return t;
  } catch {
    return null;
  }
}

/** every table creation of one authority runs alone (two tables of the same authority in the same recent slot share
 *  one address: the second creation fails or, worse, was mistaken for the first) */
function withAuthority<T>(authority: PublicKey, fn: () => Promise<T>): Promise<T> {
  const locks = (g.__trenchAltLocks ??= new Map());
  const k = authority.toBase58();
  const prev = locks.get(k) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(
    k,
    run.catch(() => undefined),
  );
  return run;
}

/** a finalized slot this authority never used as a table's recent slot */
async function freshRecentSlot(conn: Connection, authority: PublicKey): Promise<number> {
  const used = (g.__trenchAltSlots ??= new Map());
  const k = authority.toBase58();
  for (let i = 0; i < 20; i++) {
    const s = await conn.getSlot("finalized");
    if (s > (used.get(k) ?? 0)) {
      used.set(k, s);
      return s;
    }
    await sleep(200);
  }
  throw new Error("finalized slot did not advance");
}

/** create (or re-create) the static table in the background, once at a time, serialized with this authority's other
 *  table creations */
export function ensureStaticLookupTable(conn: Connection, payer: Keypair): void {
  if (g.__trenchStaticAlt) return;
  g.__trenchStaticAlt = withAuthority(payer.publicKey, async () => {
    if (await staticLookupTable()) return;
    // ensureAlt re-uses a usable table (one created moments ago, not rooted yet) or creates one
    const r = await ensureAlt(conn, payer, staticAddr()).catch(() => null);
    if (r) setStatic(r.address);
    // its recent slot was the finalized slot of that moment: the next table of this authority takes a later one
    await freshRecentSlot(conn, payer.publicKey).catch(() => 0);
  })
    .catch(() => undefined)
    .finally(() => {
      g.__trenchStaticAlt = null;
    });
}

/** true while the static table is being created */
export function staticLookupTableBusy(): Promise<void> | null {
  return g.__trenchStaticAlt ?? null;
}

/** the accounts of one launch the create transaction touches, apart from the signers (signers cannot sit in a table) */
export function launchTableAddresses(mint: PublicKey, dev: PublicKey, buyers: PublicKey[]): PublicKey[] {
  const tp = new PublicKey(TOKEN_2022_PROGRAM);
  const curve = bondingCurvePda(mint);
  return [curve, associatedTokenAddress(curve, mint, tp), creatorVaultPda(dev), bondingCurveV2Pda(mint), ...[dev, ...buyers].flatMap((u) => [associatedTokenAddress(u, mint, tp), userVolumePda(u)])];
}

async function sendIxs(conn: Connection, payer: Keypair, ixs: TransactionInstruction[]): Promise<boolean> {
  const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }), ...ixs] }).compileToV0Message());
  tx.sign([payer]);
  const r = await sendAndConfirm(conn, conn, tx, { lastValidBlockHeight, timeoutMs: 30_000, pollMs: 300, pollGrowth: 1.15 });
  return r.confirmed;
}

/* ------------------------------------------------------------------ per-launch table, built ahead of the click */

export type WarmTable = {
  mint: string;
  dev: string;
  buyers: string[];
  address: string | null;
  /** slot of the extend once it landed: the table is usable once the finalized slot reaches it */
  extendSlot: number | null;
  startedAt: number;
  /** when the table was seen at commitment finalized (ready for the leaders) */
  readyAt: number | null;
  table: AddressLookupTableAccount | null;
  failed: string | null;
  /** a launch took it: not handed to another one */
  taken: boolean;
  done: Promise<AddressLookupTableAccount | null>;
};

function warmMap(): Map<string, WarmTable> {
  return (g.__trenchWarmAlt ??= new Map());
}

/** create + fill a table in ONE transaction, then wait until its extend is ROOTED (the leaders can resolve it) */
async function buildTable(conn: Connection, payer: Keypair, addresses: PublicKey[], w: WarmTable): Promise<AddressLookupTableAccount | null> {
  // the static table (same authority possible) is created first when it is being created right now
  await staticLookupTableBusy();
  const sent = await withAuthority(payer.publicKey, async () => {
    const recentSlot = await freshRecentSlot(conn, payer.publicKey);
    const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot });
    const extend = AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: address, addresses });
    w.address = address.toBase58();
    if (!(await sendIxs(conn, payer, [create, extend]))) return null;
    const f = load();
    f.launches.push({ address: address.toBase58(), authority: payer.publicKey.toBase58(), createdAt: Date.now(), holdUntil: Date.now() + WARM_HOLD_MS, mint: w.mint, ...(devnet() ? { cluster: "devnet" as const } : {}) });
    save(f);
    return address;
  });
  if (!sent) {
    w.failed = "the table transaction did not land";
    return null;
  }
  const rc = fresh();
  for (let i = 0; i < 150; i++) {
    if (w.extendSlot === null) {
      const c = (await rc.getAddressLookupTable(sent, { commitment: "confirmed" }).catch(() => null))?.value;
      if (c) w.extendSlot = Number(c.state.lastExtendedSlot);
    }
    const t = await rootedTable(rc, sent);
    if (t && t.state.addresses.length >= addresses.length) {
      w.readyAt = Date.now();
      w.table = t;
      return t;
    }
    await sleep(400);
  }
  w.failed = "the table was never seen finalized (60 s)";
  return null;
}

/** start (or re-use) the lookup table of a coming launch: mint + dev + the bundle wallets that will buy inside the
 *  create. A table holding these addresses or more (more buyers) is re-used; a different set starts a new one (the
 *  old one is swept: rent back to its payer). Returns at once — the table is built in the background. */
export function warmLaunchTable(conn: Connection, payer: Keypair, mint: PublicKey, buyers: PublicKey[]): WarmTable {
  const m = warmMap();
  const key = mint.toBase58();
  const cur = m.get(key);
  const dev = payer.publicKey.toBase58();
  const want = buyers.map((b) => b.toBase58());
  if (cur && !cur.failed && !cur.taken && cur.dev === dev && want.every((b) => cur.buyers.includes(b)) && Date.now() - cur.startedAt < WARM_HOLD_MS - 60_000) return cur;
  const w: WarmTable = { mint: key, dev, buyers: want, address: null, extendSlot: null, startedAt: Date.now(), readyAt: null, table: null, failed: null, taken: false, done: Promise.resolve(null) };
  w.done = buildTable(conn, payer, launchTableAddresses(mint, payer.publicKey, buyers), w).catch((e) => {
    w.failed = e instanceof Error ? e.message : String(e);
    return null;
  });
  m.set(key, w);
  // keep memory bounded: a draft edited many times leaves old entries (their tables are swept on chain)
  if (m.size > 30) m.delete(m.keys().next().value!);
  return w;
}

/** the warm table prepared for this launch (same dev, holds every inline buyer), if any */
export function warmTableFor(mint: string, dev: string, buyers: string[]): WarmTable | null {
  const w = warmMap().get(mint);
  if (!w || w.failed || w.taken || w.dev !== dev || !buyers.every((b) => w.buyers.includes(b))) return null;
  if (Date.now() - w.startedAt > WARM_HOLD_MS - 60_000) return null;
  return w;
}

/** estimated ms until the warm table is rooted: 0 = ready, null = unknown (its transaction has not landed yet) */
export async function warmTableEtaMs(conn: Connection, w: WarmTable): Promise<number | null> {
  if (w.table) return 0;
  if (w.extendSlot === null) return null;
  const fin = await conn.getSlot("finalized").catch(() => null);
  if (fin === null) return null;
  return Math.max(0, (w.extendSlot - fin + 1) * SLOT_MS);
}

/** the warm table once rooted, waiting at most `maxMs` */
export async function awaitWarmTable(w: WarmTable, maxMs: number): Promise<AddressLookupTableAccount | null> {
  if (w.table) return w.table;
  return Promise.race([w.done, sleep(maxMs).then(() => null)]);
}

/** a launch uses this table: never handed to another launch, its hold ends (the launch deactivates it once settled) */
export function takeWarmTable(w: WarmTable): void {
  w.taken = true;
  warmMap().delete(w.mint);
}

/** public view for the UI / API (`/api/launch/warm`) */
export function warmTableStatus(w: WarmTable | null): { state: "none" | "building" | "rooting" | "ready" | "failed"; address: string | null; ms: number; error: string | null } {
  if (!w) return { state: "none", address: null, ms: 0, error: null };
  return { state: w.failed ? "failed" : w.table ? "ready" : w.extendSlot !== null ? "rooting" : "building", address: w.address, ms: (w.readyAt ?? Date.now()) - w.startedAt, error: w.failed };
}

/** after the launch settled: stop the table (it is no longer needed), closable ~513 slots later */
export async function deactivateLaunchTable(conn: Connection, payer: Keypair, table: AddressLookupTableAccount): Promise<void> {
  if (table.key.toBase58() === load().static || table.key.toBase58() === load().staticDevnet) return; // never a static one
  const ok = await sendIxs(conn, payer, [AddressLookupTableProgram.deactivateLookupTable({ lookupTable: table.key, authority: payer.publicKey })]).catch(() => false);
  if (!ok) return;
  const f = load();
  const row = f.launches.find((x) => x.address === table.key.toBase58());
  if (row) row.deactivatedAt = Date.now();
  save(f);
}

/** close the deactivated launch tables whose cool-down is over: the rent goes back to their dev (needs the vault open) */
export async function sweepLaunchTables(conn: Connection): Promise<number> {
  const st = store();
  if (!st.sol.unlocked) return 0;
  const removed = new Set<string>();
  const inUse = new Set([...warmMap().values()].filter((w) => !w.failed).map((w) => w.address));
  let closed = 0;
  for (const row of load().launches.filter(onThisCluster)) {
    // a table never deactivated (server stopped mid-launch, draft abandoned) is deactivated here first — not while a
    // coming launch may still use it
    let kp: Keypair;
    try {
      kp = st.sol.keypair(row.authority);
    } catch {
      continue;
    }
    const key = new PublicKey(row.address);
    const t = (await conn.getAddressLookupTable(key).catch(() => null))?.value ?? null;
    if (!t) {
      removed.add(row.address);
      continue;
    }
    if (t.isActive() && !row.deactivatedAt && !inUse.has(row.address) && Date.now() > (row.holdUntil ?? row.createdAt + 10 * 60_000)) {
      await deactivateLaunchTable(conn, kp, t);
      continue;
    }
    if (!t.isActive() && row.deactivatedAt && Date.now() - row.deactivatedAt > 5 * 60_000) {
      const ok = await sendIxs(conn, kp, [AddressLookupTableProgram.closeLookupTable({ lookupTable: key, authority: kp.publicKey, recipient: kp.publicKey })]).catch(() => false);
      if (ok) {
        closed++;
        removed.add(row.address);
      }
    }
  }
  if (removed.size) {
    const cur = load();
    save({ ...cur, launches: cur.launches.filter((x) => !removed.has(x.address)) });
  }
  return closed;
}
