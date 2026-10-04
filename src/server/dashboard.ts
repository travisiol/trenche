/* Dashboard: recent launches with live market cap, PnL windows from the activity journal, active tasks. */
import { PublicKey } from "@solana/web3.js";
import type { DashboardLaunch, DashboardResponse, LaunchTaskState, PnlSharePeriod, PnlShareResponse, PnlWindow } from "@/lib/types";
import { curveMetrics, fetchCurve, readConn } from "./engine";
import { feedCard, feedSolUsd } from "./feed";
import { launchGet } from "./launch";
import { metaCached } from "./metadata";
import { positions } from "./positions";
import { solPrice } from "./price";
import { store } from "./store";
import { loops } from "./tradeloop";
import { balances } from "./wallets";

const TRADE_KINDS = new Set(["buy", "sell", "dump", "autodump", "sniper", "volume", "buy-loop", "buy_loop"]);

const SHARE_WINDOW_MS: Record<PnlSharePeriod, number> = { "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: 0 };
const f9 = (n: number) => (Math.round(n * 1e9) / 1e9).toString();
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** Figures of the Share PnL card (see PnlShareResponse). Positions are best-effort: null when unreadable. */
export async function pnlShare(period: PnlSharePeriod): Promise<PnlShareResponse> {
  const st = store();
  const to = Date.now();
  const since = SHARE_WINDOW_MS[period] ? to - SHARE_WINDOW_MS[period] : 0;
  const usd = feedSolUsd() ?? (await solPrice().catch(() => null))?.usd ?? null;
  let buys = 0,
    sells = 0,
    buysUsd = 0,
    sellsUsd = 0,
    trades = 0,
    launches = 0,
    usdAtCurrentPrice = false,
    usdKnown = true,
    first = Number.POSITIVE_INFINITY;
  const perMint = new Map<string, number>();
  for (const a of st.activity) {
    if (a.at < since) continue;
    if (a.kind === "launch" && a.ok) launches++;
    if (!TRADE_KINDS.has(a.kind) || !a.data || typeof a.data.solTotal !== "number") continue;
    const side = a.data.side;
    if (side !== "buy" && side !== "sell") continue;
    const sol = a.data.solTotal;
    const journaled = typeof a.data.solUsd === "number" && a.data.solUsd > 0 ? a.data.solUsd : null;
    const price = journaled ?? usd;
    if (journaled === null && sol > 0) {
      if (usd === null) usdKnown = false;
      else usdAtCurrentPrice = true;
    }
    if (side === "buy") {
      buys += sol;
      buysUsd += price ? sol * price : 0;
    } else {
      sells += sol;
      sellsUsd += price ? sol * price : 0;
    }
    trades++;
    first = Math.min(first, a.at);
    if (a.mint) perMint.set(a.mint, (perMint.get(a.mint) ?? 0) + (side === "sell" ? sol : -sol));
  }
  let wins = 0,
    losses = 0,
    best: { mint: string; sol: number } | null = null;
  for (const [mint, sol] of perMint) {
    if (sol > 0) wins++;
    else if (sol < 0) losses++;
    if (!best || sol > best.sol) best = { mint, sol };
  }
  let unrealisedSol: number | null = null;
  if (st.sol.unlocked) {
    try {
      const wallets = st.sol.wallets.map((w) => w.address);
      const mints = [...new Set([...st.launches.map((l) => l.mint), ...st.tracked])];
      unrealisedSol = wallets.length && mints.length ? (await positions(wallets, mints)).reduce((n, r) => n + Number(r.pnlSol), 0) : 0;
    } catch {
      unrealisedSol = null;
    }
  }
  const bestSymbol = best ? (st.launches.find((l) => l.mint === best!.mint)?.symbol ?? metaCached(best.mint)?.symbol ?? feedCard(best.mint)?.symbol ?? null) : null;
  return {
    period,
    from: since || (Number.isFinite(first) ? first : to),
    to,
    realisedSol: f9(sells - buys),
    realisedUsd: usdKnown ? f2(sellsUsd - buysUsd) : null,
    usdAtCurrentPrice,
    unrealisedSol: unrealisedSol === null ? null : f9(unrealisedSol),
    unrealisedUsd: unrealisedSol === null || usd === null ? null : f2(unrealisedSol * usd),
    trades,
    wins,
    losses,
    bestTradeSol: best ? f9(best.sol) : null,
    bestTradeMint: best?.mint ?? null,
    bestTradeSymbol: bestSymbol,
    volumeSol: f9(buys + sells),
    buysSol: f9(buys),
    sellsSol: f9(sells),
    launches,
    wallets: st.sol.wallets.filter((w) => !st.walletMeta.meta[w.address]?.archived).length,
    solPrice: usd,
  };
}

function pnlWindow(since: number): PnlWindow {
  let buys = 0,
    sells = 0,
    trades = 0;
  for (const a of store().activity) {
    if (a.at < since || !TRADE_KINDS.has(a.kind) || !a.data || typeof a.data.solTotal !== "number") continue;
    const side = a.data.side;
    if (side === "buy") buys += a.data.solTotal;
    else if (side === "sell") sells += a.data.solTotal;
    else continue;
    trades++;
  }
  const f = (n: number) => (Math.round(n * 1e9) / 1e9).toString();
  return { realisedSol: f(sells - buys), buysSol: f(buys), sellsSol: f(sells), trades };
}

export async function dashboard(): Promise<DashboardResponse> {
  const st = store();
  const conn = readConn();
  const usd = feedSolUsd() ?? (await solPrice().catch(() => null))?.usd ?? null;
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
  return {
    recentLaunches,
    pnl: { "24h": pnlWindow(now - 86_400_000), "7d": pnlWindow(now - 7 * 86_400_000), "30d": pnlWindow(now - 30 * 86_400_000), all: pnlWindow(0) },
    activeTasks,
    totalSol,
    solPrice: usd,
  };
}
