/* Creator fees EARNED per launched token, read on chain. pump.fun pays creator fees into one creator vault per dev
 * wallet (not per token), so a claim alone cannot say which token it came from. Every transaction that touches the
 * vault is read instead: a lamport INCREASE of the vault is a creator fee paid by a trade, and the token traded is
 * the dev wallet's mint present in that transaction's accounts; a DECREASE is a claim. Lamport deltas, not pump.fun's
 * logged events: trades routed through bots often have their logs truncated or emit no log event at all.
 * Incremental (newest signature per creator), persisted next to the ledger in creator-revenue.json. */
import { PublicKey } from "@solana/web3.js";
import { creatorVaultPda } from "@/engine/solana/pump/pdas.js";
import { readConn } from "./engine";
import { readJson, store, writeJson } from "./store";

type CreatorScan = {
  newest: string | null;
  /** signatures seen but not readable yet (RPC hiccup) — retried, newest first */
  pending: string[];
  /** lamports received per mint ("?" = a fee whose transaction names none of this creator's mints) */
  perMint: Record<string, { lamports: string; trades: number }>;
  claims: { at: number; sig: string; lamports: string }[];
  /** every fee received, dated (the PnL calendar puts each fee on the day it was earned) */
  fees: { at: number; mint: string; lamports: string }[];
  scannedAt: number;
};
type RevenueFile = { v: 4; creators: Record<string, CreatorScan> };

const MAX_NEW_SIGNATURES = 2000;
const FETCH_BUDGET = 300;

const g = globalThis as unknown as { __trenchRevenue2?: { file: RevenueFile | null; path: string; running: Promise<void> | null; lastRun: number } };
const S = (g.__trenchRevenue2 ??= { file: null, path: "", running: null, lastRun: 0 });

function path(): string {
  return `${store().dir}/creator-revenue.json`;
}
function file(): RevenueFile {
  const p = path();
  if (S.file && S.path === p) return S.file;
  const raw = readJson<RevenueFile | { v: number }>(p, { v: 4, creators: {} });
  const f: RevenueFile = raw.v === 4 ? (raw as RevenueFile) : { v: 4, creators: {} }; // v3 counted the vault's rent deposit as a fee // v1 counted logged events only, v2 had no dates: rescanned
  f.creators ??= {};
  S.file = f;
  S.path = p;
  return f;
}

/** dev wallet → its live mints */
function creatorMints(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of store().launches) {
    if (!l.createConfirmed || !l.dev) continue;
    const s = out.get(l.dev) ?? new Set<string>();
    s.add(l.mint);
    out.set(l.dev, s);
  }
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** what the scan needs of a transaction, read as raw JSON: bot trades already use the version-1 transaction format,
 *  which web3.js refuses ("Transaction version (1) is not supported") — a raw call with maxSupportedTransactionVersion 1
 *  returns the account keys and balances all the same */
type RawTx = { blockTime: number | null; keys: string[]; pre: number[]; post: number[] } | null;
async function rawTransaction(endpoint: string, sig: string): Promise<RawTx | undefined> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { maxSupportedTransactionVersion: 1, commitment: "confirmed", encoding: "json" }] }),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { error?: unknown; result?: { blockTime: number | null; transaction: { message: { accountKeys: string[] } }; meta: { preBalances: number[]; postBalances: number[]; loadedAddresses?: { writable: string[]; readonly: string[] } } | null } | null };
    if (data.error) return undefined;
    const r = data.result;
    if (!r) return null;
    if (!r.meta) return null;
    const keys = [...r.transaction.message.accountKeys, ...(r.meta.loadedAddresses?.writable ?? []), ...(r.meta.loadedAddresses?.readonly ?? [])];
    return { blockTime: r.blockTime, keys, pre: r.meta.preBalances, post: r.meta.postBalances };
  } catch {
    return undefined;
  }
}

