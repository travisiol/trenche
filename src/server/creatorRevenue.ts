/* Creator fees EARNED per launched token, read on chain: every pump.fun trade pays its creator fee into the creator
 * vault of the dev wallet and its trade event names the mint, so scanning each dev wallet's creator vault history
 * (engine scanFeesHistory) gives the exact fees each token produced — claimed or still pending. pump.fun pays per
 * creator wallet, not per token: a claim alone cannot say which token it came from, this can.
 * Incremental (newest signature per creator), persisted next to the ledger in creator-revenue.json. */
import { scanFeesHistory } from "@/engine/solana/pump/fees.js";
import { readConn } from "./engine";
import { readJson, store, writeJson } from "./store";

type ScanState = { newest: string | null; complete: boolean; claims: { ts: number; sig: string; amount: string }[]; perMint: Record<string, { revenue: string; trades: number }> };
type RevenueFile = { v: 1; creators: Record<string, ScanState & { scannedAt: number }> };

const g = globalThis as unknown as { __trenchRevenue?: { file: RevenueFile | null; path: string; running: Promise<void> | null; lastRun: number } };
const S = (g.__trenchRevenue ??= { file: null, path: "", running: null, lastRun: 0 });

function path(): string {
  return `${store().dir}/creator-revenue.json`;
}
function file(): RevenueFile {
  const p = path();
  if (S.file && S.path === p) return S.file;
  const f = readJson<RevenueFile>(p, { v: 1, creators: {} });
  f.creators ??= {};
  S.file = f;
  S.path = p;
  return f;
}

/** dev wallets of every launch that went live */
function creators(): string[] {
  return [...new Set(store().launches.filter((l) => l.createConfirmed && l.dev).map((l) => l.dev))];
}

/** scan new creator-vault transactions of every dev wallet (serialised, at most one run per `minIntervalMs`) */
export function refreshCreatorRevenue(opts: { force?: boolean; minIntervalMs?: number } = {}): Promise<void> {
  if (S.running) return S.running;
  if (!opts.force && Date.now() - S.lastRun < (opts.minIntervalMs ?? 20_000)) return Promise.resolve();
  S.lastRun = Date.now();
  S.running = (async () => {
    const f = file();
    const conn = readConn();
    let changed = false;
    for (const c of creators()) {
      const prev = f.creators[c] ?? null;
      try {
        const next = (await scanFeesHistory(conn, c, prev, { maxSignatures: 400 })) as ScanState;
        f.creators[c] = { ...next, scannedAt: Date.now() };
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

/** lamports of creator fees each mint has produced (all creators), and whether every scan reached the newest tx */
export function creatorRevenueByMint(): { byMint: Map<string, bigint>; complete: boolean } {
  const f = file();
  const byMint = new Map<string, bigint>();
  let complete = true;
  for (const c of creators()) {
    const st = f.creators[c];
    if (!st) {
      complete = false;
      continue;
    }
    if (!st.complete) complete = false;
    for (const [mint, r] of Object.entries(st.perMint)) byMint.set(mint, (byMint.get(mint) ?? BigInt(0)) + BigInt(r.revenue));
  }
  return { byMint, complete };
}
