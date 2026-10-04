/* Auto-dump / external-volume watchers: module-level setInterval (2 s) per WATCH. A watch is keyed (default: the
 * mint) so several can run on one mint — the launch's Auto Dump, the dev's Auto Dev Sell, a bundle task's
 * "Sell all on external", a sniper/buy/volume task's "Stop on activity". Curve reads are shared per mint.
 * A watch fires when
 *   - market cap ≥ mcUsd, or
 *   - afterSec elapsed since arming, or
 *   - external volume ≥ externalVolumeSol (Block X "sellOnExternal" / "Stop on activity"):
 *     external = |Δ realSolReserves| accumulated by this watcher − SOL traded by this app's own wallets
 *     on the mint since arming (from the activity journal). An approximation: trades inside one
 *     2 s window are netted, and third-party volume equal to ours would cancel out.
 * action "sell" (default) dumps `percent` of the wallets in a job; action "notify" only calls onFire (used by
 * tasks to cancel themselves). Only armed by an explicit API call or a launch request. */
import { PublicKey } from "@solana/web3.js";
import type { AutoDumpConfig, AutoDumpStatus } from "@/lib/types";
import { HttpError } from "./api";
import { curveMetrics, fetchCurve, readConn, sellWithWallets, tipLamportsFor, vaultWallets } from "./engine";
import { jobNew, jobRun } from "./jobs";
import { registerRuntimeProducer, RESTORE_NOTE, restoreSection, saveRuntimeSoon } from "./persist";
import { solPrice, solPriceCached } from "./price";
import { logActivity, store } from "./store";

export type WatchConfig = AutoDumpConfig & { externalVolumeSol?: number; action?: "sell" | "notify"; label?: string };

export type DumpWatch = {
  key: string;
  mint: string;
  config: WatchConfig;
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
  /** restored from runtime.json after a restart: disarmed until POST {action:"resume"} */
  resumable?: boolean;
  onFire?: (reason: string, jobId: string | null) => void;
};

type SavedWatch = Pick<DumpWatch, "key" | "mint" | "config" | "wallets" | "armedAt" | "lastMcUsd" | "firedAt" | "firedReason" | "jobId"> & { armed: boolean };

function registry(): Map<string, DumpWatch> {
  const rt = store().runtime;
  if (!rt.autodump) {
    const map = new Map<string, DumpWatch>();
    rt.autodump = map;
    registerRuntimeProducer("autodumps", () => [...map.values()].map((w): SavedWatch => ({ key: w.key, mint: w.mint, config: w.config, wallets: w.wallets, armedAt: w.armedAt, lastMcUsd: w.lastMcUsd, firedAt: w.firedAt, firedReason: w.firedReason, jobId: w.jobId, armed: w.timer !== null })));
    for (const sv of restoreSection<SavedWatch[]>("autodumps") ?? []) {
      if (!sv?.mint || !sv.config) continue;
      const key = sv.key ?? sv.mint;
      // a "notify" watch belongs to a task callback that no longer exists after a restart: kept for its history only
      const resumable = sv.armed && !sv.firedAt && sv.config.action !== "notify";
      map.set(key, { key, mint: sv.mint, config: sv.config, wallets: sv.wallets ?? [], armedAt: sv.armedAt, lastMcUsd: sv.lastMcUsd ?? null, lastRealSol: null, curveVolumeSol: 0, externalVolumeSol: 0, firedAt: sv.firedAt ?? null, firedReason: sv.firedReason ?? null, jobId: sv.jobId ?? null, timer: null, busy: false, resumable });
    }
  }
  return rt.autodump as Map<string, DumpWatch>;
}

/** status of the watch `key` (a mint for the plain auto-dump, `<mint>#<taskId>` for task watchers) */
export function autodumpStatus(key: string): AutoDumpStatus {
  const w = registry().get(key);
  const mint = w?.mint ?? key.split("#")[0];
  if (!w) return { mint, armed: false, percent: null, mcUsd: null, delaySec: null, firesAt: null, config: null, armedAt: null, lastMcUsd: null, firedAt: null, jobId: null, externalVolumeSol: null };
  const delaySec = w.config.afterSec ?? null;
  return {
    mint,
    armed: w.timer !== null,
    resumable: w.resumable || undefined,
    percent: w.config.percent,
    mcUsd: w.config.mcUsd ?? null,
    delaySec,
    firesAt: delaySec ? w.armedAt + delaySec * 1000 : null,
    config: w.config,
    armedAt: w.armedAt,
    lastMcUsd: w.lastMcUsd,
    firedAt: w.firedAt,
    jobId: w.jobId,
    externalVolumeSol: w.config.externalVolumeSol ? Math.round(w.externalVolumeSol * 1e6) / 1e6 : null,
  };
}

export function autodumpGet(key: string): DumpWatch | undefined {
  return registry().get(key);
}

/** SOL this app's wallets traded on `mint` since `since` (buys + sells, from the journal) */
function ownVolumeSince(mint: string, since: number): number {
  return store()
    .activity.filter((a) => a.mint === mint && a.at >= since && a.data && typeof a.data.solTotal === "number")
    .reduce((s, a) => s + (a.data!.solTotal as number), 0);
}

