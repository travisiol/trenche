/* Dashboard: recent launches with live market cap, PnL windows from the on-chain ledger, active tasks. */
import { PublicKey } from "@solana/web3.js";
import type { DashboardLaunch, DashboardResponse, LaunchTaskState, PnlSharePeriod, PnlShareResponse } from "@/lib/types";
import { curveMetrics, fetchCurve, readConn } from "./engine";
import { feedCard, feedSolUsd } from "./feed";
import { readCreatorFees } from "./fees";
import { launchGet } from "./launch";
import { ledgerDays, ledgerEntries, ledgerMints, ledgerPnl, ledgerStatus, refreshLedger } from "./ledger";
import { positions } from "./positions";
import { reconcileLaunches } from "./reconcile";
import { solPrice } from "./price";
import { store } from "./store";
import { loops } from "./tradeloop";
import { balances } from "./wallets";

const SHARE_WINDOW_MS: Record<PnlSharePeriod, number> = { "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: 0 };
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();
const f9 = (n: number) => (Math.round(n * 1e9) / 1e9).toString();

/** creator fees still in the vaults of every launch dev (SOL), null when unreadable / no launch */
async function pendingCreatorFees(): Promise<string | null> {
  const st = store();
  const devs = [...new Set(st.launches.map((l) => l.dev))];
  if (!devs.length) return "0";
  try {
    const rows = await readCreatorFees(devs);
    if (!rows.length) return null;
    return f9(rows.reduce((s, r) => s + Number(r.claimable + r.cashback) / 1e9, 0));
  } catch {
    return null;
  }
}

export async function dashboard(): Promise<DashboardResponse> {
  const st = store();
  const conn = readConn();
  const usd = feedSolUsd() ?? (await solPrice().catch(() => null))?.usd ?? null;
  // the ledger refreshes in the background (budgeted); the figures below use what is on disk right now
  void refreshLedger().catch(() => null);
  void reconcileLaunches().catch(() => 0);
  const recent = st.launches.slice(0, 10);
  const recentLaunches: DashboardLaunch[] = await Promise.all(
    recent.map(async (l): Promise<DashboardLaunch> => {
      const card = feedCard(l.mint);
      if (card) return { ...l, marketCapSol: card.marketCapSol, marketCapUsd: card.marketCapUsd, progress: card.progress, complete: card.complete };
      const found = await fetchCurve(conn, new PublicKey(l.mint)).catch(() => null);
      if (!found) return { ...l, marketCapSol: null, marketCapUsd: null, progress: null, complete: null };
      const m = curveMetrics(found.curve);
      return { ...l, marketCapSol: m.marketCapSol, marketCapUsd: usd ? m.marketCapSol * usd : null, progress: m.progress, complete: found.curve.complete };
    }),
  );
  const now = Date.now();
  const activeTasks: DashboardResponse["activeTasks"] = [];
  for (const loop of loops().values()) {
    if (loop.status !== "running" && loop.status !== "paused") continue;
    const launchId = loop.cfg.id.includes(":") && !loop.cfg.id.startsWith("vol:") ? loop.cfg.id.split(":")[0] : "";
    const run = launchId ? launchGet(launchId) : undefined;
    const symbol = run?.state.symbol ?? st.launches.find((l) => l.mint === loop.cfg.mint)?.symbol ?? feedCard(loop.cfg.mint)?.symbol ?? "";
    activeTasks.push({ launchId, mint: loop.cfg.mint, symbol, task: loop.state() as LaunchTaskState });
  }
  let totalSol: string | null = null;
  if (st.sol.unlocked) {
    const b = await balances().catch(() => ({}) as Record<string, string | null>);
    const vals = Object.values(b);
    if (vals.length && vals.every((v) => v !== null)) totalSol = (Math.round(vals.reduce((s, v) => s + Number(v), 0) * 1e9) / 1e9).toString();
  }
  const pending = await pendingCreatorFees();
  return {
    recentLaunches,
    pnl: {
      "24h": ledgerPnl(now - 86_400_000, now, pending).window,
      "7d": ledgerPnl(now - 7 * 86_400_000, now, pending).window,
      "30d": ledgerPnl(now - 30 * 86_400_000, now, pending).window,
      all: ledgerPnl(0, now, pending).window,
    },
    days: ledgerDays(),
    mints: ledgerMints(),
    ledger: ledgerStatus(),
    activeTasks,
    totalSol,
    solPrice: usd,
  };
}

/** Figures of the Share PnL card (see PnlShareResponse). Positions are best-effort: null when unreadable. */
export async function pnlShare(period: PnlSharePeriod): Promise<PnlShareResponse> {
  const st = store();
  const to = Date.now();
  const since = SHARE_WINDOW_MS[period] ? to - SHARE_WINDOW_MS[period] : 0;
  const usd = feedSolUsd() ?? (await solPrice().catch(() => null))?.usd ?? null;
  await refreshLedger().catch(() => null);
  const pending = await pendingCreatorFees();
  const { window: w, mints } = ledgerPnl(since, to, pending);
  const entries = ledgerEntries().filter((e) => e.at >= since && e.at <= to);
  const first = entries[0]?.at ?? to;
  const launches = entries.filter((e) => e.kind === "create").length;
  let best: { mint: string; net: bigint } | null = null;
  for (const m of mints.values()) if (!best || m.net > best.net) best = { mint: m.mint, net: m.net };
  let unrealisedSol: number | null = null;
  if (st.sol.unlocked) {
    try {
      const wallets = st.sol.wallets.map((x) => x.address);
      const mintList = [...new Set([...st.launches.map((l) => l.mint), ...st.tracked])];
      unrealisedSol = wallets.length && mintList.length ? (await positions(wallets, mintList)).filter((r) => Number(r.amount) > 0).reduce((n, r) => n + Number(r.valueSol), 0) : 0;
    } catch {
      unrealisedSol = null;
    }
  }
  const net = Number(w.netSol);
  return {
    period,
    from: since || first,
    to,
    netSol: w.netSol,
    netUsd: usd === null ? null : f2(net * usd),
    usdAtCurrentPrice: true,
    grossSol: w.realisedSol,
    fees: w.fees,
    otherSol: w.otherSol,
    unrealisedSol: unrealisedSol === null ? null : f9(unrealisedSol),
    unrealisedUsd: unrealisedSol === null || usd === null ? null : f2(unrealisedSol * usd),
    trades: w.trades,
    wins: w.wins,
    losses: w.losses,
    bestTradeSol: best ? mints.get(best.mint)!.netSol : null,
    bestTradeMint: best?.mint ?? null,
    bestTradeSymbol: best ? (mints.get(best.mint)?.symbol ?? null) : null,
    volumeSol: f9(Number(w.buysSol) + Number(w.sellsSol)),
    buysSol: w.buysSol,
    sellsSol: w.sellsSol,
    launches,
    wallets: st.sol.wallets.filter((x) => !st.walletMeta.meta[x.address]?.archived).length,
    solPrice: usd,
    estimated: w.estimated,
  };
}