async function scanCreator(creator: string, mints: Set<string>, prev: CreatorScan | undefined, budget: { left: number }): Promise<CreatorScan> {
  const conn = readConn();
  // the vault is funded with its rent-exempt minimum when it is created (paid by the dev, locked for good — the ledger
  // counts it as a launch cost): that part of the first deposit is not a fee
  const rentMin = BigInt(await conn.getMinimumBalanceForRentExemption(0).catch(() => 0));
  const vault = creatorVaultPda(new PublicKey(creator));
  const vaultStr = vault.toBase58();
  const st: CreatorScan = prev ? { ...prev, pending: [...prev.pending], perMint: { ...prev.perMint }, claims: [...prev.claims], fees: [...(prev.fees ?? [])] } : { newest: null, pending: [], perMint: {}, claims: [], fees: [], scannedAt: 0 };
  // 1. new signatures, newest first, down to the last one already seen
  const fresh: string[] = [];
  let before: string | undefined;
  let first: string | null = null;
  for (;;) {
    const batch = await conn.getSignaturesForAddress(vault, { limit: 1000, before }, "confirmed");
    if (!batch.length) break;
    let reached = false;
    for (const s of batch) {
      first ??= s.signature;
      if (s.signature === st.newest) {
        reached = true;
        break;
      }
      if (!s.err) fresh.push(s.signature);
    }
    if (reached || batch.length < 1000 || fresh.length >= MAX_NEW_SIGNATURES) break;
    before = batch[batch.length - 1].signature;
  }
  if (first) st.newest = first;
  st.pending = [...fresh, ...st.pending.filter((s) => !fresh.includes(s))];
  // 2. read the queued transactions (budgeted across creators), oldest first so a partial run stays consistent
  const todo = st.pending.slice(-Math.max(0, budget.left)).reverse();
  budget.left -= todo.length;
  const got = await mapLimit(todo, 6, (sig) => rawTransaction(conn.rpcEndpoint, sig));
  const done = new Set<string>();
  todo.forEach((sig, i) => {
    const tx = got[i];
    if (tx === undefined) return; // retry next run
    done.add(sig);
    if (!tx) return;
    const keys = tx.keys;
    const idx = keys.indexOf(vaultStr);
    if (idx < 0) return;
    let delta = BigInt(tx.post[idx] ?? 0) - BigInt(tx.pre[idx] ?? 0);
    if (BigInt(tx.pre[idx] ?? 0) === BigInt(0) && delta > BigInt(0)) delta = delta > rentMin ? delta - rentMin : BigInt(0);
    if (delta > BigInt(0)) {
      const mint = keys.find((k) => mints.has(k)) ?? "?";
      const cur = st.perMint[mint] ?? { lamports: "0", trades: 0 };
      st.perMint[mint] = { lamports: (BigInt(cur.lamports) + delta).toString(), trades: cur.trades + 1 };
      st.fees.push({ at: (tx.blockTime ?? 0) * 1000, mint, lamports: delta.toString() });
    } else if (delta < BigInt(0) && !st.claims.some((c) => c.sig === sig)) {
      st.claims.push({ at: (tx.blockTime ?? 0) * 1000, sig, lamports: (-delta).toString() });
    }
  });
  st.pending = st.pending.filter((s) => !done.has(s));
  st.scannedAt = Date.now();
  return st;
}

/** scan new creator-vault transactions of every dev wallet (serialised, at most one run per `minIntervalMs`) */
export function refreshCreatorRevenue(opts: { force?: boolean; minIntervalMs?: number } = {}): Promise<void> {
  if (S.running) return S.running;
  if (!opts.force && Date.now() - S.lastRun < (opts.minIntervalMs ?? 20_000)) return Promise.resolve();
  S.lastRun = Date.now();
  S.running = (async () => {
    const f = file();
    const budget = { left: FETCH_BUDGET };
    let changed = false;
    for (const [creator, mints] of creatorMints()) {
      try {
        f.creators[creator] = await scanCreator(creator, mints, f.creators[creator], budget);
        changed = true;
      } catch {
        /* RPC hiccup: the next run continues from the same point */
      }
    }
    if (changed) {
      try {
        writeJson(path(), f);
      } catch {
        /* kept in memory */
      }
    }
  })().finally(() => {
    S.running = null;
  });
  return S.running;
}

/** lamports of creator fees each mint has produced, and whether every dev wallet's history has been read */
export function creatorRevenueByMint(): { byMint: Map<string, bigint>; complete: boolean } {
  const f = file();
  const byMint = new Map<string, bigint>();
  let complete = true;
  for (const creator of creatorMints().keys()) {
    const st = f.creators[creator];
    if (!st || st.pending.length) complete = false;
    if (!st) continue;
    for (const [mint, r] of Object.entries(st.perMint)) if (mint !== "?") byMint.set(mint, (byMint.get(mint) ?? BigInt(0)) + BigInt(r.lamports));
  }
  return { byMint, complete };
}

/** block time (epoch ms) of the newest creator fee counted for `mint` (null: none yet) — the live PnL adds the creator
 *  fees of the trades it sees AFTER this, so a fee is never counted twice nor missed while the scan catches up */
export function creatorFeesThrough(mint: string): number | null {
  const f = file();
  let at: number | null = null;
  for (const creator of creatorMints().keys())
    for (const fee of f.creators[creator]?.fees ?? []) if (fee.mint === mint && (at === null || fee.at > at)) at = fee.at;
  return at;
}

/** creator fees earned per UTC day and mint (lamports), from the dated fee list */
export function creatorFeesByDay(): Map<string, Map<string, bigint>> {
  const f = file();
  const out = new Map<string, Map<string, bigint>>();
  for (const creator of creatorMints().keys()) {
    for (const e of f.creators[creator]?.fees ?? []) {
      if (!e.at || e.mint === "?") continue;
      const day = new Date(e.at).toISOString().slice(0, 10);
      const m = out.get(day) ?? new Map<string, bigint>();
      m.set(e.mint, (m.get(e.mint) ?? BigInt(0)) + BigInt(e.lamports));
      out.set(day, m);
    }
  }
  return out;
}
