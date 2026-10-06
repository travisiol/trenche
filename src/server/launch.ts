/* Launch pipeline: /api/launch/prepare (IPFS metadata + mint keypair kept in memory) and
 * /api/launch/execute with the Block X task model (bundle · sniper · buy · volume · wash), auto-dump
 * and sell-on-external. Live state is streamed on /api/launch/[id]/stream. */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { generateMint } from "@/engine/solana/pump/create.js";
import { base58Encode, parseSolanaKey } from "@/engine/solana/keys.js";
import { executeLaunch as engineExecuteLaunch, launchBundle, prepareLaunch, type LaunchPrep } from "@/engine/solana/pump/launch.js";
import { uploadPumpMetadata } from "@/engine/solana/pump/metadata.js";
import type { BuyRow } from "@/engine/solana/pump/math.js";
import type {
  BundleTask,
  LaunchExecuteRequest,
  LaunchExecuteResponse,
  LaunchPrepareRequest,
  LaunchPrepareResponse,
  LaunchRecord,
  LaunchState,
  LaunchStep,
  LaunchStreamEvent,
  LaunchTask,
  LaunchTaskState,
  LaunchTaskType,
  LaunchWarmRequest,
  LaunchWarmResponse,
  SniperTask,
  TradeTask,
  WashPair,
  WashTask,
} from "@/lib/types";
import { TASK_DEFAULTS, TASK_LIMITS } from "@/lib/types";
import { HttpError, intIn, lamportsOf, numIn, sleep, solString } from "./api";
import { armAutodump, autodumpStatus, disarmAutodump, disarmTaskWatches } from "./autodump";
import { armAutoclaim, autoclaimStatusOrNull, normalizeAutoClaim } from "./autoclaim";
import { buyWithWallets, getAccountsChunked, groupWallets, labelOf, readConn, requireUnlocked, sendConn, tipLamportsFor, vaultWallets } from "./engine";
import { blockhashNow, touchHot } from "./hot";
import { watchSignature } from "./sigsub";
import { jobNew, jobNote, jobPush, jobRun } from "./jobs";
import { registerRuntimeProducer, RESTORE_NOTE, restoreSection, saveRuntimeSoon } from "./persist";
import { solPriceCached } from "./price";
import { syncPumpCluster } from "./pumpcluster";
import { checkCreateOnChain, reconcileLaunches } from "./reconcile";
import { fetchUriJson, imageUrl } from "./metadata";
import { ipfsToHttp } from "@/engine/solana/pump/metadata.js";
import { isDevnet, logActivity, saveLaunches, store, track, type Job, type PendingMint } from "./store";
import { loops, TradeLoop, type SavedLoop } from "./tradeloop";
import { resolveWashPairs, washPairs } from "./wash";
import { markDraftLaunched } from "./drafts";
import { awaitWarmTable, deactivateLaunchTable, ensureStaticLookupTable, staticLookupTable, sweepLaunchTables, takeWarmTable, warmLaunchTable, warmTableEtaMs, warmTableFor, warmTableStatus } from "./alt";
import { grindVanity, isReserved, peekReserved, takeReserved, unuseReserved } from "./vanity";

/* ------------------------------------------------------------------ prepare */

export async function prepareLaunchMeta(req: LaunchPrepareRequest): Promise<LaunchPrepareResponse> {
  requireUnlocked();
  const st = store();
  if (req.quote !== undefined && String(req.quote).toUpperCase() !== "SOL") throw new HttpError(400, `Quote "${String(req.quote)}" is not supported: DONCHAIN launches on pump.fun are quoted in SOL only.`);
  if (req.launchpad !== undefined && String(req.launchpad).toLowerCase() !== "pumpfun") throw new HttpError(400, `Launchpad "${String(req.launchpad)}" is not supported: only pump.fun.`);
  const name = String(req.name ?? "").trim().slice(0, 32);
  const symbol = String(req.symbol ?? "").trim().slice(0, 10);
  if (!name) throw new HttpError(400, "name required.");
  if (!symbol) throw new HttpError(400, "symbol required.");
  const m = String(req.imageDataUrl ?? "").match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new HttpError(400, "imageDataUrl must be a base64 data URL (data:image/png;base64,…).");
  const imageBase64 = m[2].replace(/\s+/g, "");
  if (imageBase64.length > 6_000_000) throw new HttpError(400, "Image too large (4 MB max).");
  // mint keypair: imported (Block X "Import your own mint keypair") > reserved ("Fetch mint address") > vanity grind > random
  const suffix = String(req.vanitySuffix ?? req.vanity ?? "").trim();
  if (suffix && !/^[1-9A-HJ-NP-Za-km-z]{1,6}$/.test(suffix)) throw new HttpError(400, "vanitySuffix: 1–6 base58 characters (no 0, O, I, l).");
  const endsWithSuffix = (addr: string) => !suffix || addr.toLowerCase().endsWith(suffix.toLowerCase());
  let keypair: import("@solana/web3.js").Keypair;
  let mintSource: LaunchPrepareResponse["mintSource"];
  if (req.mintSecret !== undefined && String(req.mintSecret).trim() !== "") {
    try {
      keypair = parseSolanaKey(String(req.mintSecret).trim());
    } catch {
      throw new HttpError(400, "mintSecret: not a valid keypair (base58 secret key or [1,2,3,…] byte array expected).");
    }
    if (!endsWithSuffix(keypair.publicKey.toBase58())) throw new HttpError(400, `The imported mint ${keypair.publicKey.toBase58()} does not end with "${suffix}".`);
    // prepared again (ahead of the click, then on it) is fine; launched is not
    if (registry().has(keypair.publicKey.toBase58())) throw new HttpError(409, "This mint keypair was already launched here.");
    mintSource = "imported";
  } else if (req.mint !== undefined && String(req.mint).trim() !== "" && !isReserved(String(req.mint).trim()) && pendings().has(String(req.mint).trim())) {
    // a mint prepared earlier (ahead of the click, then the metadata changed): same address, its warm lookup table stays valid
    const addr = String(req.mint).trim();
    if (registry().has(addr)) throw new HttpError(409, "This mint was already launched.");
    if (!endsWithSuffix(addr)) throw new HttpError(400, `The prepared mint ${addr} does not end with "${suffix}".`);
    keypair = pendings().get(addr)!.keypair;
    mintSource = "generated";
  } else if (req.mint !== undefined && String(req.mint).trim() !== "") {
    const addr = String(req.mint).trim();
    if (!endsWithSuffix(addr)) throw new HttpError(400, `The reserved mint ${addr} does not end with "${suffix}".`);
    // a reservation marked used by a launch that never broadcast (refused at a guard, server restarted…) is still free:
    // only a mint in the launch registry has really been created on-chain by this server
    if (!registry().has(addr)) unuseReserved(addr);
    // ahead of the click the reservation is only read: execute marks it used (a dialog closed without launching keeps it)
    keypair = req.warm ? peekReserved(addr) : takeReserved(addr);
    mintSource = "reserved";
  } else if (suffix) {
    const r = await grindVanity(suffix, { caseSensitive: true, timeoutMs: 180_000 });
    if (!r) throw new HttpError(504, `No address ending with "${suffix}" found in 90 s. Reserve one first with POST /api/launch/mint (it runs as a job) or use a shorter suffix.`);
    keypair = r.keypair;
    mintSource = "vanity";
  } else {
    keypair = generateMint();
    mintSource = "generated";
  }
  const mint = keypair.publicKey.toBase58();
  // the launch's lookup table starts now (it needs ~13 s to be rooted), in parallel with the IPFS upload
  if (req.launch) warmFromDraft(keypair.publicKey, req.launch);
  const meta = {
    name,
    symbol,
    description: req.description ? String(req.description).slice(0, 1000) : undefined,
    imageBase64,
    imageType: m[1],
    twitter: req.twitter ? String(req.twitter) : undefined,
    telegram: req.telegram ? String(req.telegram) : undefined,
    website: req.website ? String(req.website) : undefined,
  };
  // same metadata = same upload (prepared ahead of the click, then again on it): one IPFS round trip, not two
  const up = await uploadOnce(meta);
  const uri = up.uri;
  const pm = pendings();
  const pending: PendingMint = { keypair, uri, name, symbol, image: up.image, at: Date.now(), reserved: mintSource === "reserved" };
  pm.set(mint, pending);
  // the image URL (read back from the metadata JSON, up to 5 s on a slow gateway) never holds the launch: filled in later
  if (!up.image)
    void up.imageP.then((image) => {
      if (!image) return;
      pending.image = image;
      const rec = st.launches.find((l) => l.mint === mint);
      if (rec && !rec.image) {
        rec.image = image;
        saveLaunches(st);
      }
      saveRuntimeSoon();
    });
  // keep memory bounded
  if (pm.size > 50) {
    const oldest = [...pm.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) pm.delete(oldest[0]);
  }
  saveRuntimeSoon();
  logActivity(st, { kind: "launch", ok: true, message: `Launch prepared: ${symbol} · mint ${mintSource} · metadata ${uri}`, mint, data: { uri, mintSource } });
  return { uri, mint, name, symbol, mintSource };
}

type UploadMeta = Parameters<typeof uploadPumpMetadata>[0];
type Upload = { uri: string; image: string | null; imageP: Promise<string | null> };
const uploads = globalThis as unknown as { __trenchUploads?: Map<string, Promise<Upload>> };

/** IPFS upload once per identical metadata (in flight or done, 30 entries): a prepare ahead of the click and the
 *  click's own prepare share it. A failed upload is forgotten (the next prepare retries). */
function uploadOnce(meta: UploadMeta): Promise<Upload> {
  const m = (uploads.__trenchUploads ??= new Map());
  const key = createHash("sha256").update(JSON.stringify(meta)).digest("hex");
  let p = m.get(key);
  if (!p) {
    p = uploadPumpMetadata(meta).then((uri) => {
      const u: Upload = { uri, image: null, imageP: Promise.resolve(null) };
      u.imageP = fetchUriJson(uri, 5000)
        .then((j) => (j && typeof j.image === "string" ? imageUrl(ipfsToHttp(j.image)) : null))
        .catch(() => null)
        .then((image) => (u.image = image));
      return u;
    });
    m.set(key, p);
    p.catch(() => m.delete(key));
    if (m.size > 30) m.delete(m.keys().next().value!);
  }
  return p;
}

