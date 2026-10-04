/* Auto-dump watcher: module-level setInterval (2 s) per mint. Sells X % of the listed wallets when
 *   - market cap ≥ mcUsd, or
 *   - afterSec elapsed since arming, or
 *   - external volume ≥ externalVolumeSol (Block X "sellOnExternal"):
 *     external = |Δ realSolReserves| accumulated by this watcher − SOL traded by this app's own wallets
 *     on the mint since arming (from the activity journal). An approximation: trades inside one
 *     2 s window are netted, and third-party volume equal to ours would cancel out.
 * Only armed by an explicit API call or a launch request that carried `autoDump`/`sellOnExternal`. */
import { PublicKey } from "@solana/web3.js";
import type { AutoDumpConfig, AutoDumpStatus } from "@/lib/types";
import { HttpError } from "./api";
import { curveMetrics, fetchCurve, readConn, sellWithWallets, tipLamportsFor, vaultWallets } from "./engine";
import { jobNew, jobRun } from "./jobs";
import { solPrice, solPriceCached } from "./price";
import { logActivity, store } from "./store";

export type DumpWatch = {
  mint: string;
  config: AutoDumpConfig & { externalVolumeSol?: number };
  wallets: string[];
  armedAt: number;
  lastMcUsd: number | null;
  lastRealSol: bigint | null;
  curveVolumeSol: number;
  externalVolumeSol: number;
  firedAt: number | null;
  firedReason: string | null;
  jobId: string | null;
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  onFire?: (reason: string, jobId: string) => void;
};

function registry(): Map<string, DumpWatch> {
  const rt = store().runtime;
  if (!rt.autodump) rt.autodump = new Map<string, DumpWatch>();
  return rt.autodump as Map<string, DumpWatch>;
}

export function autodumpStatus(mint: string): AutoDumpStatus {
  const w = registry().get(mint);
  if (!w) return { mint, armed: false, percent: null, mcUsd: null, delaySec: null, firesAt: null, config: null, armedAt: null, lastMcUsd: null, firedAt: null, jobId: null };
  const delaySec = w.config.afterSec ?? null;
  return {
    mint,
    armed: w.timer !== null,
    percent: w.config.percent,
    mcUsd: w.config.mcUsd ?? null,
    delaySec,
    firesAt: delaySec ? w.armedAt + delaySec * 1000 : null,
    config: w.config,
    armedAt: w.armedAt,
    lastMcUsd: w.lastMcUsd,
    firedAt: w.firedAt,
    jobId: w.jobId,
  };
}

export function autodumpGet(mint: string): DumpWatch | undefined {
  return registry().get(mint);
}

/** SOL this app's wallets traded on `mint` since `since` (buys + sells, from the journal) */
function ownVolumeSince(mint: string, since: number): number {
  return store()
    .activity.filter((a) => a.mint === mint && a.at >= since && a.data && typeof a.data.solTotal === "number")
    .reduce((s, a) => s + (a.data!.solTotal as number), 0);
}

export function armAutodump(mint: string, config: AutoDumpConfig & { externalVolumeSol?: number }, wallets: string[], onFire?: DumpWatch["onFire"]): AutoDumpStatus {
  const st = store();
  if (config.delaySec && !config.afterSec) config = { ...config, afterSec: config.delaySec };
  if (!config.mcUsd && !config.afterSec && !config.externalVolumeSol) throw new HttpError(400, "Auto-dump needs at least one trigger: mcUsd, delaySec (afterSec) or externalVolumeSol.");
  const percent = Math.max(1, Math.min(100, Math.round(Number(config.percent) || 100)));
  const ws = vaultWallets(wallets);
  if (ws.length === 0) throw new HttpError(400, "Auto-dump needs at least one wallet.");
  disarmAutodump(mint);
  const w: DumpWatch = {
    mint,
    config: { ...config, percent, wallets: ws.map((x) => x.address) },
    wallets: ws.map((x) => x.address),
    armedAt: Date.now(),
    lastMcUsd: null,
    lastRealSol: null,
    curveVolumeSol: 0,
    externalVolumeSol: 0,
    firedAt: null,
    firedReason: null,
    jobId: null,
    timer: null,
    busy: false,
    onFire,
  };
  w.timer = setInterval(() => void tick(w), 2000);
  registry().set(mint, w);
  logActivity(st, { kind: "autodump", ok: true, message: `Auto-dump armed on ${mint.slice(0, 6)}…: ${percent}%${config.mcUsd ? ` at MC ≥ $${config.mcUsd}` : ""}${config.afterSec ? ` after ${config.afterSec}s` : ""}${config.externalVolumeSol ? ` when external volume ≥ ${config.externalVolumeSol} SOL` : ""}`, mint, wallets: w.wallets });
  void tick(w);
  return autodumpStatus(mint);
}

