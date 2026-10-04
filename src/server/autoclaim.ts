/* Auto-claim watcher: one per mint, module-level setInterval (≥ 5 min) that reads the creator vault of the mint's
 * creator ONCE per tick (a single getMultipleAccountsInfo) and, when claimable + cashback ≥ minSol, runs the shared
 * claim path (fees.ts) — pump.fun's collect_creator_fee pays the vault out to the CREATOR account itself, i.e. the dev
 * wallet that launched the token; the payer (the creator when it can pay, else the richest vault wallet) only signs.
 * Guards: never claims when the creator is not a vault wallet (the SOL would go to a stranger, we would pay the fee),
 * never while the vault is locked (nothing can sign), never twice at once. Armed by a launch request (default on,
 * Settings.autoClaimRewards) or by POST /api/dev/autoclaim — any mint whose creator is a vault wallet, CTO included.
 * Persisted in runtime.json; restored watchers come back disarmed + resumable like every other loop here. */
import type { AutoClaimRequestConfig, AutoClaimStatus } from "@/lib/types";
import { AUTO_CLAIM_DEFAULTS } from "@/lib/types";
import { HttpError, intIn, lamportsOf, solString } from "./api";
import { creatorOf, readCreatorFees, runClaimJob } from "./fees";
import { registerRuntimeProducer, restoreSection, saveRuntimeSoon } from "./persist";
import { logActivity, store } from "./store";

export type ClaimWatch = {
  mint: string;
  creator: string | null;
  minLamports: bigint;
  intervalSec: number;
  armedAt: number | null;
  lastCheckAt: number | null;
  lastClaimAt: number | null;
  claimedLamports: bigint;
  claims: number;
  pendingLamports: bigint | null;
  creatorIsMine: boolean | null;
  error: string | null;
  jobId: string | null;
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  claiming: boolean;
  /** restored from runtime.json after a restart: disarmed until POST {action:"resume"} */
  resumable?: boolean;
};

type SavedWatch = { mint: string; creator: string | null; minSol: string; intervalSec: number; armedAt: number | null; lastCheckAt: number | null; lastClaimAt: number | null; claimedSol: string; claims: number; pendingSol: string | null; jobId: string | null; armed: boolean };

function registry(): Map<string, ClaimWatch> {
  const rt = store().runtime;
  if (!rt.autoclaim) {
    const map = new Map<string, ClaimWatch>();
    rt.autoclaim = map;
    registerRuntimeProducer("autoclaims", () =>
      [...map.values()].map((w): SavedWatch => ({ mint: w.mint, creator: w.creator, minSol: solString(w.minLamports), intervalSec: w.intervalSec, armedAt: w.armedAt, lastCheckAt: w.lastCheckAt, lastClaimAt: w.lastClaimAt, claimedSol: solString(w.claimedLamports), claims: w.claims, pendingSol: w.pendingLamports === null ? null : solString(w.pendingLamports), jobId: w.jobId, armed: w.timer !== null })),
    );
    for (const sv of restoreSection<SavedWatch[]>("autoclaims") ?? []) {
      if (!sv?.mint) continue;
      map.set(sv.mint, {
        mint: sv.mint,
        creator: sv.creator ?? null,
        minLamports: safeLamports(sv.minSol),
        intervalSec: clampInterval(sv.intervalSec),
        armedAt: sv.armedAt ?? null,
        lastCheckAt: sv.lastCheckAt ?? null,
        lastClaimAt: sv.lastClaimAt ?? null,
        claimedLamports: safeLamports(sv.claimedSol, BigInt(0)),
        claims: sv.claims ?? 0,
        pendingLamports: sv.pendingSol === null || sv.pendingSol === undefined ? null : safeLamports(sv.pendingSol, BigInt(0)),
        creatorIsMine: null,
        error: null,
        jobId: sv.jobId ?? null,
        timer: null,
        busy: false,
        claiming: false,
        resumable: !!sv.armed,
      });
    }
  }
  return rt.autoclaim as Map<string, ClaimWatch>;
}

function safeLamports(s: unknown, fallback = lamportsOf(AUTO_CLAIM_DEFAULTS.minSol)): bigint {
  try {
    return lamportsOf(s, "minSol", true);
  } catch {
    return fallback;
  }
}
function clampInterval(n: unknown): number {
  return intIn(n, AUTO_CLAIM_DEFAULTS.minIntervalSec, AUTO_CLAIM_DEFAULTS.maxIntervalSec, AUTO_CLAIM_DEFAULTS.intervalSec, "intervalSec");
}

