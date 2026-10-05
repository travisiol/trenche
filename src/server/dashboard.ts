/* Dashboard: recent launches with live market cap, PnL windows from the on-chain ledger, active tasks. */
import { imageUrl } from "./metadata";
import { PublicKey } from "@solana/web3.js";
import type { DashboardLaunch, DashboardResponse, PnlWindow, LaunchTaskState, PnlSharePeriod, PnlShareResponse } from "@/lib/types";
import { curveMetrics, fetchCurve, readConn } from "./engine";
import { feedCard, feedSolUsd } from "./feed";
import { readCreatorFees } from "./fees";
import { launchGet } from "./launch";
import { creatorFeesByDay, refreshCreatorRevenue } from "./creatorRevenue";
import { ledgerDay, ledgerDays, ledgerEntries, ledgerMints, ledgerPnl, ledgerStatus, refreshLedger } from "./ledger";
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
  void refreshCreatorRevenue().catch(() => null);
  void reconcileLaunches().catch(() => 0);
  const recent = st.launches.slice(0, 10);
  const recentLaunches: DashboardLaunch[] = await Promise.all(
    recent.map(async (l): Promise<DashboardLaunch> => {
      const card = feedCard(l.mint);
      l = { ...l, image: imageUrl(l.image) };
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
    // calendar windows (UTC midnight): 1D = today's calendar cell, 7D = the last 7 cells… same figure as the calendar
    pnl: {
      "24h": calendarWindow(1, now, pending),
      "7d": calendarWindow(7, now, pending),
      "30d": calendarWindow(30, now, pending),
      all: calendarWindow(0, now, pending),
    },
    days: ledgerDays(),
    mints: ledgerMints(),
    ledger: ledgerStatus(),
    activeTasks,
    totalSol,
    solPrice: usd,
  };
}

/** a PnL window made of whole calendar days (UTC), `days` = 0 for all time: net = the sum of the calendar cells
 *  (creator fees counted the day they were earned); costs / gross from the ledger over the same days; the gap goes
 *  to "other" so the breakdown adds up to the net */
function calendarWindow(days: number, now: number, pending: string | null): PnlWindow {
  const today = new Date(now);
  const startMs = days ? Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (days - 1) * 86_400_000 : 0;
  const startDate = days ? new Date(startMs).toISOString().slice(0, 10) : "";
  const w = ledgerPnl(startMs, now, pending).window;
  const net = ledgerDays()
    .filter((d) => d.date >= startDate)
    .reduce((s, d) => s + d.sol, 0);
  let earned = 0;
  for (const [date, perMint] of creatorFeesByDay()) if (date >= startDate) for (const v of perMint.values()) earned += Number(v) / 1e9;
  const explained = Number(w.realisedSol) - Number(w.fees.totalCostSol) + earned;
  return { ...w, netSol: f9(net), otherSol: f9(net - explained), fees: { ...w.fees, creatorFeesEarnedSol: f9(earned) } };
}

/** Figures of the Share PnL card (see PnlShareResponse). Positions are best-effort: null when unreadable. */
export async function pnlShare(period: PnlSharePeriod, day?: string): Promise<PnlShareResponse> {
  const st = store();
  const dayStart = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
  const to = day ? dayStart + 86_400_000 - 1 : Date.now();
  const since = day ? dayStart : SHARE_WINDOW_MS[period] ? to - SHARE_WINDOW_MS[period] : 0;
  const usd = feedSolUsd() ?? (await solPrice().catch(() => null))?.usd ?? null;
  await refreshLedger().catch(() => null);
  const pending = await pendingCreatorFees();
  const { window: w, mints } = ledgerPnl(since, to, pending);
  const entries = ledgerEntries().filter((e) => e.at >= since && e.at <= to);
  const first = entries[0]?.at ?? to;
  const launches = entries.filter((e) => e.kind === "create").length;
  let best: { mint: string; net: bigint } | null = null;
  for (const m of mints.values()) if (!best || m.net > best.net) best = { mint: m.mint, net: m.net };
  // a calendar day: the calendar's own figure (creator fees on the day they were earned) and that day's best coin
  const dayB = day ? ledgerDay(day) : null;
  if (dayB) {
    const top = dayB.coins[0];
    best = top && Number(top.netSol) > 0 ? { mint: top.mint, net: BigInt(0) } : null;
  }
  let unrealisedSol: number | null = null;
  if (st.sol.unlocked && !day) {
    try {
      const wallets = st.sol.wallets.map((x) => x.address);
      const mintList = [...new Set([...st.launches.map((l) => l.mint), ...st.tracked])];
      unrealisedSol = wallets.length && mintList.length ? (await positions(wallets, mintList)).filter((r) => Number(r.amount) > 0).reduce((n, r) => n + Number(r.valueSol), 0) : 0;
    } catch {
      unrealisedSol = null;
    }
  }
  const netSol = dayB ? dayB.totalSol : w.netSol;
  const net = Number(netSol);
  return {
    period,
    ...(day ? { day } : {}),
    from: since || first,
    to,
    netSol,
    netUsd: usd === null ? null : f2(net * usd),
    usdAtCurrentPrice: true,
    grossSol: w.realisedSol,
    fees: w.fees,
    otherSol: w.otherSol,
    unrealisedSol: unrealisedSol === null ? null : f9(unrealisedSol),
    unrealisedUsd: unrealisedSol === null || usd === null ? null : f2(unrealisedSol * usd),
    trades: w.trades,
    wins: dayB ? dayB.coins.filter((c) => Number(c.netSol) > 0).length : w.wins,
    losses: dayB ? dayB.coins.filter((c) => Number(c.netSol) < 0).length : w.losses,
    bestTradeSol: best ? (dayB ? dayB.coins[0].netSol : mints.get(best.mint)!.netSol) : null,
    bestTradeMint: best?.mint ?? null,
    bestTradeSymbol: best ? (dayB ? dayB.coins[0].symbol : (mints.get(best.mint)?.symbol ?? null)) : null,
    volumeSol: f9(Number(w.buysSol) + Number(w.sellsSol)),
    buysSol: w.buysSol,
    sellsSol: w.sellsSol,
    launches,
    wallets: st.sol.wallets.filter((x) => !st.walletMeta.meta[x.address]?.archived).length,
    solPrice: usd,
    estimated: w.estimated,
  };
}
