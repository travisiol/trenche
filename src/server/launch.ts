/* Launch pipeline: /api/launch/prepare (IPFS metadata + mint keypair kept in memory) and
 * /api/launch/execute with the Block X task model (bundle · sniper · buy · volume · wash), auto-dump
 * and sell-on-external. Live state is streamed on /api/launch/[id]/stream. */
import { PublicKey } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { generateMint } from "@/engine/solana/pump/create.js";
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
  TradeTask,
  WashTask,
} from "@/lib/types";
import { TASK_DEFAULTS, TASK_LIMITS } from "@/lib/types";
import { HttpError, intIn, lamportsOf, solString } from "./api";
import { armAutodump, autodumpStatus } from "./autodump";
import { buyWithWallets, groupWallets, readConn, requireUnlocked, sendConn, tipLamportsFor, vaultWallets } from "./engine";
import { jobNew, jobNote, jobPush, jobRun } from "./jobs";
import { fetchUriJson } from "./metadata";
import { ipfsToHttp } from "@/engine/solana/pump/metadata.js";
import { logActivity, saveLaunches, store, track, type Job } from "./store";
import { loops, TradeLoop } from "./tradeloop";
import { washTokens } from "./wash";

/* ------------------------------------------------------------------ prepare */

export async function prepareLaunchMeta(req: LaunchPrepareRequest): Promise<LaunchPrepareResponse> {
  requireUnlocked();
  const st = store();
  const name = String(req.name ?? "").trim().slice(0, 32);
  const symbol = String(req.symbol ?? "").trim().slice(0, 10);
  if (!name) throw new HttpError(400, "name required.");
  if (!symbol) throw new HttpError(400, "symbol required.");
  const m = String(req.imageDataUrl ?? "").match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new HttpError(400, "imageDataUrl must be a base64 data URL (data:image/png;base64,…).");
  const imageBase64 = m[2].replace(/\s+/g, "");
  if (imageBase64.length > 6_000_000) throw new HttpError(400, "Image too large (4 MB max).");
  const uri = await uploadPumpMetadata({
    name,
    symbol,
    description: req.description ? String(req.description).slice(0, 1000) : undefined,
    imageBase64,
    imageType: m[1],
    twitter: req.twitter ? String(req.twitter) : undefined,
    telegram: req.telegram ? String(req.telegram) : undefined,
    website: req.website ? String(req.website) : undefined,
  });
  const vanity = req.vanity ? String(req.vanity).trim().slice(0, 4) : undefined;
  const keypair = generateMint(vanity);
  const mint = keypair.publicKey.toBase58();
  let image: string | null = null;
  const j = await fetchUriJson(uri, 5000).catch(() => null);
  if (j && typeof j.image === "string") image = ipfsToHttp(j.image);
  st.pendingMints.set(mint, { keypair, uri, name, symbol, image, at: Date.now() });
  // keep memory bounded
  if (st.pendingMints.size > 50) {
    const oldest = [...st.pendingMints.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) st.pendingMints.delete(oldest[0]);
  }
  logActivity(st, { kind: "launch", ok: true, message: `Launch prepared: ${symbol} · metadata ${uri}`, mint, data: { uri } });
  return { uri, mint, name, symbol };
}

/* ------------------------------------------------------------------ runtime */

type NormTask =
  | { id: string; type: "bundle" | "sniper"; wallets: string[]; amounts: Map<string, bigint>; slippageBps: number; tipLamports: bigint; autoRetryCount: number; autoStart: boolean }
  | { id: string; type: "buy" | "volume"; wallets: string[]; loopCfg: Omit<ConstructorParameters<typeof TradeLoop>[0], "id" | "taskId" | "mint" | "label" | "onChange" | "type"> & { type: "buy" | "volume" }; autoStart: boolean }
  | { id: string; type: "wash"; wallets: string[]; autoStart: boolean };

export type LaunchRun = {
  state: LaunchState;
  job: Job;
  subs: Set<(ev: LaunchStreamEvent) => void>;
  tasks: NormTask[];
  loops: Map<string, TradeLoop>;
  taskStates: Map<string, LaunchTaskState>;
  record: LaunchRecord;
};

function registry(): Map<string, LaunchRun> {
  const rt = store().runtime;
  if (!rt.launches) rt.launches = new Map<string, LaunchRun>();
  return rt.launches as Map<string, LaunchRun>;
}