/** validate a launch/route config → { minSol, intervalSec } (readable 400s) */
export function normalizeAutoClaim(cfg: Partial<AutoClaimRequestConfig> | undefined): { minSol: string; intervalSec: number } {
  const minLamports = cfg?.minSol === undefined || cfg.minSol === "" ? lamportsOf(AUTO_CLAIM_DEFAULTS.minSol) : lamportsOf(cfg.minSol, "autoClaim.minSol");
  if (minLamports < BigInt(1_000_000)) throw new HttpError(400, "autoClaim.minSol: at least 0.001 SOL (a claim costs ~0.000005 SOL in fees).");
  const intervalSec = intIn(cfg?.intervalSec, AUTO_CLAIM_DEFAULTS.minIntervalSec, AUTO_CLAIM_DEFAULTS.maxIntervalSec, AUTO_CLAIM_DEFAULTS.intervalSec, "autoClaim.intervalSec");
  if (cfg?.intervalSec !== undefined && Number(cfg.intervalSec) < AUTO_CLAIM_DEFAULTS.minIntervalSec) throw new HttpError(400, `autoClaim.intervalSec: at least ${AUTO_CLAIM_DEFAULTS.minIntervalSec} s (one vault read per tick; public RPCs rate-limit faster polling).`);
  return { minSol: solString(minLamports), intervalSec };
}

export function autoclaimStatus(mint: string): AutoClaimStatus {
  const w = registry().get(mint);
  if (!w) return { mint, creator: null, creatorIsMine: null, enabled: false, minSol: AUTO_CLAIM_DEFAULTS.minSol, intervalSec: AUTO_CLAIM_DEFAULTS.intervalSec, armedAt: null, lastCheckAt: null, lastClaimAt: null, claimedSol: "0", claims: 0, pendingSol: null, error: null, jobId: null, claiming: false };
  return {
    mint,
    creator: w.creator,
    creatorIsMine: w.creatorIsMine,
    enabled: w.timer !== null,
    resumable: w.resumable || undefined,
    minSol: solString(w.minLamports),
    intervalSec: w.intervalSec,
    armedAt: w.armedAt,
    lastCheckAt: w.lastCheckAt,
    lastClaimAt: w.lastClaimAt,
    claimedSol: solString(w.claimedLamports),
    claims: w.claims,
    pendingSol: w.pendingLamports === null ? null : solString(w.pendingLamports),
    error: w.error,
    jobId: w.jobId,
    claiming: w.claiming,
  };
}

/** null when no watcher was ever armed on this mint (LaunchState.autoClaim, launches rows) */
export function autoclaimStatusOrNull(mint: string): AutoClaimStatus | null {
  return registry().has(mint) ? autoclaimStatus(mint) : null;
}

/** arm (or re-arm with new values — totals are kept) the watcher of `mint`; `creator` skips the curve read when known */
export function armAutoclaim(mint: string, cfg: Partial<AutoClaimRequestConfig> & { creator?: string }): AutoClaimStatus {
  const { minSol, intervalSec } = normalizeAutoClaim(cfg);
  const st = store();
  const prev = registry().get(mint);
  if (prev?.timer) clearInterval(prev.timer);
  const w: ClaimWatch = {
    mint,
    creator: cfg.creator ?? prev?.creator ?? st.launches.find((l) => l.mint === mint)?.dev ?? null,
    minLamports: lamportsOf(minSol),
    intervalSec,
    armedAt: Date.now(),
    lastCheckAt: prev?.lastCheckAt ?? null,
    lastClaimAt: prev?.lastClaimAt ?? null,
    claimedLamports: prev?.claimedLamports ?? BigInt(0),
    claims: prev?.claims ?? 0,
    pendingLamports: prev?.pendingLamports ?? null,
    creatorIsMine: prev?.creatorIsMine ?? null,
    error: null,
    jobId: prev?.jobId ?? null,
    timer: null,
    busy: false,
    claiming: false,
  };
  w.timer = setInterval(() => void tick(w), intervalSec * 1000);
  registry().set(mint, w);
  saveRuntimeSoon();
  logActivity(st, { kind: "autoclaim", ok: true, message: `Auto-claim armed on ${mint.slice(0, 6)}…: creator fees → dev wallet when ≥ ${minSol} SOL, checked every ${intervalSec}s`, mint, wallets: w.creator ? [w.creator] : undefined });
  void tick(w);
  return autoclaimStatus(mint);
}

