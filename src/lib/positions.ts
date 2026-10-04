import type { Position, PositionRow } from "./types";

const add = (a: string, b: string) => String(Number(a || 0) + Number(b || 0));

/** Group the server's flat per-wallet rows into one Position per mint (sums in SOL decimal strings). */
export function groupPositions(rows: PositionRow[] | null | undefined): Position[] {
  const byMint = new Map<string, Position>();
  for (const r of rows ?? []) {
    let p = byMint.get(r.mint);
    if (!p) {
      p = {
        mint: r.mint, symbol: r.symbol, name: r.name, image: r.image,
        amount: "0", valueSol: "0", costSol: "0", realisedSol: "0", pnlSol: "0",
        supplyPct: null, onCurve: r.onCurve, progress: r.progress, marketCapSol: r.marketCapSol, wallets: [],
      };
      byMint.set(r.mint, p);
    }
    p.amount = add(p.amount, r.amount);
    p.valueSol = add(p.valueSol, r.valueSol);
    p.costSol = add(p.costSol, r.costSol);
    p.realisedSol = add(p.realisedSol, r.realisedSol);
    p.pnlSol = add(p.pnlSol, r.pnlSol);
    if (r.supplyPct != null) p.supplyPct = (p.supplyPct ?? 0) + r.supplyPct;
    p.wallets.push({
      address: r.wallet, label: r.label, amount: r.amount, valueSol: r.valueSol, costSol: r.costSol,
      realisedSol: r.realisedSol, pnlSol: r.pnlSol, supplyPct: r.supplyPct, isDev: r.isDev,
    });
  }
  return [...byMint.values()];
}
