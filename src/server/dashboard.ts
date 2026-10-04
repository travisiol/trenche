/* Dashboard: recent launches with live market cap, PnL windows from the activity journal, active tasks. */
import { PublicKey } from "@solana/web3.js";
import type { DashboardLaunch, DashboardResponse, LaunchTaskState, PnlWindow } from "@/lib/types";
import { curveMetrics, fetchCurve, readConn } from "./engine";
import { feedCard, feedSolUsd } from "./feed";
import { launchGet } from "./launch";
import { solPrice } from "./price";
import { store } from "./store";
import { loops } from "./tradeloop";
import { balances } from "./wallets";

const TRADE_KINDS = new Set(["buy", "sell", "dump", "autodump", "sniper", "volume", "buy-loop", "buy_loop"]);

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
