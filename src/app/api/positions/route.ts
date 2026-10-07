import { json, requireAddress, route } from "@/server/api";
import { positions } from "@/server/positions";
import { store } from "@/server/store";
import { ledgerTokenBalances } from "@/server/ledger";
import type { PositionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  const active = new Set(st.sol.wallets.map((w) => w.address));
  const rows = await positions([...active], mintList);
  // each launch's wallets that are no longer active (deleted dev / buyers), read for that launch's mint only
  const asked = new Set(mintList.slice(0, 40));
  // without ?mints=, only the deleted wallets the ledger says still hold this launch's token (a handful, not every
  // old wallet of every launch — that re-read took 67 s and drew RPC 429s)
  const held = mints.length ? null : ledgerTokenBalances();
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
  return json([...rows, ...more.filter((r) => !seen.has(`${r.wallet}:${r.mint}`))]);
});