/** the bundle wallets that will buy inside the create (first INLINE_MAX of the bundle tasks, same order as runLaunch) */
function inlineBuyers(req: Pick<LaunchExecuteRequest, "tasks">, dev: string): string[] {
  const tasks = normalizeTasks({ tasks: req.tasks ?? [] }, dev);
  return tasks.flatMap((t) => (t.type === "bundle" ? t.wallets : [])).slice(0, INLINE_MAX);
}

/** start the lookup table of a coming launch (no bundle wallet → no table needed). Never throws: a draft that is not
 *  launchable yet simply gets no table. */
function warmFromDraft(mint: PublicKey, w: LaunchWarmRequest): ReturnType<typeof warmLaunchTable> | null {
  try {
    const st = store();
    if (!st.sol.unlocked) return null;
    const dev = String(w.devWallet ?? "").trim();
    if (!dev || registry().has(mint.toBase58())) return null;
    vaultWallets([dev]);
    const buyers = inlineBuyers(w, dev);
    if (!buyers.length) return null;
    if (!isDevnet(st.settings)) warmStaticFrom(dev);
    else ensureStaticLookupTable(readConn(), st.sol.keypair(dev));
    return warmLaunchTable(readConn(), st.sol.keypair(dev), mint, buyers.map((b) => new PublicKey(b)));
  } catch {
    return null;
  }
}

/** mainnet static table: built by the richest vault wallet (≈0.008 SOL once), else by the dev */
function warmStaticFrom(dev: string): void {
  const st = store();
  const bal = st.balances?.map ?? {};
  const best = st.sol.wallets.map((w) => [w.address, Number(bal[w.address] ?? 0)] as const).sort((a, b) => b[1] - a[1])[0];
  ensureStaticLookupTable(readConn(), st.sol.keypair(best && best[1] > 0.02 ? best[0] : dev));
}

/** POST /api/launch/warm: the draft knows its mint (reserved / imported / prepared), dev and bundle wallets — the
 *  launch's lookup table is built now, so it is rooted when Launch is clicked */
export function warmLaunch(req: LaunchWarmRequest): LaunchWarmResponse {
  requireUnlocked();
  let mint: PublicKey | null = null;
  if (req.mintSecret && String(req.mintSecret).trim()) {
    try {
      mint = parseSolanaKey(String(req.mintSecret).trim()).publicKey;
    } catch {
      throw new HttpError(400, "mintSecret: not a valid keypair.");
    }
  } else if (req.mint && String(req.mint).trim()) {
    try {
      mint = new PublicKey(String(req.mint).trim());
    } catch {
      throw new HttpError(400, "mint: not an address.");
    }
  }
  if (!mint) return { mint: null, table: warmTableStatus(null) };
  const w = warmFromDraft(mint, req);
  return { mint: mint.toBase58(), table: warmTableStatus(w) };
}

/* ------------------------------------------------------------------ runtime */

/** `activitySol` = "Stop on activity" / "Sell all on external" threshold in SOL (null = off) */
export type NormTask =
  | { id: string; type: "bundle"; wallets: string[]; amounts: Map<string, bigint>; slippageBps: number; tipLamports: bigint; autoRetryCount: number; autoStart: boolean; activitySol: number | null }
  | { id: string; type: "sniper"; wallets: string[]; amounts: Map<string, bigint>; slippageBps: number; tipLamports: bigint; autoRetryCount: number; minDelayMs: number; maxDelayMs: number; autoStart: boolean; activitySol: number | null }
  | { id: string; type: "buy" | "volume"; wallets: string[]; loopCfg: Omit<ConstructorParameters<typeof TradeLoop>[0], "id" | "taskId" | "mint" | "label" | "onChange" | "type"> & { type: "buy" | "volume" }; autoStart: boolean; activitySol: number | null }
  | { id: string; type: "wash"; wallets: string[]; pairs: WashPair[]; minDelayMs: number; maxDelayMs: number; autoStart: boolean };

export type LaunchRun = {
  state: LaunchState;
  job: Job;
  subs: Set<(ev: LaunchStreamEvent) => void>;
  tasks: NormTask[];
  loops: Map<string, TradeLoop>;
  taskStates: Map<string, LaunchTaskState>;
  record: LaunchRecord;
  /** taskId → reason, set when a "Stop on activity" watch (or a stop action) cancelled a one-shot task */
  cancelled: Map<string, string>;
};

/** watch key of a task's activity watcher (autodump registry) */
const watchKey = (mint: string, taskId: string) => `${mint}#${taskId}`;
const DEV_SELL_KEY = (mint: string) => `${mint}#dev`;

/* ------------------------------------------------------------------ persistence (runtime.json) */

type SavedTask =
  | { id: string; type: "bundle"; wallets: string[]; autoStart: boolean; amounts: Record<string, string>; slippageBps: number; tipLamports: string; autoRetryCount: number; activitySol: number | null }
  | { id: string; type: "sniper"; wallets: string[]; autoStart: boolean; amounts: Record<string, string>; slippageBps: number; tipLamports: string; autoRetryCount: number; minDelayMs: number; maxDelayMs: number; activitySol: number | null }
  | { id: string; type: "buy" | "volume"; wallets: string[]; autoStart: boolean; loopCfg: Omit<SavedLoop["cfg"], "id" | "taskId" | "mint" | "label">; activitySol: number | null }
  | { id: string; type: "wash"; wallets: string[]; autoStart: boolean; pairs: WashPair[]; minDelayMs: number; maxDelayMs: number };
type SavedRun = { state: LaunchState; tasks: SavedTask[]; taskStates: LaunchTaskState[]; loops: Record<string, SavedLoop>; jobId: string };
type SavedPending = { mint: string; secret: string; uri: string; name: string; symbol: string; image: string | null; at: number };

function serializeRun(run: LaunchRun): SavedRun {
  return {
    state: { ...run.state, autoDump: null, autoDevSell: null, autoClaim: null, tasks: [], steps: run.state.steps.slice(-200) },
    tasks: run.tasks.map((t): SavedTask => {
      if (t.type === "bundle") return { id: t.id, type: t.type, wallets: t.wallets, autoStart: t.autoStart, amounts: Object.fromEntries([...t.amounts].map(([k, v]) => [k, v.toString()])), slippageBps: t.slippageBps, tipLamports: t.tipLamports.toString(), autoRetryCount: t.autoRetryCount, activitySol: t.activitySol };
      if (t.type === "sniper") return { id: t.id, type: t.type, wallets: t.wallets, autoStart: t.autoStart, amounts: Object.fromEntries([...t.amounts].map(([k, v]) => [k, v.toString()])), slippageBps: t.slippageBps, tipLamports: t.tipLamports.toString(), autoRetryCount: t.autoRetryCount, minDelayMs: t.minDelayMs, maxDelayMs: t.maxDelayMs, activitySol: t.activitySol };
      if (t.type === "buy" || t.type === "volume") {
        const c = t.loopCfg;
        return { id: t.id, type: t.type, wallets: t.wallets, autoStart: t.autoStart, loopCfg: { ...c, minLamports: c.minLamports.toString(), maxLamports: c.maxLamports.toString(), tipLamports: c.tipLamports.toString() }, activitySol: t.activitySol };
      }
      const w = t as Extract<NormTask, { type: "wash" }>;
      return { id: w.id, type: "wash", wallets: w.wallets, autoStart: w.autoStart, pairs: w.pairs, minDelayMs: w.minDelayMs, maxDelayMs: w.maxDelayMs };
    }),
    taskStates: [...run.taskStates.values()],
    loops: Object.fromEntries([...run.loops].map(([id, l]) => [id, l.snapshot()])),
    jobId: run.job.id,
  };
}

