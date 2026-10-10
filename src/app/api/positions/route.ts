import { json, requireAddress, route } from "@/server/api";
import { positions } from "@/server/positions";
import { store } from "@/server/store";
import { ledgerTokenBalances } from "@/server/ledger";
import type { PositionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The default read (Dashboard / Portfolio poll it every 10 s) costs 12–25 s on a rate-limited RPC: the last result is
 *  answered at once and re-read in the background (one read at a time); only the first read after a start waits. */
const SWR_FRESH_MS = 8_000;
const SWR_MAX_AGE_MS = 10 * 60_000;
const swr = globalThis as unknown as { __positionsDefault?: { at: number; rows: PositionRow[] }; __positionsReading?: Promise<PositionRow[]> | null };

/** ?wallets=a,b (default: every vault wallet + each launch's own wallets for its mint, so a dev deleted after its
 *  launch still counts) · ?mints=m1,m2 (default: launched + tracked mints).
 *  Without ?mints= (Dashboard, Portfolio) a deleted launch wallet only adds the tokens it still holds: the Dashboard's
 *  holdings would otherwise miss them while the launch's ledger counts what it bought (FRAME: 7 % of the supply left
 *  on a trashed dev = −2.2 SOL on the Dashboard, −0.14 SOL in Tasks). */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const st = store();
  const wallets = (q.get("wallets") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => requireAddress(a, "wallets"));
  const mints = (q.get("mints") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => requireAddress(a, "mints"));
  const mintList = mints.length ? mints : [...new Set([...st.launches.map((l) => l.mint), ...st.tracked])];
  if (wallets.length) return json(await positions(wallets, mintList));
  if (mints.length) return json(await readDefault(mints, mintList));
  const last = swr.__positionsDefault;
  const read = () => (swr.__positionsReading ??= readDefault(mints, mintList)
    .then((rows) => { swr.__positionsDefault = { at: Date.now(), rows }; return rows; })
    .finally(() => { swr.__positionsReading = null; }));
  if (last && Date.now() - last.at < SWR_MAX_AGE_MS) {
    if (Date.now() - last.at > SWR_FRESH_MS) void read().catch(() => null);
    return json(last.rows);
  }
  return json(await read());
});

/** every vault wallet + each launch's inactive wallets for its own mint */
async function readDefault(mints: string[], mintList: string[]): Promise<PositionRow[]> {
  const st = store();
  const active = new Set(st.sol.wallets.map((w) => w.address));
  // without ?mints=, only the deleted wallets the ledger says still hold this launch's token (a handful, not every
  // old wallet of every launch — that re-read took 67 s and drew RPC 429s)
  const held = mints.length ? null : ledgerTokenBalances();
  // the 40 newest mints + EVERY mint the ledger says one of our wallets still holds: past 40 launches an older coin
  // still held fell out of the read, its value showed $0 while its cost stayed open (FRAME on dev 6 = −2.29 SOL,
  // Dashboard −$273 instead of ~−$50, 2026-10-10)
  const holding = held ? mintList.filter((m) => [...(held.get(m)?.values() ?? [])].some((v) => v > BigInt(0))) : [];
  const readList = [...new Set([...mintList.slice(0, 40), ...holding])];
  const rows = await positions([...active], readList, readList.length);
  // each launch's wallets that are no longer active (deleted dev / buyers), read for that launch's mint only
  const asked = new Set(readList);
  const extra = st.launches
    .filter((l) => asked.has(l.mint))
    .map((l) => ({ mint: l.mint, wallets: [...new Set([l.dev, ...(l.wallets ?? [])])].filter((a) => a && !active.has(a) && (!held || (held.get(l.mint)?.get(a) ?? BigInt(0)) > BigInt(0))) }))
    .filter((x) => x.wallets.length);
  const more: PositionRow[] = [];
  for (let i = 0; i < extra.length; i += 4) {
    const parts = await Promise.all(extra.slice(i, i + 4).map((x) => positions(x.wallets, [x.mint]).catch(() => [] as PositionRow[])));
    for (const p of parts) more.push(...(mints.length ? p : p.filter((r) => Number(r.amount) > 0)));
  }
  const seen = new Set(rows.map((r) => `${r.wallet}:${r.mint}`));
  return [...rows, ...more.filter((r) => !seen.has(`${r.wallet}:${r.mint}`))];
}