export function disarmAutoclaim(mint: string, quiet = false): AutoClaimStatus {
  const w = registry().get(mint);
  if (w?.timer) {
    clearInterval(w.timer);
    w.timer = null;
    if (!quiet) logActivity(store(), { kind: "autoclaim", ok: true, message: `Auto-claim disarmed on ${mint.slice(0, 6)}…`, mint });
  }
  if (w?.resumable) w.resumable = false;
  saveRuntimeSoon();
  return autoclaimStatus(mint);
}

/** re-arm a watcher restored after a restart with its saved values */
export function resumeAutoclaim(mint: string): AutoClaimStatus {
  const w = registry().get(mint);
  if (!w || !w.resumable) throw new HttpError(409, "Nothing to resume: this auto-claim was not restored from a restart (arm it instead).");
  w.resumable = false;
  return armAutoclaim(mint, { minSol: solString(w.minLamports), intervalSec: w.intervalSec, creator: w.creator ?? undefined });
}

/** one tick = one vault read, then maybe one claim; exported for tests (`force` ignores the running timer) */
export async function tickAutoclaim(mint: string): Promise<AutoClaimStatus> {
  const w = registry().get(mint);
  if (!w) throw new HttpError(404, "No auto-claim watcher on this mint.");
  await tick(w, true);
  return autoclaimStatus(mint);
}

async function tick(w: ClaimWatch, force = false): Promise<void> {
  if (w.busy || (w.timer === null && !force)) return;
  w.busy = true;
  const st = store();
  try {
    if (!w.creator) {
      w.creator = await creatorOf(w.mint);
      if (!w.creator) {
        w.error = "Creator unknown: the bonding curve could not be read (RPC) and this mint was not launched here.";
        return;
      }
    }
    const creator = w.creator;
    let fees: Awaited<ReturnType<typeof readCreatorFees>>;
    try {
      fees = await readCreatorFees([creator]);
    } catch (e) {
      w.error = e instanceof Error ? e.message : String(e);
      return;
    }
    w.lastCheckAt = Date.now();
    const f = fees[0];
    const pending = f ? f.claimable + f.cashback : BigInt(0);
    w.pendingLamports = pending;
    const unlocked = st.sol.unlocked && !!st.passphrase;
    if (!unlocked) {
      // the vault list is empty while locked: ownership is unknown, nothing can sign
      w.creatorIsMine = st.launches.some((l) => l.mint === w.mint && l.dev === creator) ? true : null;
      w.error = `Vault locked: ${solString(pending)} SOL pending, unlock the vault to let auto-claim sign.`;
      return;
    }
    w.creatorIsMine = st.sol.wallets.some((x) => x.address === creator);
    if (!w.creatorIsMine) {
      w.error = `Creator ${creator.slice(0, 4)}…${creator.slice(-4)} is not in your vault — auto-claim never claims for a creator it cannot sign for (the SOL would go to it).`;
      return;
    }
    if (pending < w.minLamports) {
      w.error = null;
      return;
    }
    if (w.claiming) return;
    w.claiming = true;
    saveRuntimeSoon();
    const { job, done } = runClaimJob([creator], { mint: w.mint, cuPrice: st.settings.cuPrice, kind: "claim", preferPayer: creator, messagePrefix: "Auto-claim", label: `Auto-claim · ${solString(pending)} SOL → ${creator.slice(0, 4)}…${creator.slice(-4)}`, fees });
    w.jobId = job.id;
    const r = await done;
    w.claiming = false;
    if (r.ok) {
      w.claimedLamports += lamportsOf(r.totalSol, "totalSol", true);
      w.claims++;
      w.lastClaimAt = Date.now();
      w.error = null;
      if (r.pendingAfterSol !== null) w.pendingLamports = lamportsOf(r.pendingAfterSol, "pendingAfterSol", true);
    } else w.error = r.error ?? "claim not confirmed";
  } catch (e) {
    w.error = e instanceof Error ? e.message : String(e);
  } finally {
    w.busy = false;
    w.claiming = false;
    saveRuntimeSoon();
  }
}