function restoreRun(sv: SavedRun): LaunchRun | null {
  const st = store();
  if (!sv?.state?.mint || !Array.isArray(sv.tasks)) return null;
  const mint = sv.state.mint;
  const tasks: NormTask[] = sv.tasks.map((t) => {
    if (t.type === "bundle") return { id: t.id, type: t.type, wallets: t.wallets, autoStart: t.autoStart, amounts: new Map(Object.entries(t.amounts ?? {}).map(([k, v]) => [k, BigInt(v)])), slippageBps: t.slippageBps, tipLamports: BigInt(t.tipLamports ?? "0"), autoRetryCount: t.autoRetryCount ?? 0, activitySol: t.activitySol ?? null };
    if (t.type === "sniper") return { id: t.id, type: t.type, wallets: t.wallets, autoStart: t.autoStart, amounts: new Map(Object.entries(t.amounts ?? {}).map(([k, v]) => [k, BigInt(v)])), slippageBps: t.slippageBps, tipLamports: BigInt(t.tipLamports ?? "0"), autoRetryCount: t.autoRetryCount ?? 0, minDelayMs: t.minDelayMs ?? 0, maxDelayMs: t.maxDelayMs ?? 0, activitySol: t.activitySol ?? null };
    if (t.type === "buy" || t.type === "volume") {
      const c = t.loopCfg;
      return { id: t.id, type: t.type, wallets: t.wallets, autoStart: t.autoStart, loopCfg: { ...c, type: t.type, minLamports: BigInt(c.minLamports), maxLamports: BigInt(c.maxLamports), tipLamports: BigInt(c.tipLamports) }, activitySol: t.activitySol ?? null };
    }
    // older files (wallets → fresh wallets, no pairs) come back without pairs → the task reports an error at run time
    const w = t as Extract<SavedTask, { type: "wash" }>;
    return { id: w.id, type: "wash", wallets: w.wallets, autoStart: w.autoStart, pairs: Array.isArray(w.pairs) ? w.pairs : [], minDelayMs: w.minDelayMs ?? 0, maxDelayMs: w.maxDelayMs ?? 0 };
  });
  const record = st.launches.find((l) => l.mint === mint) ?? { mint, name: sv.state.name, symbol: sv.state.symbol, uri: null, image: null, dev: sv.state.dev, mode: sv.state.mode, at: sv.state.startedAt, createSignature: sv.state.createSignature, createConfirmed: !!sv.state.createConfirmed, createError: null, wallets: [sv.state.dev, ...tasks.flatMap((t) => t.wallets)], buysConfirmed: 0, buysTotal: 0, jobId: sv.jobId };
  const job: Job = st.jobs.get(sv.jobId) ?? { id: sv.jobId, kind: `launch-${sv.state.mode}`, label: `Launch ${sv.state.symbol}`, total: 0, completed: 0, sent: 0, failed: 0, steps: [], status: "stopped", cluster: st.settings.cluster, nextAt: 0, error: RESTORE_NOTE, extra: { mint }, startedAt: sv.state.startedAt, endedAt: Date.now(), stop: true };
  if (!st.jobs.has(job.id)) st.jobs.set(job.id, job);
  const state: LaunchState = { ...sv.state, tasks: [], autoDump: null, autoDevSell: null, autoClaim: null, restored: { at: Date.now(), note: RESTORE_NOTE } };
  if (state.status === "preparing" || state.status === "sending") {
    state.status = state.createConfirmed ? "live" : "failed";
    state.error = state.createConfirmed ? null : `Server restarted during the send. Create signature: ${state.createSignature ?? "none — check the dev wallet on the explorer before retrying"}.`;
  }
  state.steps.push({ at: Date.now(), phase: "info", ok: true, message: RESTORE_NOTE });
  const run: LaunchRun = { state, job, subs: new Set(), tasks, loops: new Map(), taskStates: new Map((sv.taskStates ?? []).map((t) => [t.id, t])), record, cancelled: new Map() };
  for (const [taskId, saved] of Object.entries(sv.loops ?? {})) {
    try {
      const loop = TradeLoop.restore(saved, (s) => emit(run, { type: "task_status", data: s }));
      run.loops.set(taskId, loop);
      loops().set(loop.cfg.id, loop);
    } catch {
      /* unreadable loop */
    }
  }
  for (const ts of run.taskStates.values()) {
    if (ts.status === "running" || ts.status === "paused") {
      ts.status = "stopped";
      ts.error = RESTORE_NOTE;
      ts.endedAt = Date.now();
    }
  }
  return run;
}

function registry(): Map<string, LaunchRun> {
  const rt = store().runtime;
  if (!rt.launches) {
    const map = new Map<string, LaunchRun>();
    rt.launches = map;
    registerRuntimeProducer("launches", () => [...map.values()].slice(-50).map(serializeRun));
    for (const sv of restoreSection<SavedRun[]>("launches") ?? []) {
      const run = restoreRun(sv);
      if (run) map.set(run.state.mint, run);
    }
    // startup reconcile: records whose create was sent but never confirmed (RPC 429 during the window) are re-checked
    setTimeout(() => void reconcileLaunches({ force: true }).catch(() => 0), 1500);
  }
  return rt.launches as Map<string, LaunchRun>;
}

/** pending mints (prepare → execute) also survive a restart: the mint keypair is worthless until the create lands */
function pendings(): Map<string, PendingMint> {
  const st = store();
  const rt = st.runtime;
  if (!rt.pendingsReady) {
    rt.pendingsReady = true;
    registerRuntimeProducer("pendingMints", () => [...st.pendingMints.entries()].map(([mint, p]): SavedPending => ({ mint, secret: base58Encode(p.keypair.secretKey), uri: p.uri, name: p.name, symbol: p.symbol, image: p.image, at: p.at })));
    for (const sv of restoreSection<SavedPending[]>("pendingMints") ?? []) {
      try {
        if (!st.pendingMints.has(sv.mint)) st.pendingMints.set(sv.mint, { keypair: parseSolanaKey(sv.secret), uri: sv.uri, name: sv.name, symbol: sv.symbol, image: sv.image, at: sv.at });
      } catch {
        /* unreadable entry */
      }
    }
  }
  return st.pendingMints;
}

export function launchGet(id: string): LaunchRun | undefined {
  return registry().get(id);
}

export function launchStateOf(run: LaunchRun): LaunchState {
  const devSell = autodumpStatus(DEV_SELL_KEY(run.state.mint));
  return { ...run.state, tasks: run.tasks.map((t) => taskState(run, t.id)), autoDump: autodumpStatus(run.state.mint), autoDevSell: devSell.armedAt ? devSell : null, autoClaim: autoclaimStatusOrNull(run.state.mint), steps: run.state.steps.slice(-200) };
}

export function subscribeLaunch(id: string, fn: (ev: LaunchStreamEvent) => void): () => void {
  const run = registry().get(id);
  if (!run) throw new HttpError(404, "Unknown launch (launch runs are kept in runtime.json; this id is not one of them).");
  run.subs.add(fn);
  fn({ type: "state", data: launchStateOf(run) });
  return () => run.subs.delete(fn);
}

function emit(run: LaunchRun, ev: LaunchStreamEvent): void {
  for (const fn of run.subs) {
    try {
      fn(ev);
    } catch {
      /* subscriber gone */
    }
  }
}

function step(run: LaunchRun, phase: LaunchStep["phase"], ok: boolean, message: string, extra: Partial<LaunchStep> = {}): void {
  const s: LaunchStep = { at: Date.now(), phase, ok, message, ...extra };
  run.state.steps.push(s);
  jobNote(run.job, message, { ok, phase, signature: s.signature ?? undefined });
  emit(run, { type: "step", data: s });
  saveRuntimeSoon();
}

/** the task's "Stop on activity" / "Sell all on external" watcher view, merged into its state */
function activityOf(run: LaunchRun, taskId: string): LaunchTaskState["activity"] {
  const n = run.tasks.find((x) => x.id === taskId);
  if (!n || n.type === "wash" || n.activitySol === null) return undefined;
  const w = autodumpStatus(watchKey(run.state.mint, taskId));
  return { thresholdSol: String(n.activitySol), externalVolumeSol: w.externalVolumeSol ?? 0, fired: !!w.firedAt };
}

function taskState(run: LaunchRun, taskId: string): LaunchTaskState {
  const loop = run.loops.get(taskId);
  if (loop) return { ...loop.state(), activity: activityOf(run, taskId) };
  const t = run.taskStates.get(taskId);
  if (t) return { ...t, activity: activityOf(run, taskId) };
  const n = run.tasks.find((x) => x.id === taskId)!;
  const total = n.type === "wash" ? n.pairs.reduce((s, p) => s + p.wash.length, 0) : n.type === "bundle" || n.type === "sniper" ? n.wallets.length : null;
  const s: LaunchTaskState = { id: n.id, type: n.type, status: "pending", wallets: n.wallets, done: 0, total, sent: 0, failed: 0, nextAt: 0, error: null, startedAt: null, endedAt: null, steps: [], pairs: n.type === "wash" ? n.pairs : undefined };
  run.taskStates.set(taskId, s);
  return { ...s, activity: activityOf(run, taskId) };
}

function setTask(run: LaunchRun, taskId: string, patch: Partial<LaunchTaskState>): LaunchTaskState {
  const s = Object.assign(taskState(run, taskId), patch);
  run.taskStates.set(taskId, s);
  emit(run, { type: "task_status", data: s });
  saveRuntimeSoon();
  return s;
}

/* ------------------------------------------------------------------ validate */

function expandWallets(t: LaunchTask, allowEmpty = false): string[] {
  const set = new Set<string>();
  for (const a of t.walletIds ?? []) set.add(String(a));
  for (const g of t.walletGroupIds ?? []) for (const a of groupWallets(String(g))) set.add(a);
  const list = [...set];
  if (list.length === 0 && !allowEmpty) throw new HttpError(400, `Task ${t.type}: no wallet (walletIds / walletGroupIds).`);
  if (list.length > TASK_LIMITS.maxWalletsPerTask) throw new HttpError(400, `Task ${t.type}: ${TASK_LIMITS.maxWalletsPerTask} wallets max.`);
  vaultWallets(list);
  return list;
}

