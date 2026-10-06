/* Positions = the last positions read (/api/positions: balances + the wallets' on-chain trade history) + the live
 * trades it does not contain yet (src/lib/livefeed.ts), quoted at the curve's live reserves. Reconciliation:
 *  - cost / realised: a live trade whose signature is in the row's tradeSigs is already counted;
 *  - token amount: comes from a balance read — a read SENT after the trade was received already holds it.
 * The ledger stays the truth for what a closed position made (positionPnl in Workspace.tsx). */
import type { LiveTrade } from "./liveTypes";
import type { ReceivedTrade } from "./livefeed";
import type { PositionRow } from "./types";

const TOTAL_SUPPLY_RAW = 1_000_000_000_000_000; // 1 B tokens × 1e6
const TOTAL_FEE_BPS = 125; // engine pdas.js: protocol 95 + creator 30 — the same quote as the positions read

/** spot price (SOL per token) after a live trade */
export function spotOf(t: Pick<LiveTrade, "vSol" | "vTok">): number {
  const vTok = Number(t.vTok) / 1e6;
  return vTok > 0 ? Number(t.vSol) / 1e9 / vTok : 0;
}

/** SOL out for selling `tokens` (raw) into reserves — engine math.js solOutForTokens (fee deducted) */
function solOut(tokens: number, vSol: number, vTok: number): number {
  if (tokens <= 0) return 0;
  const out = (tokens * vSol) / (vTok + tokens);
  return out - Math.ceil((out * TOTAL_FEE_BPS) / 10000);
}

const blank = (wallet: string, mint: string): PositionRow => ({ wallet, label: wallet.slice(0, 6), mint, symbol: null, name: null, image: null, amount: "0", valueSol: "0", costSol: "0", realisedSol: "0", pnlSol: "0", supplyPct: null, isDev: false, onCurve: true, progress: null, marketCapSol: null, tradeSigs: [] });

/** `rows` of one mint with the live trades of `own` wallets applied, re-quoted at the newest live reserves.
 *  `readSentAt` = when the positions request was sent (ResourceState.startedAt). */
export function applyLive(mint: string, rows: PositionRow[], trades: ReceivedTrade[], last: ReceivedTrade | null, own: Set<string>, readSentAt: number): PositionRow[] {
  const mine = trades.filter((t) => own.has(t.wallet));
  if (!mine.length && !last) return rows;
  const map = new Map<string, PositionRow>(rows.map((r) => [r.wallet, { ...r }]));
  // oldest first, so a buy then a sell of the same wallet nets out in order
  for (const t of [...mine].reverse()) {
    const r = map.get(t.wallet) ?? blank(t.wallet, mint);
    const counted = r.tradeSigs?.includes(t.signature) ?? false;
    if (!counted) {
      if (t.side === "buy") r.costSol = String(Number(r.costSol) + Number(t.walletSol));
      else r.realisedSol = String(Number(r.realisedSol) + Number(t.walletSol));
      r.tradeSigs = [...(r.tradeSigs ?? []), t.signature];
    }
    if (t.receivedAt > readSentAt) r.amount = String(Math.max(0, Number(r.amount) + (t.side === "buy" ? 1 : -1) * Number(t.tokens)));
    map.set(t.wallet, r);
  }
  // floor: the live feed's window is the most recent run of trades, so a wallet's signed sum over it (buys − sells) is
  // at most what it holds — a positions read whose balance was not fresh yet (right after a launch) said 0 and the
  // badge showed −(everything spent) for ~10 s
  const implied = new Map<string, number>();
  for (const t of mine) implied.set(t.wallet, (implied.get(t.wallet) ?? 0) + (t.side === "buy" ? 1 : -1) * Number(t.tokens));
  for (const [w, n] of implied) {
    const r = map.get(w);
    if (r && n > Number(r.amount)) r.amount = String(n);
  }
  const out = [...map.values()];
  if (!last || out.some((r) => r.onCurve === false)) return out;
  // quote every holding at the live reserves, one after the other (the engine's sequential quote: they cannot all
  // be sold at the same price)
  let vSol = Number(last.vSol);
  let vTok = Number(last.vTok);
  const sold = TOTAL_SUPPLY_RAW - Number(last.realTok);
  const spot = spotOf(last);
  for (const r of out) {
    const raw = Math.round(Number(r.amount) * 1e6);
    const gross = raw > 0 ? (raw * vSol) / (vTok + raw) : 0;
    const value = solOut(raw, vSol, vTok) / 1e9;
    vTok += raw;
    vSol -= gross;
    r.valueSol = String(value);
    r.pnlSol = String(value + Number(r.realisedSol) - Number(r.costSol));
    r.marketCapSol = spot * 1e9;
    r.supplyPct = sold > 0 ? Math.round((raw / sold) * 1e6) / 1e4 : null;
  }
  return out;
}