export function launchGet(id: string): LaunchRun | undefined {
  return registry().get(id);
}

export function launchStateOf(run: LaunchRun): LaunchState {
  return { ...run.state, tasks: run.tasks.map((t) => taskState(run, t.id)), autoDump: autodumpStatus(run.state.mint), steps: run.state.steps.slice(-200) };
}

export function subscribeLaunch(id: string, fn: (ev: LaunchStreamEvent) => void): () => void {
  const run = registry().get(id);
  if (!run) throw new HttpError(404, "Unknown launch (launches live in memory; the server may have restarted).");
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
}

function taskState(run: LaunchRun, taskId: string): LaunchTaskState {
  const loop = run.loops.get(taskId);
  if (loop) return loop.state();
  const t = run.taskStates.get(taskId);
  if (t) return t;
  const n = run.tasks.find((x) => x.id === taskId)!;
  const s: LaunchTaskState = { id: n.id, type: n.type, status: "pending", wallets: n.wallets, done: 0, total: n.type === "bundle" || n.type === "sniper" || n.type === "wash" ? n.wallets.length : null, sent: 0, failed: 0, nextAt: 0, error: null, startedAt: null, endedAt: null, steps: [] };
  run.taskStates.set(taskId, s);
  return s;
}

function setTask(run: LaunchRun, taskId: string, patch: Partial<LaunchTaskState>): LaunchTaskState {
  const s = Object.assign(taskState(run, taskId), patch);
  run.taskStates.set(taskId, s);
  emit(run, { type: "task_status", data: s });
  return s;
}

/* ------------------------------------------------------------------ validate */

function expandWallets(t: LaunchTask): string[] {
  const set = new Set<string>();
  for (const a of t.walletIds ?? []) set.add(String(a));
  for (const g of t.walletGroupIds ?? []) for (const a of groupWallets(String(g))) set.add(a);
  const list = [...set];
  if (list.length === 0) throw new HttpError(400, `Task ${t.type}: no wallet (walletIds / walletGroupIds).`);
  if (list.length > TASK_LIMITS.maxWalletsPerTask) throw new HttpError(400, `Task ${t.type}: ${TASK_LIMITS.maxWalletsPerTask} wallets max.`);
  vaultWallets(list);
  return list;
}

