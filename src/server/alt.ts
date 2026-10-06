/* Address lookup tables for the launch create transaction.
 *
 * A create that carries the dev buy AND the first bundle wallets' buys (prepareLaunch `inlineMax`) only fits in 1232
 * bytes with lookup tables — measured on KUDOS-sized metadata: no table = dev buy only, static table = +1 wallet,
 * static + per-launch table = +3 wallets.
 *  - static table: the pump.fun programs, PDAs and fee recipients — created once (≈0.008 SOL rent, paid by the dev
 *    of the first launch that needs it), address kept in alt.json, re-created only when pump.fun's fee recipient list
 *    no longer matches it;
 *  - per-launch table: the curve, its token account, the creator vault and the ATA + volume account of the dev and of
 *    each inline wallet. Created right before the create (≈0.004 SOL rent), deactivated once the launch settled and
 *    closed ~513 slots later: the rent goes back to the dev.
 * Everything here is best effort: no table → prepareLaunch keeps what fits (the dev buy alone at worst). */
import { AddressLookupTableProgram, ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type Connection, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { join } from "node:path";
import { ensureAlt } from "@/engine/solana/alt.js";
import { latestBlockhash, sendAndConfirm } from "@/engine/solana/send.js";
import { associatedTokenAddress, bondingCurvePda, bondingCurveV2Pda, creatorVaultPda, TOKEN_2022_PROGRAM, userVolumePda } from "@/engine/solana/pump/pdas.js";
import { readJson, store, writeJson } from "./store";

type LaunchTable = { address: string; authority: string; createdAt: number; deactivatedAt?: number };
type AltFile = { static: string | null; launches: LaunchTable[] };

const file = () => join(store().dir, "alt.json");
const load = (): AltFile => ({ static: null, launches: [], ...readJson<Partial<AltFile>>(file(), {}) });
const save = (f: AltFile) => writeJson(file(), f);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** the static pump.fun table, created on first use (payer = the launching dev) */
export async function staticLookupTable(conn: Connection, payer: Keypair): Promise<AddressLookupTableAccount | null> {
  const f = load();
  const r = await ensureAlt(conn, payer, f.static).catch(() => null);
  if (!r) return null;
  if (r.address !== f.static) save({ ...load(), static: r.address });
  return r.table;
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

/** create + fill a table for this launch in ONE transaction, then wait until it is usable (the slot after the extend) */
export async function launchLookupTable(conn: Connection, payer: Keypair, addresses: PublicKey[], onNote?: (s: string) => void): Promise<AddressLookupTableAccount | null> {
  try {
    const recentSlot = await conn.getSlot("finalized");
    const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot });
    const extend = AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: address, addresses });
    const t0 = Date.now();
    if (!(await sendIxs(conn, payer, [create, extend]))) return null;
    const f = load();
    f.launches.push({ address: address.toBase58(), authority: payer.publicKey.toBase58(), createdAt: Date.now() });
    save(f);
    for (let i = 0; i < 30; i++) {
      const t = (await conn.getAddressLookupTable(address, { commitment: "confirmed" }).catch(() => null))?.value;
      const slot = await conn.getSlot("processed").catch(() => 0);
      if (t && t.state.addresses.length >= addresses.length && slot > Number(t.state.lastExtendedSlot)) {
        onNote?.(`Launch lookup table ready in ${Date.now() - t0} ms.`);
        return t;
      }
      await sleep(250);
    }
    return null;
  } catch {
    return null;
  }
}

/** after the launch settled: stop the table (it is no longer needed), closable ~513 slots later */
export async function deactivateLaunchTable(conn: Connection, payer: Keypair, table: AddressLookupTableAccount): Promise<void> {
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
  let closed = 0;
  for (const row of load().launches) {
    // a table never deactivated (server stopped mid-launch) is deactivated here first
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
    if (t.isActive() && !row.deactivatedAt && Date.now() - row.createdAt > 10 * 60_000) {
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