/** "Stop on activity" / "Sell all on external" threshold: null when off, else SOL > 0 */
function activityThreshold(enabled: boolean | undefined, threshold: unknown, what: string): number | null {
  if (!enabled) return null;
  const n = Number(threshold);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${what}: the SOL threshold must be > 0 when enabled.`);
  return n;
}

/** task tip: explicit value, else the task default (0.0002 SOL); devnet → 0 (tipLamportsFor); a bad value → 400 */
function taskTip(tip: unknown, fallback: string, what: string): bigint {
  const v = tip !== undefined && tip !== "" && tip !== null ? String(tip) : fallback;
  lamportsOf(v, what, true);
  return tipLamportsFor(v);
}

/** Block X task dialogs → normalised runtime tasks. Throws a readable 400 on anything the dialogs would refuse.
 *  `exclude` = wallets that may not become wash wallets (dev + every task wallet of this launch). */
export function normalizeTasks(req: Pick<LaunchExecuteRequest, "tasks" | "cuPrice">, dev: string | null): NormTask[] {
  const st = store();
  const out: NormTask[] = [];
  let n = 0;
  let bundleWallets = 0;
  const used = new Set<string>(dev ? [dev] : []);
  const washRaw: { id: string; t: WashTask; sources: string[] }[] = [];
  for (const raw of req.tasks ?? []) {
    n++;
    const id = String(raw.id ?? `t${n}`);
    if (out.some((o) => o.id === id) || washRaw.some((w) => w.id === id)) throw new HttpError(400, `Duplicate task id ${id}.`);
    const type = raw.type as LaunchTaskType;
    if (!["bundle", "sniper", "buy", "volume", "wash"].includes(type)) throw new HttpError(400, `Unknown task type "${String(raw.type)}".`);
    if (type === "wash") {
      const t = raw as WashTask;
      const sources = t.pairs?.length ? [...new Set(t.pairs.map((p) => String(p.source)))] : expandWallets(raw);
      washRaw.push({ id, t, sources });
      continue;
    }
    const wallets = expandWallets(raw);
    for (const w of wallets) used.add(w);
    if (type === "bundle") {
      const t = raw as BundleTask;
      const d = TASK_DEFAULTS.bundle;
      bundleWallets += wallets.length;
      if (bundleWallets > TASK_LIMITS.maxWalletsPerBundleTask) throw new HttpError(400, `Bundle task: at most ${TASK_LIMITS.maxWalletsPerBundleTask} wallets.`);
      if (dev && wallets.includes(dev)) throw new HttpError(400, "The dev wallet buys inside the create transaction: do not list it in the bundle task.");
      const amounts = new Map<string, bigint>();
      for (const w of wallets) {
        const v = t.walletBuyAmounts?.[w] ?? t.buyAmount;
        if (v === undefined || v === "") throw new HttpError(400, `Bundle task: no SOL amount for ${w.slice(0, 6)}… (walletBuyAmounts or buyAmount).`);
        amounts.set(w, lamportsOf(v, "bundle amount"));
      }
      const slippagePct = numIn(t.slippagePercent, 0, TASK_LIMITS.maxSlippagePercent, d.slippagePercent, "bundle slippagePercent");
      out.push({
        id,
        type: "bundle",
        wallets,
        amounts,
        slippageBps: Math.round(slippagePct * 100),
        tipLamports: taskTip(t.tip, d.tip, "bundle tip"),
        autoRetryCount: intIn(t.autoRetryCount, 0, TASK_LIMITS.maxAutoRetryCount, d.autoRetryCount, "bundle autoRetryCount"),
        autoStart: t.autoStart ?? d.autoStart,
        activitySol: activityThreshold(t.sellOnExternalEnabled, t.sellOnExternalThreshold, "Bundle task · Sell all on external"),
      });
    } else if (type === "sniper") {
      const t = raw as SniperTask;
      const d = TASK_DEFAULTS.sniper;
      const amounts = new Map<string, bigint>();
      for (const w of wallets) {
        const v = t.walletBuyAmounts?.[w] ?? t.buyAmount;
        if (v === undefined || v === "") throw new HttpError(400, `Sniper task: no SOL amount for ${w.slice(0, 6)}… (walletBuyAmounts or buyAmount).`);
        amounts.set(w, lamportsOf(v, "sniper amount"));
      }
      const minD = numIn(t.minDelaySec, 0, TASK_LIMITS.maxSniperDelaySec, d.minDelaySec, "sniper minDelaySec");
      const maxD = numIn(t.maxDelaySec, 0, TASK_LIMITS.maxSniperDelaySec, d.maxDelaySec, "sniper maxDelaySec");
      if (maxD < minD) throw new HttpError(400, "Sniper task: max delay must be ≥ min delay.");
      const retryOn = t.retry ?? (t.autoRetryCount !== undefined ? Number(t.autoRetryCount) > 0 : d.retry);
      const retries = retryOn ? intIn(t.maxRetries ?? t.autoRetryCount, 0, TASK_LIMITS.maxAutoRetryCount, d.maxRetries, "sniper maxRetries") : 0;
      const slippagePct = numIn(t.slippagePercent, 0, TASK_LIMITS.maxSlippagePercent, d.slippagePercent, "sniper slippagePercent");
      out.push({
        id,
        type: "sniper",
        wallets,
        amounts,
        slippageBps: Math.round(slippagePct * 100),
        tipLamports: taskTip(t.tip, d.tip, "sniper tip"),
        autoRetryCount: retries,
        minDelayMs: Math.round(minD * 1000),
        maxDelayMs: Math.round(maxD * 1000),
        autoStart: t.autoStart ?? d.autoStart,
        activitySol: activityThreshold(t.stopOnActivityEnabled, t.stopOnActivityThreshold, "Sniper task · Stop on activity"),
      });
    } else {
      const t = raw as TradeTask;
      const d = TASK_DEFAULTS[type];
      const minL = lamportsOf(t.minTradeAmount ?? d.minTradeAmount, `${type} minTradeAmount`);
      const maxL = lamportsOf(t.maxTradeAmount ?? d.maxTradeAmount, `${type} maxTradeAmount`);
      if (maxL < minL) throw new HttpError(400, `Task ${type}: Max (SOL) must be ≥ Min (SOL).`);
      const minI = numIn(t.minIntervalSec, 0, TASK_LIMITS.maxIntervalSec, d.minIntervalSec, `${type} minIntervalSec`);
      const maxI = numIn(t.maxIntervalSec, 0, TASK_LIMITS.maxIntervalSec, d.maxIntervalSec, `${type} maxIntervalSec`);
      if (maxI < minI) throw new HttpError(400, `Task ${type}: Max (s) must be ≥ Min (s).`);
      const perWallet = t.maxTradesPerWallet !== undefined && t.maxTradesPerWallet !== null && String(t.maxTradesPerWallet) !== "" ? intIn(t.maxTradesPerWallet, 1, TASK_LIMITS.maxTradesPerWallet, TASK_LIMITS.maxTradesPerWallet, `${type} maxTradesPerWallet`) : TASK_LIMITS.maxTradesPerWallet;
      const duration = t.maxDurationMinutes !== undefined && t.maxDurationMinutes !== null && String(t.maxDurationMinutes) !== "" ? intIn(t.maxDurationMinutes, 1, TASK_LIMITS.maxDurationMinutes, TASK_LIMITS.maxDurationMinutes, `${type} maxDurationMinutes`) : null;
      const slippagePct = numIn(t.slippagePercent, 0, TASK_LIMITS.maxSlippagePercent, d.slippagePercent, `${type} slippagePercent`);
      const mode = type === "buy" ? "buy" : t.tradeMode === "buy" || t.tradeMode === "sell" || t.tradeMode === "both" ? t.tradeMode : d.tradeMode;
      out.push({
        id,
        type,
        wallets,
        autoStart: t.autoStart ?? d.autoStart,
        activitySol: activityThreshold(t.stopOnActivityEnabled, t.stopOnActivityThreshold, `${type === "buy" ? "Buy" : "Volume"} task · Stop on activity`),
        loopCfg: {
          type,
          wallets,
          minLamports: minL,
          maxLamports: maxL,
          minDelayMs: Math.round(minI * 1000),
          maxDelayMs: Math.round(maxI * 1000),
          tradeMode: mode,
          buyRatioPercent: intIn(t.buyRatioPercent, 0, 100, d.buyRatioPercent, `${type} buyRatioPercent`),
          totalTrades: perWallet * wallets.length,
          maxDurationMs: duration ? duration * 60_000 : null,
          slippageBps: Math.round(slippagePct * 100),
          cuPrice: req.cuPrice ?? st.settings.cuPrice,
          tipLamports: taskTip(t.tip, d.tip, `${type} tip`),
          bundle: false,
        },
      });
    }
  }
  // wash last: its wash wallets must not be a dev/bundle/sniper/buy/volume wallet of this launch
  for (const { id, t, sources } of washRaw) {
    const d = TASK_DEFAULTS.wash;
    const minD = numIn(t.minDelaySec, 0, TASK_LIMITS.maxWashDelaySec, d.minDelaySec, "wash minDelaySec");
    const maxD = numIn(t.maxDelaySec, 0, TASK_LIMITS.maxWashDelaySec, d.maxDelaySec, "wash maxDelaySec");
    if (maxD < minD) throw new HttpError(400, "Wash task: max delay must be ≥ min delay.");
    const pairs = resolveWashPairs({ pairs: t.pairs, sources, perSource: t.perSource ?? d.perSource, autoPairFrom: t.autoPairFrom ?? d.autoPairFrom, exclude: [...used] });
    for (const p of pairs) for (const w of p.wash) if (used.has(w)) throw new HttpError(400, `Wash task: ${w.slice(0, 6)}… is already a wallet of this launch and cannot be a wash wallet.`);
    for (const p of pairs) for (const w of p.wash) used.add(w);
    out.push({ id, type: "wash", wallets: sources, pairs, minDelayMs: Math.round(minD * 1000), maxDelayMs: Math.round(maxD * 1000), autoStart: t.autoStart ?? d.autoStart });
  }
  return out;
}

/* ------------------------------------------------------------------ execute */

export async function executeLaunchRequest(req: LaunchExecuteRequest): Promise<LaunchExecuteResponse> {
  const arrived = Date.now();
  const clicked = Number(req.clickedAt);
  const clickT0 = Number.isFinite(clicked) && clicked <= arrived && arrived - clicked < 120_000 ? clicked : arrived;
  requireUnlocked();
  const st = store();
  const mint = String(req.mint ?? "").trim();
  await syncPumpCluster();
  const pending = pendings().get(mint);
  if (!pending) throw new HttpError(404, "Unknown mint: call /api/launch/prepare first (pending mints are kept in runtime.json, 50 max).");
  if (registry().has(mint)) throw new HttpError(409, "This mint was already launched.");
  if (req.launchpad && req.launchpad !== "pumpfun") throw new HttpError(400, "launchpad must be \"pumpfun\".");
  if (req.quote && req.quote !== "SOL") throw new HttpError(400, "quote must be \"SOL\".");
  const dev = String(req.devWallet ?? "").trim();
  if (!dev) throw new HttpError(400, "Select a developer wallet first (devWallet).");
  vaultWallets([dev]);
  const devBuyLamports = lamportsOf(req.devBuySol ?? "0", "devBuySol", true);
  const tasks = normalizeTasks(req, dev);
  const bundleTasks = tasks.filter((t): t is Extract<NormTask, { type: "bundle" }> => t.type === "bundle");
  const mode: "bundle" | "plain" = bundleTasks.length > 0 ? "bundle" : "plain";
  if (req.autoDevSell) {
    const m = req.autoDevSell.mode;
    const v = Number(req.autoDevSell.value);
    if (m !== "ms" && m !== "mc") throw new HttpError(400, 'autoDevSell.mode must be "ms" (milliseconds after live) or "mc" (market cap USD).');
    if (!Number.isFinite(v) || v <= 0) throw new HttpError(400, `autoDevSell.value: a positive ${m === "ms" ? "number of milliseconds" : "USD market cap"} is required.`);
    if (m === "ms" && v > 7 * 86_400_000) throw new HttpError(400, "autoDevSell.value: 7 days max.");
  }
  if (req.sellOnExternalEnabled && !(Number(req.sellOnExternalThreshold) > 0)) throw new HttpError(400, "Auto Dump: the external volume threshold (SOL) must be > 0 when enabled.");
  // "Auto-claim rewards → dev wallet": on by default (Settings.autoClaimRewards), validated before anything is sent
  const autoClaimOn = req.autoClaim ? !!req.autoClaim.enabled : st.settings.autoClaimRewards !== false;
  const autoClaim = autoClaimOn ? normalizeAutoClaim(req.autoClaim) : null;
  const draftId = req.draftId ? String(req.draftId) : null;
  const slippageBps = intIn(req.slippageBps, 0, 9000, st.settings.slippageBps);
  const cuPrice = intIn(req.cuPrice, 0, 50_000_000, st.settings.cuPrice);
  const devnet = isDevnet(st.settings);
  const bundleTip = devnet ? BigInt(0) : mode === "bundle" ? (bundleTasks[0].tipLamports > BigInt(0) ? bundleTasks[0].tipLamports : tipLamportsFor(st.settings.tipSol)) : tipLamportsFor(undefined);
  // Settings → Jito off: the bundle wallets snipe the dev — create + their buys sent together through the normal sender
  // (same path as snipers, not atomic); Jito on: one atomic Jito bundle
  const jito = mode === "bundle" && !devnet && st.settings.jitoEnabled === true;
  if (jito && bundleTip < BigInt(1000)) throw new HttpError(400, "A Jito bundle needs a tip (bundle task `tip` or Settings → default tip).");

  // balance pre-checks: a readable refusal instead of a failed broadcast — a reserved …pump address goes back to the pool
  // (the draft keeps pointing at it, so the next Launch click can use it again)
  const refuse = (status: number, message: string): never => {
    if (pending.reserved) unuseReserved(mint);
    throw new HttpError(status, message);
  };
  const conn = readConn();
  const CREATE_COST = BigInt(30_000_000); // mint rent + ATA + fees ≈ 0.02–0.03 SOL
  // ONE read for the dev and every bundle wallet (was 1 + one per bundle task, in series), while the blockhash warms up
  touchHot();
  void blockhashNow().catch(() => null);
  const bundleAddrs = bundleTasks.flatMap((t) => t.wallets);
  const infos = await getAccountsChunked(
    conn,
    [dev, ...bundleAddrs].map((w) => new PublicKey(w)),
  ).catch(() => null);
  const devBal = infos ? BigInt(infos[0]?.lamports ?? 0) : null;
  if (devBal === null) refuse(503, "RPC unreachable: the dev balance could not be read. Nothing was sent.");
  // bundle: + the static lookup table rent the first time (≈0.008); the launch table was paid when it was prepared
  const devNeed = devBuyLamports + CREATE_COST + (mode === "bundle" ? bundleTip + BigInt(12_000_000) : BigInt(0));
  if (devBal! < devNeed) refuse(402, `Dev wallet holds ${solString(devBal!)} SOL but needs at least ${solString(devNeed)} SOL (dev buy + creation + fees${mode === "bundle" ? " + tip + lookup tables" : ""}). Nothing was sent.`);
  let k = 1;
  for (const t of bundleTasks) {
    for (const w of t.wallets) {
      const bal = BigInt(infos?.[k++]?.lamports ?? 0);
      const need = t.amounts.get(w)! + BigInt(3_000_000) + bundleTip;
      if (bal < need) refuse(402, `Bundle wallet ${w.slice(0, 6)}… holds ${solString(bal)} SOL but needs ${solString(need)} SOL (buy + fees + tip). Nothing was sent.`);
    }
  }
  // prepared ahead of the click (warm): the reservation is marked used only now, once every check passed
  if (pending.reserved) {
    unuseReserved(mint);
    takeReserved(mint);
  }

  const allWallets = [...new Set([dev, ...tasks.flatMap((t) => t.wallets)])];
  const job = jobNew(`launch-${mode}`, tasks.filter((t) => t.type === "bundle" || t.type === "sniper").reduce((s, t) => s + t.wallets.length, 0) + 1, `Launch ${pending.symbol} · ${mode}`);
  const record: LaunchRecord = {
    mint,
    name: pending.name,
    symbol: pending.symbol,
    uri: pending.uri,
    image: pending.image,
    dev,
    mode,
    at: Date.now(),
    createSignature: null,
    createConfirmed: false,
    createError: null,
    wallets: allWallets,
    buysConfirmed: 0,
    buysTotal: tasks.filter((t) => t.type === "bundle" || t.type === "sniper").reduce((s, t) => s + t.wallets.length, 0),
    jobId: job.id,
  };
  const run: LaunchRun = {
    state: {
      id: mint,
      mint,
      name: pending.name,
      symbol: pending.symbol,
      dev,
      mode,
      status: "preparing",
      createSignature: null,
      createConfirmed: null,
      error: null,
      steps: [],
      tasks: [],
      startedAt: Date.now(),
      sellOnExternal: req.sellOnExternalEnabled ? { enabled: true, threshold: String(req.sellOnExternalThreshold ?? "0"), externalVolumeSol: 0, fired: false } : null,
      autoDump: null,
      autoDevSell: null,
      autoClaim: null,
      draftId,
    },
    job,
    subs: new Set(),
    tasks,
    loops: new Map(),
    taskStates: new Map(),
    record,
    cancelled: new Map(),
  };
  registry().set(mint, run);
  saveRuntimeSoon();
  st.launches.unshift(record);
  saveLaunches(st);
  track(st, mint);
  job.extra = { mint, mode, phase: "preparing" };
  jobRun(job, async () => runLaunch(run, { pendingKeypair: pending.keypair, uri: pending.uri, devBuyLamports, slippageBps, cuPrice, launchCuPrice: intIn(req.launchCuPrice, 0, 200_000_000, st.settings.launchCuPrice ?? 10_000_000), bundleTip, jito, cashback: false, autoClaim, req, t0: clickT0 })); // pump.fun rejects cashback coins since 2026-10 (create_v2 error 6082 CashbackDeprecated): the flag is never sent
  return { jobId: job.id, id: mint, mint, mode, tasks: tasks.map((t) => ({ id: t.id, type: t.type })) };
}

/** bundle wallets bought inside the create at most. Size allows 3 with both lookup tables, but a pump.fun buy runs
 *  ~10 inner instructions and a transaction may hold 64: dev + 3 fails (MaxInstructionTraceLengthExceeded), dev + 2
 *  landed on devnet with and without the Sender tip (scripts/prove-inline-devnet.mjs, 2026-10-06) */
const INLINE_MAX = 2;
/** at the click, a launch table this close to being rooted is waited for (inline wallets are worth a short wait);
 *  further away the create goes now with what is rooted (fewer inline wallets) */
const TABLE_WAIT_MAX_MS = 4000;
const TRACE_LIMIT = /MaxInstructionTraceLength|TooManyInstructionTrace|InstructionTrace/i;

// launch lookup tables: closed (rent back to the dev) once their cool-down is over — every 5 min, one sweeper per process
const sweeper = globalThis as unknown as { __trenchAltSweep?: ReturnType<typeof setInterval> };
if (!sweeper.__trenchAltSweep) sweeper.__trenchAltSweep = setInterval(() => void sweepLaunchTables(readConn()).catch(() => null), 5 * 60_000);

type RunOpts = { pendingKeypair: import("@solana/web3.js").Keypair; uri: string; devBuyLamports: bigint; slippageBps: number; cuPrice: number; /** bundle buys in their own tx + snipers (Settings → Launch priority) */ launchCuPrice: number; bundleTip: bigint; /** atomic Jito bundle (Settings → Jito on) */ jito: boolean; cashback: boolean; autoClaim: { minSol: string; intervalSec: number } | null; req: LaunchExecuteRequest; /** the Launch click (client clock, same machine) or the execute request's arrival: every timing step is measured from it */ t0: number };

/** the click → send path: the create is visible (signature, "pending") the moment it is broadcast, not once confirmed */
function markCreateSent(run: LaunchRun, sig: string, t0: number): void {
  const at = Date.now();
  run.state.createSignature = sig;
  run.state.createSentAt = at;
  run.record.createSignature = sig;
  saveLaunches(store());
  step(run, "create", true, `Create sent · +${at - t0} ms after the click`, { signature: sig });
  emit(run, { type: "state", data: launchStateOf(run) });
}

/** a leader executed the create (processed): the token exists on that fork — confirmation follows ~1 s later */
function markCreateLanded(run: LaunchRun, t0: number): void {
  const at = Date.now();
  run.state.createLandedAt = at;
  step(run, "create", true, `Create landed (processed) · +${at - t0} ms after the click, ${run.state.createSentAt ? at - run.state.createSentAt : "?"} ms after the send`, { signature: run.state.createSignature });
  emit(run, { type: "state", data: launchStateOf(run) });
}

async function runLaunch(run: LaunchRun, o: RunOpts): Promise<void> {
  const st = store();
  const { mint, dev } = run.state;
  const conn = readConn();
  const bundleTasks = run.tasks.filter((t): t is Extract<NormTask, { type: "bundle" }> => t.type === "bundle");
  const bundleRows: BuyRow[] = bundleTasks.flatMap((t) => t.wallets.map((w) => ({ label: w.slice(0, 6), signer: st.sol.keypair(w), solIn: t.amounts.get(w)!, cuPrice: o.launchCuPrice })));
  const rowAddr = bundleTasks.flatMap((t) => t.wallets);
  const retries = bundleTasks.length ? Math.max(...bundleTasks.map((t) => t.autoRetryCount)) : 0;
  const devnet = isDevnet(st.settings);
  step(run, "prepare", true, `Preparing ${run.state.mode} launch · dev buy ${solString(o.devBuyLamports)} SOL · ${bundleRows.length} bundle wallet(s)${devnet ? " · devnet" : ""} · +${Date.now() - o.t0} ms after the click`);
  if (!devnet && run.state.mode === "bundle" && !o.jito) step(run, "info", true, "Jito off (Settings): the bundle wallets buy right behind the dev — create and buys sent together, not atomic.");
  if (devnet && run.state.mode === "bundle") step(run, "info", true, "Devnet: Jito is mainnet-only — the bundle is sent as sequential transactions (create first, then the buys), no tip, not atomic.");
  run.state.status = "sending";
  emit(run, { type: "state", data: launchStateOf(run) });

  // the first bundle wallets buy INSIDE the create, right behind the dev: nobody can get between them. It needs lookup
  // tables to fit (static pump.fun table + one per launch); without them prepareLaunch keeps whatever fits
  const inlineMax = run.state.mode === "bundle" ? Math.min(INLINE_MAX, bundleRows.length) : 0;
  const devKp = st.sol.keypair(dev);
  let tables: import("@solana/web3.js").AddressLookupTableAccount[] = [];
  let launchTable: import("@solana/web3.js").AddressLookupTableAccount | null = null;
  let haveStatic = false;
  if (inlineMax > 0) {
    // tables are only used once ROOTED (leaders resolve them against their root bank, ~13 s behind): the launch table
    // was built ahead of the click (warmLaunchTable); a launch never builds one itself — it would hold the create ~13 s
    const buyers = bundleRows.slice(0, inlineMax).map((x) => x.signer.publicKey.toBase58());
    const warm = warmTableFor(mint, dev, buyers);
    const statP = staticLookupTable();
    let perLaunch: import("@solana/web3.js").AddressLookupTableAccount | null = null;
    if (warm) {
      const eta = await warmTableEtaMs(conn, warm);
      if (eta === 0) perLaunch = warm.table;
      else if (eta !== null && eta <= TABLE_WAIT_MAX_MS) {
        step(run, "prepare", true, `Waiting ~${(eta / 1000).toFixed(1)} s for this launch's lookup table to be finalized (a table is usable by the leaders only once rooted).`);
        perLaunch = await awaitWarmTable(warm, eta + 2500);
      }
      if (perLaunch) {
        takeWarmTable(warm);
        step(run, "prepare", true, `Launch lookup table ready (prepared ${((Date.now() - warm.startedAt) / 1000).toFixed(1)} s before) · +${Date.now() - o.t0} ms`);
      } else step(run, "prepare", true, `This launch's lookup table is not finalized yet (${eta === null ? "its transaction has not landed" : `~${(eta / 1000).toFixed(1)} s left`}) — launching now without it: fewer bundle wallets fit inside the create.`);
    } else step(run, "prepare", true, "No lookup table was prepared for this launch (the draft had no known mint before the click) — fewer bundle wallets fit inside the create.");
    const stat = await statP;
    launchTable = perLaunch;
    haveStatic = !!stat;
    tables = [stat, perLaunch].filter((x): x is import("@solana/web3.js").AddressLookupTableAccount => !!x);
    if (!stat) step(run, "prepare", true, "pump.fun static lookup table not available (or not finalized yet) — it is created in the background for the next launch.");
  }
  const prepOpts = { lookupTables: tables, inlineMax };
  // the chain refused the create for its instruction trace: one inline wallet fewer, same attempt (never more than INLINE_MAX times)
  const shrinkInline = (error: string | undefined): boolean => {
    if (prepOpts.inlineMax <= 0 || !TRACE_LIMIT.test(error ?? "")) return false;
    prepOpts.inlineMax--;
    step(run, "prepare", true, `The create was too heavy for Solana's instruction limit — retrying with ${prepOpts.inlineMax} bundle wallet(s) inside it.`);
    return true;
  };
  let inlined = 0;
  let created: { confirmed: boolean; signature?: string; error?: string } = { confirmed: false, error: "not sent" };
  let buyOutcomes: { confirmed: boolean; error?: string }[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    let prep: LaunchPrep;
    try {
      // the warm blockhash (≤ 20 s old, refreshed every 2 s while the launch page is open) on the first attempt; a
      // retry takes a fresh one
      const bh = attempt === 0 ? await blockhashNow().catch(() => null) : null;
      prep = await prepareLaunch(
        conn,
        { dev: st.sol.keypair(dev), name: run.state.name, symbol: run.state.symbol, uri: o.uri, devBuyLamports: o.devBuyLamports, mint: o.pendingKeypair, cashback: o.cashback },
        bundleRows,
        { cuPrice: o.cuPrice, slippageBps: o.slippageBps, tipLamports: devnet ? BigInt(0) : run.state.mode === "bundle" ? o.bundleTip : tipLamportsFor(undefined), jitoTip: o.jito, ...prepOpts, recentBlockhash: bh ? { blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight } : undefined },
      );
    } catch (e) {
      created = { confirmed: false, error: e instanceof Error ? e.message : String(e) };
      break;
    }
    inlined = prep.inline;
    if (attempt === 0) step(run, "prepare", true, prep.atomic ? "Dev buy is atomic with the creation (guaranteed first buyer)." : o.devBuyLamports > BigInt(0) ? "Name/URI too long for an atomic dev buy: the dev buy goes in a separate transaction." : "No dev buy.");
    if (attempt === 0 && inlineMax > 0) step(run, "prepare", true, prep.inline > 0 ? `${prep.inline} bundle wallet(s) buy inside the create, right behind the dev — no sniper can get between them${bundleRows.length > prep.inline ? `; ${bundleRows.length - prep.inline} more in their own transactions` : ""}.` : "No bundle wallet fits inside the create: they buy in their own transactions.");
    if (o.jito) {
      const r = await launchBundle(conn, prep, {
        timeoutMs: 45_000,
        onStep: (s) => {
          if (s.phase === "preflight") step(run, "bundle", true, s.simulated ? "Bundle checked: signatures valid, whole bundle simulated OK (simulateBundle)." : "Signatures valid · this RPC has no simulateBundle: only the create is simulated before sending.");
          if (s.phase === "bundle") step(run, "bundle", true, `Sending Jito bundle ${s.index + 1}/${s.total ?? 1}…`);
          if (s.phase === "bundle" && s.index === 0) markCreateSent(run, base58Encode(prep.createTx.signatures[0]), o.t0);
        },
      });
      if (!r.create.confirmed && shrinkInline(r.create.error)) {
        attempt--;
        continue;
      }
      created = r.create;
      buyOutcomes = [...Array.from({ length: inlined }, () => ({ confirmed: r.create.confirmed, error: r.create.confirmed ? undefined : (r.create.error ?? "create not landed") })), ...r.buys];
      if (!created.confirmed && attempt < retries) {
        step(run, "bundle", false, `Bundle not landed (${created.error ?? "?"}) — retry ${attempt + 1}/${retries}`);
        continue;
      }
      break;
    } else {
      const prepArgs = [
        { dev: st.sol.keypair(dev), name: run.state.name, symbol: run.state.symbol, uri: o.uri, devBuyLamports: o.devBuyLamports, mint: o.pendingKeypair, cashback: o.cashback },
        bundleRows,
        { cuPrice: o.cuPrice, slippageBps: o.slippageBps, tipLamports: devnet ? BigInt(0) : tipLamportsFor(undefined), ...prepOpts },
      ] as const;
      const r = await engineExecuteLaunch(conn, sendConn(), prep, {
        // the create really never landed (not in the history, no curve): re-sign it with a fresh blockhash (2× max)
        rebuildCreate: async () => {
          const fresh = await prepareLaunch(conn, prepArgs[0], prepArgs[1], prepArgs[2]);
          step(run, "create", true, "Create re-signed with a fresh blockhash (the first one expired without landing).");
          return { tx: fresh.createTx, lastValidBlockHeight: fresh.lastValidBlockHeight };
        },
        onNote: (note) => step(run, "info", true, note),
        // push confirmation (processed + confirmed) on the read RPC's WebSocket, kept warm by the hot-state ticker
        watch: (sig) => watchSignature(st.sol.config.rpcUrl, sig),
        onSent: (sig) => markCreateSent(run, sig, o.t0),
        onSeen: () => markCreateLanded(run, o.t0),
      });
      if (!r.create.confirmed && !r.create.signature && shrinkInline(r.create.error)) {
        attempt--;
        continue;
      }
      created = r.create;
      buyOutcomes = [...Array.from({ length: inlined }, () => ({ confirmed: r.create.confirmed, error: r.create.confirmed ? undefined : (r.create.error ?? "create not landed") })), ...r.buys];
      break;
    }
  }

  // "blockhash expired" / "not found" on a rate-limited RPC is not a failure: ask the chain before deciding
  if (!created.confirmed && created.signature && !/^simulation:|InstructionError|Custom/i.test(created.error ?? "")) {
    step(run, "create", true, `Confirmation inconclusive (${created.error ?? "?"}) — checking the signature and the bonding curve on chain…`);
    const check = await checkCreateOnChain(mint, created.signature, 4).catch(() => null);
    if (check?.landed) {
      created = { confirmed: true, signature: created.signature };
      step(run, "create", true, check.how === "history" ? "Create found in the transaction history: the token exists." : "Bonding curve found on chain: the token exists.");
    } else if (check?.reverted) created = { ...created, error: `Create transaction reverted: ${check.reverted}` };
    else if (check?.unreadable) created = { ...created, error: `${created.error ?? "not confirmed"} — the RPC could not read the chain; the launch list re-checks it every 30 s` };
  }

  // inline buys share the create's fate (re-checked above when the confirmation was inconclusive)
  for (let i = 0; i < inlined && i < buyOutcomes.length; i++) buyOutcomes[i] = { confirmed: created.confirmed, error: created.confirmed ? undefined : (created.error ?? "create not landed") };
  // after the launch (never during it): the launch table goes, the static one is created for the next launch if missing
  void (async () => {
    if (launchTable) await deactivateLaunchTable(conn, devKp, launchTable).catch(() => null);
    if (inlineMax > 0 && !haveStatic) ensureStaticLookupTable(conn, devKp);
  })();
  run.state.createSignature = created.signature ?? null;
  run.state.createConfirmed = created.confirmed;
  run.record.createSignature = created.signature ?? null;
  run.record.createConfirmed = created.confirmed;
  run.record.createError = created.confirmed ? null : (created.error ?? "unknown");
  jobPush(run.job, created.confirmed, { phase: "create", label: "create", address: dev, signature: created.signature ?? null, error: created.confirmed ? undefined : created.error });
  step(run, "create", created.confirmed, created.confirmed ? `Token created: ${mint} · confirmed +${Date.now() - o.t0} ms after the click` : `Creation failed: ${created.error ?? "unknown"}`, { signature: created.signature ?? null });
  for (const t of bundleTasks) {
    let sent = 0,
      failed = 0;
    const steps = t.wallets.map((w) => {
      const idx = rowAddr.indexOf(w);
      const b = buyOutcomes[idx];
      const ok = !!b?.confirmed;
      if (ok) sent++;
      else failed++;
      jobPush(run.job, ok, { phase: "bundle", address: w, sol: solString(t.amounts.get(w)!), error: ok ? undefined : (b?.error ?? "not landed") });
      return { ok, at: Date.now(), phase: "bundle", address: w, sol: solString(t.amounts.get(w)!), error: ok ? undefined : (b?.error ?? "not landed") };
    });
    setTask(run, t.id, { status: failed === 0 ? "done" : sent === 0 ? "error" : "done", done: t.wallets.length, sent, failed, startedAt: run.state.startedAt, endedAt: Date.now(), steps, error: sent === 0 ? (steps[0]?.error ?? null) : null });
    run.record.buysConfirmed += sent;
  }
  saveLaunches(st);
  logActivity(st, {
    kind: "launch",
    ok: created.confirmed,
    message: created.confirmed ? `Launch ${run.state.symbol} confirmed (${run.state.mode}) — ${run.record.buysConfirmed} bundle buy(s).` : `Launch ${run.state.symbol} NOT confirmed: ${created.error ?? "unknown"}`,
    mint,
    wallets: run.record.wallets,
    signature: created.signature,
    jobId: run.job.id,
  });
  if (created.confirmed) {
    // the buys of a launch are trades too: journaled as buy entries (the on-chain ledger is the PnL truth, the
    // journal feeds Activity / per-wallet volume)
    const devBuy = Number(solString(o.devBuyLamports));
    if (devBuy > 0)
      logActivity(st, { kind: "buy", ok: true, message: `Dev buy ${devBuy.toFixed(4)} SOL on ${run.state.symbol} (launch).`, mint, wallets: [dev], signature: created.signature ?? undefined, jobId: run.job.id, data: { side: "buy", solTotal: devBuy, solUsd: solPriceCached(), launchDevBuy: true } });
    const bundled = bundleTasks.flatMap((t) => t.wallets.filter((w) => buyOutcomes[rowAddr.indexOf(w)]?.confirmed).map((w) => ({ address: w, sol: Number(solString(t.amounts.get(w)!)) })));
    if (bundled.length) {
      const total = bundled.reduce((s, b) => s + b.sol, 0);
      logActivity(st, { kind: "buy", ok: true, message: `Bundle buy ${total.toFixed(4)} SOL on ${run.state.symbol} — ${bundled.length} wallet(s) confirmed.`, mint, wallets: bundled.map((b) => b.address), jobId: run.job.id, data: { side: "buy", solTotal: total, solUsd: solPriceCached(), bundle: true, outcomes: bundled.map((b) => ({ address: b.address, ok: true, sol: b.sol.toString() })) } });
    }
  }
  if (!created.confirmed) {
    run.state.status = "failed";
    run.state.error = created.error ?? "creation not confirmed";
    for (const t of run.tasks) if (t.type !== "bundle") setTask(run, t.id, { status: "stopped", error: "launch failed" });
    emit(run, { type: "error", data: { error: run.state.error } });
    emit(run, { type: "done", data: launchStateOf(run) });
    throw new Error(run.state.error);
  }
  run.state.status = "live";
  pendings().delete(mint);
  markDraftLaunched(run.state.draftId ?? null, mint);
  saveRuntimeSoon();
  run.job.extra = { ...(run.job.extra ?? {}), phase: "live", createSignature: created.signature ?? null };

  // auto-dump / sell-on-external (one watcher per mint, both triggers merged)
  const ad = o.req.autoDump;
  const ext = o.req.sellOnExternalEnabled ? Number(o.req.sellOnExternalThreshold) : 0;
  if (ad || ext > 0) {
    try {
      const wallets = ad?.wallets?.length ? ad.wallets : run.record.wallets;
      armAutodump(mint, { percent: ad?.percent ?? 100, mcUsd: ad?.mcUsd, afterSec: ad?.afterSec ?? ad?.delaySec, bundle: ad?.bundle, wallets, externalVolumeSol: ext > 0 ? ext : undefined, label: "Auto Dump" }, wallets, (reason, jobId) => {
        if (run.state.sellOnExternal && /external/.test(reason)) run.state.sellOnExternal.fired = true;
        step(run, "autodump", true, `Auto-dump fired: ${reason} (job ${jobId})`);
      });
      step(run, "autodump", true, `Auto-dump armed${ad?.mcUsd ? ` · MC ≥ $${ad.mcUsd}` : ""}${ad?.afterSec ? ` · after ${ad.afterSec}s` : ""}${ext > 0 ? ` · external volume ≥ ${ext} SOL` : ""}`);
    } catch (e) {
      step(run, "autodump", false, `Auto-dump not armed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Auto Dev Sell: 100 % of the dev wallet after N ms or at MC ≥ $X (own watcher, independent of Auto Dump)
  const ds = o.req.autoDevSell;
  if (ds) {
    try {
      const afterSec = ds.mode === "ms" ? Math.max(1, Math.ceil(Number(ds.value) / 1000)) : undefined;
      armAutodump(mint, { percent: 100, afterSec, mcUsd: ds.mode === "mc" ? Number(ds.value) : undefined, wallets: [dev], label: "Auto Dev Sell" }, [dev], (reason, jobId) => step(run, "autodump", true, `Auto Dev Sell fired: ${reason} (job ${jobId})`), DEV_SELL_KEY(mint));
      step(run, "autodump", true, `Auto Dev Sell armed · ${ds.mode === "ms" ? `${ds.value} ms after live` : `MC ≥ $${ds.value}`}`);
    } catch (e) {
      step(run, "autodump", false, `Auto Dev Sell not armed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Auto-claim rewards → dev wallet: the creator vault is read every intervalSec and claimed to the dev once ≥ minSol
  if (o.autoClaim) {
    try {
      armAutoclaim(mint, { ...o.autoClaim, creator: dev });
      step(run, "autoclaim", true, `Auto-claim armed · creator fees → ${labelOf(dev)} when ≥ ${o.autoClaim.minSol} SOL, checked every ${o.autoClaim.intervalSec}s`);
    } catch (e) {
      step(run, "autoclaim", false, `Auto-claim not armed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // bundle "Sell all on external": sell 100 % of the bundle wallets once net external SOL ≥ threshold
  for (const t of bundleTasks) {
    if (t.activitySol === null) continue;
    try {
      armAutodump(mint, { percent: 100, externalVolumeSol: t.activitySol, wallets: t.wallets, label: `Bundle ${t.id} · Sell all on external` }, t.wallets, (reason, jobId) => step(run, "autodump", true, `Bundle ${t.id} sell-all fired: ${reason} (job ${jobId})`, { taskId: t.id }), watchKey(mint, t.id));
      step(run, "autodump", true, `Bundle ${t.id}: sell all on external armed · ≥ ${t.activitySol} SOL`, { taskId: t.id });
    } catch (e) {
      step(run, "autodump", false, `Bundle ${t.id}: sell all on external not armed: ${e instanceof Error ? e.message : String(e)}`, { taskId: t.id });
    }
  }

  // snipers: buys right after the create, min/max delay between wallets, retries on the failed ones, stop on activity
  const snipers = run.tasks.filter((t): t is Extract<NormTask, { type: "sniper" }> => t.type === "sniper" && t.autoStart);
  await Promise.all(snipers.map((t) => runSniper(run, t, o.launchCuPrice)));
  saveLaunches(st);

  // buy / volume loops (+ stop on activity)
  for (const t of run.tasks) {
    if (t.type !== "buy" && t.type !== "volume") continue;
    startLoop(run, t);
  }

  // wash: after bundle/sniper buys
  for (const t of run.tasks) {
    if (t.type !== "wash" || !t.autoStart) continue;
    await runWash(run, t);
  }

  emit(run, { type: "done", data: launchStateOf(run) });
  saveRuntimeSoon();
}

/** arm a "Stop on activity" notify-watch for a task; returns a disarm fn */
function armStopOnActivity(run: LaunchRun, taskId: string, thresholdSol: number, onFire: (reason: string) => void): () => void {
  const key = watchKey(run.state.mint, taskId);
  try {
    armAutodump(run.state.mint, { percent: 100, action: "notify", externalVolumeSol: thresholdSol, label: `Task ${taskId} · Stop on activity` }, [], (reason) => onFire(reason), key);
  } catch (e) {
    step(run, "task", false, `Task ${taskId}: stop on activity not armed: ${e instanceof Error ? e.message : String(e)}`, { taskId });
  }
  return () => disarmAutodump(key, true);
}

async function runSniper(run: LaunchRun, t: Extract<NormTask, { type: "sniper" }>, cuPrice: number): Promise<void> {
  const { mint } = run.state;
  setTask(run, t.id, { status: "running", startedAt: Date.now() });
  const disarm = t.activitySol !== null ? armStopOnActivity(run, t.id, t.activitySol, (reason) => run.cancelled.set(t.id, `stop on activity: ${reason}`)) : () => {};
  const cancelled = () => run.cancelled.get(t.id) ?? null;
  let remaining = [...t.wallets];
  const steps: LaunchTaskState["steps"] = [];
  let sent = 0;
  const sequential = t.maxDelayMs > 0;
  try {
    for (let attempt = 0; attempt <= t.autoRetryCount && remaining.length && !cancelled(); attempt++) {
      if (sequential) {
        const failed: string[] = [];
        for (let i = 0; i < remaining.length; i++) {
          if (cancelled()) break;
          if (i > 0) {
            const gap = Math.round(t.minDelayMs + Math.random() * Math.max(0, t.maxDelayMs - t.minDelayMs));
            setTask(run, t.id, { nextAt: Date.now() + gap });
            await sleep(gap);
            setTask(run, t.id, { nextAt: 0 });
            if (cancelled()) break;
          }
          const w = remaining[i];
          try {
            const [r] = await buyWithWallets({ mint, wallets: [w], lamportsEach: t.amounts.get(w)!, slippageBps: t.slippageBps, cuPrice, tipLamports: t.tipLamports, bundle: false, job: run.job, kind: "sniper" });
            steps.push({ ok: r.ok, at: Date.now(), phase: "sniper", address: r.address, sol: r.sol, signature: r.signature, error: r.error ?? undefined });
            if (r.ok) sent++;
            else failed.push(w);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            steps.push({ ok: false, at: Date.now(), phase: "sniper", address: w, error: msg });
            failed.push(w);
            if (/graduated|not found|locked/i.test(msg)) {
              remaining = [];
              break;
            }
          }
          setTask(run, t.id, { done: steps.length, sent, failed: steps.length - sent, steps });
        }
        remaining = remaining.filter((w) => failed.includes(w));
      } else {
        try {
          const out = await buyWithWallets({ mint, wallets: remaining, lamportsEach: (a) => t.amounts.get(a)!, slippageBps: t.slippageBps, cuPrice, tipLamports: t.tipLamports, bundle: false, job: run.job, kind: "sniper" });
          for (const r of out) steps.push({ ok: r.ok, at: Date.now(), phase: "sniper", address: r.address, sol: r.sol, signature: r.signature, error: r.error ?? undefined });
          sent += out.filter((r) => r.ok).length;
          remaining = out.filter((r) => !r.ok).map((r) => r.address);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          steps.push({ ok: false, at: Date.now(), phase: "sniper", error: msg });
          if (/Insufficient|graduated|not found|locked/i.test(msg)) break;
        }
        setTask(run, t.id, { done: steps.length, sent, failed: steps.length - sent, steps });
      }
      if (remaining.length && attempt < t.autoRetryCount && !cancelled()) step(run, "sniper", false, `Sniper ${t.id}: ${remaining.length} wallet(s) failed — retry ${attempt + 1}/${t.autoRetryCount}`, { taskId: t.id });
    }
  } finally {
    disarm();
  }
  run.record.buysConfirmed += sent;
  const stop = cancelled();
  const status: LaunchTaskState["status"] = stop ? "stopped" : sent === t.wallets.length ? "done" : sent === 0 ? "error" : "done";
  setTask(run, t.id, { status, done: t.wallets.length, sent, failed: t.wallets.length - sent, nextAt: 0, endedAt: Date.now(), steps, error: stop ?? (sent === 0 ? (steps.find((s) => s.error)?.error ?? "no buy confirmed") : null) });
  step(run, "sniper", sent > 0, stop ? `Sniper ${t.id} stopped (${stop}) after ${sent}/${t.wallets.length} buys` : `Sniper ${t.id}: ${sent}/${t.wallets.length} buys confirmed`, { taskId: t.id });
}

function startLoop(run: LaunchRun, t: Extract<NormTask, { type: "buy" | "volume" }>): void {
  const { mint } = run.state;
  const loop = new TradeLoop({ ...t.loopCfg, id: `${mint}:${t.id}`, taskId: t.id, mint, label: `${t.type} task ${t.id} · ${run.state.symbol}`, onChange: (s) => emit(run, { type: "task_status", data: { ...s, activity: activityOf(run, t.id) } }) });
  run.loops.set(t.id, loop);
  loops().set(loop.cfg.id, loop);
  if (t.autoStart) {
    loop.start();
    if (t.activitySol !== null) {
      const disarm = armStopOnActivity(run, t.id, t.activitySol, (reason) => {
        loop.stop();
        loop.error = null;
        loop.steps.push({ ok: true, at: Date.now(), note: `Stopped on activity: ${reason}` });
        step(run, "task", true, `${t.type} task ${t.id} stopped on activity: ${reason}`, { taskId: t.id });
        emit(run, { type: "task_status", data: taskState(run, t.id) });
      });
      // the watch ends with the loop
      void (async () => {
        while (loop.status === "running" || loop.status === "paused") await sleep(1000);
        disarm();
      })();
    }
    step(run, "task", true, `${t.type} task ${t.id} started (${t.wallets.length} wallet(s), ${t.loopCfg.totalTrades} trades max${t.activitySol !== null ? `, stop on activity ≥ ${t.activitySol} SOL` : ""})`, { taskId: t.id });
  } else emit(run, { type: "task_status", data: taskState(run, t.id) });
}

async function runWash(run: LaunchRun, t: Extract<NormTask, { type: "wash" }>): Promise<void> {
  setTask(run, t.id, { status: "running", startedAt: Date.now(), pairs: t.pairs });
  const steps: LaunchTaskState["steps"] = [];
  if (t.pairs.length === 0) {
    setTask(run, t.id, { status: "error", endedAt: Date.now(), error: "No source → wash wallet pair (restored from an older file?)." });
    return;
  }
  try {
    const res = await washPairs(run.state.mint, t.pairs, {
      minDelayMs: t.minDelayMs,
      maxDelayMs: t.maxDelayMs,
      shouldStop: () => run.cancelled.has(t.id),
      onStep: (s) => {
        steps.push(s);
        setTask(run, t.id, { done: steps.filter((x) => x.phase === "wash" && !x.note?.startsWith("holds no")).length, sent: steps.filter((x) => x.ok && x.signature).length, failed: steps.filter((x) => !x.ok).length, steps: steps.slice(-50), nextAt: s.phase === "wait" ? Date.now() : 0 });
      },
    });
    const sent = res.filter((r) => r.ok).length;
    const stop = run.cancelled.get(t.id);
    setTask(run, t.id, { status: stop ? "stopped" : res.length === 0 ? "done" : sent === 0 ? "error" : "done", done: res.length, sent, failed: res.length - sent, nextAt: 0, endedAt: Date.now(), steps: steps.slice(-50), error: stop ?? (res.length && sent === 0 ? (res[0].error ?? "transfer failed") : null) });
    step(run, "wash", sent > 0 || res.length === 0, res.length === 0 ? `Wash ${t.id}: no source holds tokens.` : `Wash ${t.id}: ${sent}/${res.length} slice(s) moved across ${t.pairs.length} pair(s)`, { taskId: t.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setTask(run, t.id, { status: "error", endedAt: Date.now(), error: msg, steps });
    step(run, "wash", false, `Wash ${t.id} failed: ${msg}`, { taskId: t.id });
  }
}

/* ------------------------------------------------------------------ task control */

export async function taskAction(launchId: string, taskId: string, action: "pause" | "resume" | "stop"): Promise<LaunchTaskState> {
  const run = registry().get(launchId);
  if (!run) throw new HttpError(404, "Unknown launch.");
  const t = run.tasks.find((x) => x.id === taskId);
  if (!t) throw new HttpError(404, "Unknown task.");
  const loop = run.loops.get(taskId);
  if (loop) {
    if (action === "pause") loop.pause();
    else if (action === "resume") {
      if (loop.status === "pending" || (loop.status === "stopped" && loop.resumable)) loop.start();
      else loop.resume();
    } else {
      loop.stop();
      disarmAutodump(watchKey(run.state.mint, taskId), true);
    }
    return taskState(run, taskId);
  }
  const s = taskState(run, taskId);
  if (action === "stop") {
    if (s.status === "pending") return setTask(run, taskId, { status: "stopped", endedAt: Date.now() });
    if (s.status === "running") {
      run.cancelled.set(taskId, "stopped by user");
      if (t.type === "wash") return s;
      return setTask(run, taskId, { status: "stopped", endedAt: Date.now(), error: "stopped by user" });
    }
    if (t.type === "bundle") {
      const w = disarmAutodump(watchKey(run.state.mint, taskId), true);
      if (w.armedAt && !w.armed) step(run, "autodump", true, `Bundle ${taskId}: sell all on external disarmed`, { taskId });
      return taskState(run, taskId);
    }
    return s;
  }
  if (action === "resume" && s.status === "pending" && run.state.status === "live") {
    run.cancelled.delete(taskId);
    if (t.type === "wash") {
      void runWash(run, t);
      return taskState(run, taskId);
    }
    if (t.type === "sniper") {
      void runSniper(run, t, store().settings.cuPrice);
      return taskState(run, taskId);
    }
  }
  if (action === "pause") throw new HttpError(409, `${t.type} tasks are not pausable (only buy and volume).`);
  return s;
}

/** stop every loop/watch of a launch (Dump All → "Stop every task, then dump") */
export function stopAllTasks(launchId: string): LaunchTaskState[] {
  const run = registry().get(launchId);
  if (!run) throw new HttpError(404, "Unknown launch.");
  for (const t of run.tasks) {
    const loop = run.loops.get(t.id);
    if (loop) loop.stop();
    else {
      const s = taskState(run, t.id);
      if (s.status === "pending" || s.status === "running") {
        run.cancelled.set(t.id, "stopped by Dump All");
        setTask(run, t.id, { status: "stopped", endedAt: Date.now() });
      }
    }
  }
  disarmTaskWatches(run.state.mint);
  return run.tasks.map((t) => taskState(run, t.id));
}

/** every known launch run (for search / dashboards) */
export function launchRuns(): LaunchRun[] {
  return [...registry().values()];
}