function normalizeTasks(req: LaunchExecuteRequest, dev: string): NormTask[] {
  const st = store();
  const out: NormTask[] = [];
  let n = 0;
  let bundleWallets = 0;
  for (const raw of req.tasks ?? []) {
    n++;
    const id = String(raw.id ?? `t${n}`);
    if (out.some((o) => o.id === id)) throw new HttpError(400, `Duplicate task id ${id}.`);
    const type = raw.type as LaunchTaskType;
    if (!["bundle", "sniper", "buy", "volume", "wash"].includes(type)) throw new HttpError(400, `Unknown task type "${String(raw.type)}".`);
    const wallets = expandWallets(raw);
    if (type === "bundle" || type === "sniper") {
      const t = raw as BundleTask;
      const d = TASK_DEFAULTS[type];
      if (type === "bundle") {
        bundleWallets += wallets.length;
        if (bundleWallets > TASK_LIMITS.maxWalletsPerBundleTask) throw new HttpError(400, `Bundle tasks: ${TASK_LIMITS.maxWalletsPerBundleTask} wallets max in total (Jito bundle = create + 4 buys).`);
        if (wallets.includes(dev)) throw new HttpError(400, "The dev wallet buys inside the create transaction: do not list it in the bundle task.");
      }
      const amounts = new Map<string, bigint>();
      for (const w of wallets) {
        const v = t.walletBuyAmounts?.[w] ?? t.buyAmount;
        if (v === undefined || v === "") throw new HttpError(400, `Task ${type}: no SOL amount for ${w.slice(0, 6)}… (walletBuyAmounts or buyAmount).`);
        amounts.set(w, lamportsOf(v, `${type} amount`));
      }
      const slippagePct = Math.max(0, Math.min(TASK_LIMITS.maxSlippagePercent, Number(t.slippagePercent ?? d.slippagePercent)));
      out.push({
        id,
        type,
        wallets,
        amounts,
        slippageBps: Math.round(slippagePct * 100),
        tipLamports: t.tip !== undefined && t.tip !== "" ? lamportsOf(t.tip, `${type} tip`, true) : tipLamportsFor(st.settings.tipSol),
        autoRetryCount: intIn(t.autoRetryCount, 0, TASK_LIMITS.maxAutoRetryCount, d.autoRetryCount),
        autoStart: t.autoStart ?? d.autoStart,
      });
    } else if (type === "buy" || type === "volume") {
      const t = raw as TradeTask;
      const d = TASK_DEFAULTS[type];
      const minL = lamportsOf(t.minTradeAmount ?? d.minTradeAmount, `${type} minTradeAmount`);
      const maxL = lamportsOf(t.maxTradeAmount ?? d.maxTradeAmount, `${type} maxTradeAmount`);
      if (maxL < minL) throw new HttpError(400, `Task ${type}: maxTradeAmount must be ≥ minTradeAmount.`);
      const minI = Math.max(0, Math.min(TASK_LIMITS.maxIntervalSec, Number(t.minIntervalSec ?? d.minIntervalSec)));
      const maxI = Math.max(minI, Math.min(TASK_LIMITS.maxIntervalSec, Number(t.maxIntervalSec ?? d.maxIntervalSec)));
      const perWallet = intIn(t.maxTradesPerWallet, 1, TASK_LIMITS.maxTradesPerWallet, TASK_LIMITS.maxTradesPerWallet);
      const duration = t.maxDurationMinutes !== undefined ? intIn(t.maxDurationMinutes, 1, TASK_LIMITS.maxDurationMinutes, TASK_LIMITS.maxDurationMinutes) : null;
      const slippagePct = Math.max(0, Math.min(TASK_LIMITS.maxSlippagePercent, Number(t.slippagePercent ?? d.slippagePercent)));
      out.push({
        id,
        type,
        wallets,
        autoStart: t.autoStart ?? d.autoStart,
        loopCfg: {
          type,
          wallets,
          minLamports: minL,
          maxLamports: maxL,
          minDelayMs: Math.round(minI * 1000),
          maxDelayMs: Math.round(maxI * 1000),
          tradeMode: type === "buy" ? "buy" : (t.tradeMode ?? d.tradeMode),
          buyRatioPercent: intIn(t.buyRatioPercent, 0, 100, d.buyRatioPercent),
          totalTrades: perWallet * wallets.length,
          maxDurationMs: duration ? duration * 60_000 : null,
          slippageBps: Math.round(slippagePct * 100),
          cuPrice: req.cuPrice ?? st.settings.cuPrice,
          tipLamports: t.tip !== undefined && t.tip !== "" ? lamportsOf(t.tip, `${type} tip`, true) : tipLamportsFor(undefined),
          bundle: false,
        },
      });
    } else {
      const t = raw as WashTask;
      out.push({ id, type: "wash", wallets, autoStart: t.autoStart ?? TASK_DEFAULTS.wash.autoStart });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ execute */

export async function executeLaunchRequest(req: LaunchExecuteRequest): Promise<LaunchExecuteResponse> {
  requireUnlocked();
  const st = store();
  const mint = String(req.mint ?? "").trim();
  const pending = st.pendingMints.get(mint);
  if (!pending) throw new HttpError(404, "Unknown mint: call /api/launch/prepare first (the mint keypair lives in server memory).");
  if (registry().has(mint)) throw new HttpError(409, "This mint was already launched.");
  if (req.launchpad && req.launchpad !== "pumpfun") throw new HttpError(400, "launchpad must be \"pumpfun\".");
  if (req.quote && req.quote !== "SOL") throw new HttpError(400, "quote must be \"SOL\".");
  const dev = String(req.devWallet ?? "").trim();
  vaultWallets([dev]);
  const devBuyLamports = lamportsOf(req.devBuySol ?? "0", "devBuySol", true);
  const tasks = normalizeTasks(req, dev);
  const bundleTasks = tasks.filter((t): t is Extract<NormTask, { type: "bundle" | "sniper" }> => t.type === "bundle");
  const mode: "bundle" | "plain" = bundleTasks.length > 0 ? "bundle" : "plain";
  const slippageBps = intIn(req.slippageBps, 0, 9000, st.settings.slippageBps);
  const cuPrice = intIn(req.cuPrice, 0, 50_000_000, st.settings.cuPrice);
  const bundleTip = mode === "bundle" ? (bundleTasks[0].tipLamports > BigInt(0) ? bundleTasks[0].tipLamports : tipLamportsFor(st.settings.tipSol)) : tipLamportsFor(undefined);
  if (mode === "bundle" && bundleTip < BigInt(1000)) throw new HttpError(400, "A Jito bundle needs a tip (bundle task `tip` or Settings → default tip).");

  // balance pre-checks: a readable refusal instead of a failed broadcast
  const conn = readConn();
  const CREATE_COST = BigInt(30_000_000); // mint rent + ATA + fees ≈ 0.02–0.03 SOL
  const devBal = await getSolBalance(conn, dev).catch(() => null);
  if (devBal === null) throw new HttpError(503, "RPC unreachable: the dev balance could not be read. Nothing was sent.");
  const devNeed = devBuyLamports + CREATE_COST + (mode === "bundle" ? bundleTip : BigInt(0));
  if (devBal < devNeed) throw new HttpError(402, `Dev wallet holds ${solString(devBal)} SOL but needs at least ${solString(devNeed)} SOL (dev buy + creation + fees${mode === "bundle" ? " + tip" : ""}). Nothing was sent.`);
  for (const t of bundleTasks) {
    const infos = await conn.getMultipleAccountsInfo(t.wallets.map((w) => new PublicKey(w)), "confirmed").catch(() => null);
    t.wallets.forEach((w, i) => {
      const bal = BigInt(infos?.[i]?.lamports ?? 0);
      const need = t.amounts.get(w)! + BigInt(3_000_000) + bundleTip;
      if (infos && bal < need) throw new HttpError(402, `Bundle wallet ${w.slice(0, 6)}… holds ${solString(bal)} SOL but needs ${solString(need)} SOL (buy + fees + tip). Nothing was sent.`);
    });
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
    },
    job,
    subs: new Set(),
    tasks,
    loops: new Map(),
    taskStates: new Map(),
    record,
  };
  registry().set(mint, run);
  st.launches.unshift(record);
  saveLaunches(st);
  track(st, mint);
  job.extra = { mint, mode, phase: "preparing" };
  jobRun(job, async () => runLaunch(run, { pendingKeypair: pending.keypair, uri: pending.uri, devBuyLamports, slippageBps, cuPrice, bundleTip, cashback: !!req.cashback, req }));
  return { jobId: job.id, id: mint, mint, mode, tasks: tasks.map((t) => ({ id: t.id, type: t.type })) };
}

type RunOpts = { pendingKeypair: import("@solana/web3.js").Keypair; uri: string; devBuyLamports: bigint; slippageBps: number; cuPrice: number; bundleTip: bigint; cashback: boolean; req: LaunchExecuteRequest };

async function runLaunch(run: LaunchRun, o: RunOpts): Promise<void> {
  const st = store();
  const { mint, dev } = run.state;
  const conn = readConn();
  const bundleTasks = run.tasks.filter((t): t is Extract<NormTask, { type: "bundle" | "sniper" }> => t.type === "bundle");
  const bundleRows: BuyRow[] = bundleTasks.flatMap((t) => t.wallets.map((w) => ({ label: w.slice(0, 6), signer: st.sol.keypair(w), solIn: t.amounts.get(w)!, cuPrice: o.cuPrice })));
  const rowAddr = bundleTasks.flatMap((t) => t.wallets);
  const retries = bundleTasks.length ? Math.max(...bundleTasks.map((t) => t.autoRetryCount)) : 0;
  step(run, "prepare", true, `Preparing ${run.state.mode} launch · dev buy ${solString(o.devBuyLamports)} SOL · ${bundleRows.length} bundle wallet(s)`);
  run.state.status = "sending";
  emit(run, { type: "state", data: launchStateOf(run) });

  let created: { confirmed: boolean; signature?: string; error?: string } = { confirmed: false, error: "not sent" };
  let buyOutcomes: { confirmed: boolean; error?: string }[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    let prep: LaunchPrep;
    try {
      prep = await prepareLaunch(
        conn,
        { dev: st.sol.keypair(dev), name: run.state.name, symbol: run.state.symbol, uri: o.uri, devBuyLamports: o.devBuyLamports, mint: o.pendingKeypair, cashback: o.cashback },
        bundleRows,
        { cuPrice: o.cuPrice, slippageBps: o.slippageBps, tipLamports: run.state.mode === "bundle" ? o.bundleTip : tipLamportsFor(undefined) },
      );
    } catch (e) {
      created = { confirmed: false, error: e instanceof Error ? e.message : String(e) };
      break;
    }
    if (attempt === 0) step(run, "prepare", true, prep.atomic ? "Dev buy is atomic with the creation (guaranteed first buyer)." : o.devBuyLamports > BigInt(0) ? "Name/URI too long for an atomic dev buy: the dev buy goes in a separate transaction." : "No dev buy.");
    if (run.state.mode === "bundle") {
      const r = await launchBundle(conn, prep, {
        timeoutMs: 45_000,
        onStep: (s) => {
          if (s.phase === "bundle") step(run, "bundle", true, `Sending Jito bundle ${s.index + 1}/${s.total ?? 1}…`);
        },
      });
      created = r.create;
      buyOutcomes = r.buys;
      if (!created.confirmed && attempt < retries) {
        step(run, "bundle", false, `Bundle not landed (${created.error ?? "?"}) — retry ${attempt + 1}/${retries}`);
        continue;
      }
      break;
    } else {
      const r = await engineExecuteLaunch(conn, sendConn(), prep, {});
      created = r.create;
      buyOutcomes = r.buys;
      break;
    }
  }

  run.state.createSignature = created.signature ?? null;
  run.state.createConfirmed = created.confirmed;
  run.record.createSignature = created.signature ?? null;
  run.record.createConfirmed = created.confirmed;
  run.record.createError = created.confirmed ? null : (created.error ?? "unknown");
  jobPush(run.job, created.confirmed, { phase: "create", label: "create", address: dev, signature: created.signature ?? null, error: created.confirmed ? undefined : created.error });
  step(run, "create", created.confirmed, created.confirmed ? `Token created: ${mint}` : `Creation failed: ${created.error ?? "unknown"}`, { signature: created.signature ?? null });
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
  if (!created.confirmed) {
    run.state.status = "failed";
    run.state.error = created.error ?? "creation not confirmed";
    for (const t of run.tasks) if (t.type !== "bundle") setTask(run, t.id, { status: "stopped", error: "launch failed" });
    emit(run, { type: "error", data: { error: run.state.error } });
    emit(run, { type: "done", data: launchStateOf(run) });
    throw new Error(run.state.error);
  }
  run.state.status = "live";
  st.pendingMints.delete(mint);
  run.job.extra = { ...(run.job.extra ?? {}), phase: "live", createSignature: created.signature ?? null };

  // auto-dump / sell-on-external (one watcher per mint, both triggers merged)
  const ad = o.req.autoDump;
  const ext = o.req.sellOnExternalEnabled ? Number(o.req.sellOnExternalThreshold) : 0;
  if (ad || ext > 0) {
    try {
      const wallets = ad?.wallets?.length ? ad.wallets : run.record.wallets;
      armAutodump(mint, { percent: ad?.percent ?? 100, mcUsd: ad?.mcUsd, afterSec: ad?.afterSec, bundle: ad?.bundle, wallets, externalVolumeSol: ext > 0 ? ext : undefined }, wallets, (reason, jobId) => {
        if (run.state.sellOnExternal && /external/.test(reason)) run.state.sellOnExternal.fired = true;
        step(run, "autodump", true, `Auto-dump fired: ${reason} (job ${jobId})`);
      });
      step(run, "autodump", true, `Auto-dump armed${ad?.mcUsd ? ` · MC ≥ $${ad.mcUsd}` : ""}${ad?.afterSec ? ` · after ${ad.afterSec}s` : ""}${ext > 0 ? ` · external volume ≥ ${ext} SOL` : ""}`);
    } catch (e) {
      step(run, "autodump", false, `Auto-dump not armed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // snipers: immediate buys, with retries on the failed wallets
  const snipers = run.tasks.filter((t): t is Extract<NormTask, { type: "bundle" | "sniper" }> => t.type === "sniper" && t.autoStart);
  await Promise.all(
    snipers.map(async (t) => {
      setTask(run, t.id, { status: "running", startedAt: Date.now() });
      let remaining = [...t.wallets];
      const steps: LaunchTaskState["steps"] = [];
      let sent = 0;
      for (let attempt = 0; attempt <= t.autoRetryCount && remaining.length; attempt++) {
        try {
          const out = await buyWithWallets({ mint, wallets: remaining, lamportsEach: (a) => t.amounts.get(a)!, slippageBps: t.slippageBps, cuPrice: o.cuPrice, tipLamports: t.tipLamports, bundle: false, job: run.job, kind: "sniper" });
          for (const r of out) steps.push({ ok: r.ok, at: Date.now(), phase: "sniper", address: r.address, sol: r.sol, signature: r.signature, error: r.error ?? undefined });
          sent += out.filter((r) => r.ok).length;
          remaining = out.filter((r) => !r.ok).map((r) => r.address);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          steps.push({ ok: false, at: Date.now(), phase: "sniper", error: msg });
          if (/Insufficient|graduated|not found/i.test(msg)) break;
        }
        if (remaining.length && attempt < t.autoRetryCount) step(run, "sniper", false, `Sniper ${t.id}: ${remaining.length} wallet(s) failed — retry ${attempt + 1}/${t.autoRetryCount}`);
      }
      run.record.buysConfirmed += sent;
      setTask(run, t.id, { status: sent === t.wallets.length ? "done" : sent === 0 ? "error" : "done", done: t.wallets.length, sent, failed: t.wallets.length - sent, endedAt: Date.now(), steps, error: sent === 0 ? (steps.find((s) => s.error)?.error ?? "no buy confirmed") : null });
      step(run, "sniper", sent > 0, `Sniper ${t.id}: ${sent}/${t.wallets.length} buys confirmed`);
    }),
  );
  saveLaunches(st);

  // buy / volume loops
  for (const t of run.tasks) {
    if (t.type !== "buy" && t.type !== "volume") continue;
    const loop = new TradeLoop({ ...t.loopCfg, id: `${mint}:${t.id}`, taskId: t.id, mint, label: `${t.type} task ${t.id} · ${run.state.symbol}`, onChange: (s) => emit(run, { type: "task_status", data: s }) });
    run.loops.set(t.id, loop);
    loops().set(loop.cfg.id, loop);
    if (t.autoStart) {
      loop.start();
      step(run, "task", true, `${t.type} task ${t.id} started (${t.wallets.length} wallet(s), ${t.loopCfg.totalTrades} trades max)`, { taskId: t.id });
    } else emit(run, { type: "task_status", data: loop.state() });
  }

  // wash: after bundle/sniper buys
  for (const t of run.tasks) {
    if (t.type !== "wash" || !t.autoStart) continue;
    await runWash(run, t);
  }

  emit(run, { type: "done", data: launchStateOf(run) });
}

async function runWash(run: LaunchRun, t: Extract<NormTask, { type: "wash" }>): Promise<void> {
  setTask(run, t.id, { status: "running", startedAt: Date.now() });
  const steps: LaunchTaskState["steps"] = [];
  try {
    const res = await washTokens(run.state.mint, t.wallets, (s) => {
      steps.push(s);
      setTask(run, t.id, { done: steps.length, sent: steps.filter((x) => x.ok).length, failed: steps.filter((x) => !x.ok).length, steps });
    });
    const sent = res.filter((r) => r.ok).length;
    setTask(run, t.id, { status: res.length === 0 ? "done" : sent === 0 ? "error" : "done", done: res.length, sent, failed: res.length - sent, endedAt: Date.now(), steps, error: res.length && sent === 0 ? (res[0].error ?? "transfer failed") : null });
    step(run, "wash", sent > 0 || res.length === 0, res.length === 0 ? `Wash ${t.id}: no wallet holds tokens.` : `Wash ${t.id}: ${sent}/${res.length} wallet(s) moved to fresh wallets`, { taskId: t.id });
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
      if (loop.status === "pending") loop.start();
      else loop.resume();
    } else loop.stop();
    return loop.state();
  }
  const s = taskState(run, taskId);
  if (action === "stop" && s.status === "pending") return setTask(run, taskId, { status: "stopped", endedAt: Date.now() });
  if (action === "resume" && s.status === "pending" && run.state.status === "live") {
    if (t.type === "wash") {
      void runWash(run, t);
      return taskState(run, taskId);
    }
    if (t.type === "sniper") throw new HttpError(409, "Sniper tasks run once, right after the creation.");
  }
  if (action === "pause") throw new HttpError(409, `${t.type} tasks are not pausable (only buy and volume).`);
  return s;
}