export function disarmAutodump(mint: string): AutoDumpStatus {
  const w = registry().get(mint);
  if (w?.timer) {
    clearInterval(w.timer);
    w.timer = null;
    logActivity(store(), { kind: "autodump", ok: true, message: `Auto-dump disarmed on ${mint.slice(0, 6)}…`, mint });
  }
  return autodumpStatus(mint);
}

async function tick(w: DumpWatch): Promise<void> {
  if (w.busy || w.timer === null) return;
  w.busy = true;
  try {
    const conn = readConn();
    const found = await fetchCurve(conn, new PublicKey(w.mint)).catch(() => null);
    if (found) {
      const m = curveMetrics(found.curve);
      const usd = solPriceCached() ?? (await solPrice())?.usd ?? null;
      w.lastMcUsd = usd ? m.marketCapSol * usd : null;
      if (w.lastRealSol !== null) {
        const d = found.curve.realSolReserves - w.lastRealSol;
        w.curveVolumeSol += Math.abs(Number(d)) / 1e9;
      }
      w.lastRealSol = found.curve.realSolReserves;
      w.externalVolumeSol = Math.max(0, w.curveVolumeSol - ownVolumeSince(w.mint, w.armedAt));
      if (found.curve.complete) {
        fire(w, "token migrated (curve complete) — selling on the curve is no longer possible");
        return;
      }
    }
    const c = w.config;
    let reason: string | null = null;
    if (c.mcUsd && w.lastMcUsd !== null && w.lastMcUsd >= c.mcUsd) reason = `market cap $${Math.round(w.lastMcUsd)} ≥ $${c.mcUsd}`;
    else if (c.afterSec && Date.now() - w.armedAt >= c.afterSec * 1000) reason = `${c.afterSec}s elapsed`;
    else if (c.externalVolumeSol && w.externalVolumeSol >= c.externalVolumeSol) reason = `external volume ${w.externalVolumeSol.toFixed(3)} SOL ≥ ${c.externalVolumeSol}`;
    if (reason) fire(w, reason);
  } finally {
    w.busy = false;
  }
}

function fire(w: DumpWatch, reason: string): void {
  if (w.timer) clearInterval(w.timer);
  w.timer = null;
  w.firedAt = Date.now();
  w.firedReason = reason;
  const st = store();
  if (/migrated/.test(reason)) {
    logActivity(st, { kind: "autodump", ok: false, message: `Auto-dump on ${w.mint.slice(0, 6)}… cancelled: ${reason}`, mint: w.mint });
    return;
  }
  const job = jobNew("autodump", w.wallets.length, `Auto-dump ${w.config.percent}% · ${w.mint.slice(0, 6)}… (${reason})`);
  job.extra = { mint: w.mint, reason, percent: w.config.percent };
  w.jobId = job.id;
  logActivity(st, { kind: "autodump", ok: true, message: `Auto-dump fired on ${w.mint.slice(0, 6)}…: ${reason}`, mint: w.mint, wallets: w.wallets, jobId: job.id });
  const bundle = !!w.config.bundle;
  jobRun(job, async (j) => {
    await sellWithWallets({ mint: w.mint, wallets: w.wallets, percent: w.config.percent, slippageBps: st.settings.slippageBps, cuPrice: st.settings.cuPrice, tipLamports: bundle ? tipLamportsFor(st.settings.tipSol) : tipLamportsFor(undefined), bundle, job: j, kind: "autodump" });
  });
  w.onFire?.(reason, job.id);
}