/** arm a watch; `key` defaults to the mint (the launch/BRIEF auto-dump). Re-arming a key replaces it. */
export function armAutodump(mint: string, config: WatchConfig, wallets: string[], onFire?: DumpWatch["onFire"], key: string = mint): AutoDumpStatus {
  const st = store();
  if (config.delaySec && !config.afterSec) config = { ...config, afterSec: config.delaySec };
  if (!config.mcUsd && !config.afterSec && !config.externalVolumeSol) throw new HttpError(400, "Auto-dump needs at least one trigger: mcUsd, delaySec (afterSec) or externalVolumeSol.");
  const percent = Math.max(1, Math.min(100, Math.round(Number(config.percent) || 100)));
  const action = config.action === "notify" ? "notify" : "sell";
  const ws = action === "sell" ? vaultWallets(wallets) : wallets.map((address) => ({ address }));
  if (action === "sell" && ws.length === 0) throw new HttpError(400, "Auto-dump needs at least one wallet.");
  disarmAutodump(key, true);
  const w: DumpWatch = {
    key,
    mint,
    config: { ...config, action, percent, wallets: ws.map((x) => x.address) },
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
  registry().set(key, w);
  saveRuntimeSoon();
  const what = config.label ?? (action === "notify" ? "Activity watch" : "Auto-dump");
  logActivity(st, { kind: "autodump", ok: true, message: `${what} armed on ${mint.slice(0, 6)}…: ${action === "sell" ? `${percent}%` : "notify"}${config.mcUsd ? ` at MC ≥ $${config.mcUsd}` : ""}${config.afterSec ? ` after ${config.afterSec}s` : ""}${config.externalVolumeSol ? ` when external volume ≥ ${config.externalVolumeSol} SOL` : ""}`, mint, wallets: w.wallets });
  void tick(w);
  return autodumpStatus(key);
}

export function disarmAutodump(key: string, quiet = false): AutoDumpStatus {
  const w = registry().get(key);
  if (w?.timer) {
    clearInterval(w.timer);
    w.timer = null;
    if (!quiet) logActivity(store(), { kind: "autodump", ok: true, message: `${w.config.label ?? "Auto-dump"} disarmed on ${w.mint.slice(0, 6)}…`, mint: w.mint });
  }
  if (w?.resumable) w.resumable = false;
  saveRuntimeSoon();
  return autodumpStatus(key);
}

/** every watch on a mint whose key starts with `<mint>#` (task watchers) — disarmed when the launch stops */
export function disarmTaskWatches(mint: string): void {
  for (const w of registry().values()) if (w.mint === mint && w.key !== mint && w.timer) disarmAutodump(w.key, true);
}

/** re-arm a watcher restored after a restart with its saved config (the delay trigger restarts from now) */
export function resumeAutodump(key: string): AutoDumpStatus {
  const w = registry().get(key);
  if (!w || !w.resumable) throw new HttpError(409, "Nothing to resume: this auto-dump was not restored from a restart (arm it instead).");
  const { wallets: _w, ...config } = w.config;
  void _w;
  return armAutodump(w.mint, config, w.wallets, undefined, key);
}

export const AUTODUMP_RESTORE_NOTE = RESTORE_NOTE;

/* one curve read per mint per 1.5 s, shared by every watch on that mint */
type CurveRead = Awaited<ReturnType<typeof fetchCurve>>;
function curveCache(): Map<string, { at: number; p: Promise<CurveRead> }> {
  const rt = store().runtime;
  if (!rt.autodumpCurves) rt.autodumpCurves = new Map();
  return rt.autodumpCurves as Map<string, { at: number; p: Promise<CurveRead> }>;
}
function readCurveShared(mint: string): Promise<CurveRead> {
  const c = curveCache();
  const have = c.get(mint);
  if (have && Date.now() - have.at < 1500) return have.p;
  const p = fetchCurve(readConn(), new PublicKey(mint)).catch(() => null);
  c.set(mint, { at: Date.now(), p });
  return p;
}

async function tick(w: DumpWatch): Promise<void> {
  if (w.busy || w.timer === null) return;
  w.busy = true;
  try {
    const found = await readCurveShared(w.mint);
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
    if (w.timer === null) return;
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
  saveRuntimeSoon();
  const st = store();
  const what = w.config.label ?? (w.config.action === "notify" ? "Activity watch" : "Auto-dump");
  if (/migrated/.test(reason) || w.config.action === "notify") {
    logActivity(st, { kind: "autodump", ok: w.config.action === "notify", message: `${what} on ${w.mint.slice(0, 6)}… ${w.config.action === "notify" ? "fired" : "cancelled"}: ${reason}`, mint: w.mint });
    w.onFire?.(reason, null);
    return;
  }
  const job = jobNew("autodump", w.wallets.length, `${what} ${w.config.percent}% · ${w.mint.slice(0, 6)}… (${reason})`);
  job.extra = { mint: w.mint, reason, percent: w.config.percent, key: w.key };
  w.jobId = job.id;
  logActivity(st, { kind: "autodump", ok: true, message: `${what} fired on ${w.mint.slice(0, 6)}…: ${reason}`, mint: w.mint, wallets: w.wallets, jobId: job.id });
  const bundle = !!w.config.bundle;
  jobRun(job, async (j) => {
    await sellWithWallets({ mint: w.mint, wallets: w.wallets, percent: w.config.percent, slippageBps: st.settings.slippageBps, cuPrice: st.settings.cuPrice, tipLamports: bundle ? tipLamportsFor(st.settings.tipSol) : tipLamportsFor(undefined), bundle, job: j, kind: "autodump" });
  });
  w.onFire?.(reason, job.id);
}
