/* CTO (Block X "New CTO"): run tasks on a token someone else deploys. Nothing is deployed here. The record holds a
 * mint (known now) or a DEV wallet watched for 1 hour (CTO_WATCH_MS): when the feed sees a create by that dev, the
 * mint is filled in and the tasks with autoStart fire. Tasks reuse the launch machinery: sniper = immediate buys
 * (retries, stop on activity), buy/volume = TradeLoop `cto:<id>:<taskId>`, wash = source → wash pairs.
 * Records are kept in runtime.json ("ctos"); restored loops come back stopped/resumable like launch loops. */
import type { CtoCreateRequest, CtoRecord, CtoUpdateRequest, LaunchTask, LaunchTaskState } from "@/lib/types";
import { CTO_WATCH_MS } from "@/lib/types";
import { HttpError, isAddress, sleep } from "./api";
import { armAutodump, autodumpStatus, disarmAutodump } from "./autodump";
import { buyWithWallets, requireUnlocked } from "./engine";
import { feedDisabled, feedSubscribe } from "./feed";
import { jobNew, jobRun } from "./jobs";
import { normalizeTasks, type NormTask } from "./launch";
import { resolveMeta } from "./metadata";
import { registerRuntimeProducer, RESTORE_NOTE, restoreSection, saveRuntimeSoon } from "./persist";
import { logActivity, store, track } from "./store";
import { loops, TradeLoop, type SavedLoop } from "./tradeloop";
import { washPairs } from "./wash";

type Cto = {
  rec: Omit<CtoRecord, "taskStates" | "autoDump">;
  norm: NormTask[];
  states: Map<string, LaunchTaskState>;
  loops: Map<string, TradeLoop>;
  cancelled: Map<string, string>;
  jobId: string | null;
};
type SavedCto = { rec: Cto["rec"]; tasks: LaunchTask[]; states: LaunchTaskState[]; loops: Record<string, SavedLoop>; jobId: string | null };

function registry(): Map<string, Cto> {
  const rt = store().runtime;
  if (!rt.ctos) {
    const map = new Map<string, Cto>();
    rt.ctos = map;
    registerRuntimeProducer("ctos", () => [...map.values()].slice(-100).map((c): SavedCto => ({ rec: c.rec, tasks: c.rec.tasks, states: [...c.states.values()], loops: Object.fromEntries([...c.loops].map(([k, l]) => [k, l.snapshot()])), jobId: c.jobId })));
    for (const sv of restoreSection<SavedCto[]>("ctos") ?? []) {
      if (!sv?.rec?.id) continue;
      const c: Cto = { rec: { ...sv.rec, tasks: sv.tasks ?? [] }, norm: [], states: new Map((sv.states ?? []).map((s) => [s.id, s])), loops: new Map(), cancelled: new Map(), jobId: sv.jobId ?? null };
      for (const [taskId, saved] of Object.entries(sv.loops ?? {})) {
        try {
          const loop = TradeLoop.restore(saved);
          c.loops.set(taskId, loop);
          loops().set(loop.cfg.id, loop);
        } catch {
          /* unreadable loop */
        }
      }
      for (const s of c.states.values()) if (s.status === "running" || s.status === "paused") Object.assign(s, { status: "stopped", error: RESTORE_NOTE, endedAt: Date.now() });
      if (c.rec.status === "running") c.rec.status = "stopped";
      map.set(c.rec.id, c);
    }
  }
  return rt.ctos as Map<string, Cto>;
}

const watchKey = (c: Cto, taskId: string) => `${c.rec.mint}#cto:${c.rec.id}:${taskId}`;

function refresh(c: Cto): void {
  if (c.rec.status === "watching" && c.rec.expiresAt && Date.now() > c.rec.expiresAt) c.rec.status = "expired";
}

function taskState(c: Cto, t: NormTask | LaunchTask, i: number): LaunchTaskState {
  const id = String(t.id ?? `t${i + 1}`);
  const loop = c.loops.get(id);
  if (loop) return loop.state();
  const s = c.states.get(id);
  if (s) return s;
  const wallets = "wallets" in t ? t.wallets : (t.walletIds ?? []);
  return { id, type: t.type, status: "pending", wallets, done: 0, total: t.type === "sniper" ? wallets.length : null, sent: 0, failed: 0, nextAt: 0, error: null, startedAt: null, endedAt: null, steps: [], pairs: "pairs" in t && t.type === "wash" ? t.pairs : undefined };
}

export function ctoView(c: Cto): CtoRecord {
  refresh(c);
  const list = c.norm.length ? c.norm : c.rec.tasks;
  const ad = c.rec.mint ? autodumpStatus(c.rec.mint) : null;
  return { ...c.rec, taskStates: list.map((t, i) => taskState(c, t, i)), autoDump: ad && ad.armedAt ? ad : null };
}

export function listCtos(): CtoRecord[] {
  return [...registry().values()].sort((a, b) => b.rec.createdAt - a.rec.createdAt).map(ctoView);
}

export function getCto(id: string): Cto {
  const c = registry().get(id);
  if (!c) throw new HttpError(404, "Unknown CTO.");
  return c;
}

function validateTasks(tasks: LaunchTask[] | undefined): { raw: LaunchTask[]; norm: NormTask[] } {
  const raw = Array.isArray(tasks) ? tasks : [];
  if (raw.some((t) => t?.type === "bundle")) throw new HttpError(400, "A Bundle task only exists inside a launch (it rides the create transaction): use a Sniper task on a CTO.");
  if (raw.length > 20) throw new HttpError(400, "20 tasks max per CTO.");
  const norm = raw.length ? normalizeTasks({ tasks: raw }, null) : [];
  return { raw, norm };
}

async function fillMeta(c: Cto): Promise<void> {
  if (!c.rec.mint) return;
  const m = await resolveMeta(c.rec.mint, undefined, store().sol.connection()).catch(() => null);
  if (m) {
    if (m.name && (c.rec.name === "New CTO" || !c.rec.name)) c.rec.name = m.name;
    c.rec.symbol = m.symbol ?? c.rec.symbol;
    c.rec.image = m.image ?? c.rec.image;
    saveRuntimeSoon();
  }
}

export async function createCto(req: CtoCreateRequest): Promise<CtoRecord> {
  const st = store();
  const name = String(req.name ?? "").trim().slice(0, 64) || "New CTO";
  const address = String(req.address ?? "").trim();
  if (address && !isAddress(address)) throw new HttpError(400, "address: a base58 mint or wallet address is expected.");
  const addressIs = req.addressIs === "dev" ? "dev" : "token";
  let tasks = validateTasks(req.tasks);
  if (req.presetId) {
    const p = st.presets.find((x) => x.id === req.presetId);
    if (!p) throw new HttpError(404, "Unknown global task preset.");
    const fromPreset = Array.isArray(p.data.tasks) ? (p.data.tasks as LaunchTask[]) : [];
    if (!tasks.raw.length && fromPreset.length) tasks = validateTasks(fromPreset);
  }
  const id = "cto_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const c: Cto = {
    rec: { id, name, mint: address && addressIs === "token" ? address : null, devWallet: address && addressIs === "dev" ? address : null, status: address && addressIs === "token" ? "ready" : "watching", createdAt: now, expiresAt: address && addressIs === "token" ? null : now + CTO_WATCH_MS, foundAt: address && addressIs === "token" ? now : null, symbol: null, image: null, tasks: tasks.raw },
    norm: tasks.norm,
    states: new Map(),
    loops: new Map(),
    cancelled: new Map(),
    jobId: null,
  };
  registry().set(id, c);
  saveRuntimeSoon();
  logActivity(st, { kind: "cto", ok: true, message: `CTO ${name}: ${c.rec.mint ? `token ${c.rec.mint.slice(0, 6)}…` : c.rec.devWallet ? `watching dev ${c.rec.devWallet.slice(0, 6)}… for 1 h` : "no address yet"}, ${tasks.raw.length} task(s)`, mint: c.rec.mint ?? undefined });
  if (c.rec.mint) {
    track(st, c.rec.mint);
    await fillMeta(c);
    if (c.norm.some((t) => t.autoStart)) await startCto(id, true);
  } else if (c.rec.devWallet) watchFeed();
  return ctoView(c);
}

export async function updateCto(id: string, req: CtoUpdateRequest): Promise<CtoRecord> {
  const c = getCto(id);
  if (req.name !== undefined) c.rec.name = String(req.name).trim().slice(0, 64) || c.rec.name;
  if (req.tasks !== undefined) {
    if (c.rec.status === "running") throw new HttpError(409, "Stop the CTO before changing its tasks.");
    const t = validateTasks(req.tasks);
    c.rec.tasks = t.raw;
    c.norm = t.norm;
    c.states.clear();
  }
  if (req.address !== undefined) {
    const address = String(req.address).trim();
    if (!isAddress(address)) throw new HttpError(400, "address: a base58 mint or wallet address is expected.");
    if (c.rec.status === "running") throw new HttpError(409, "Stop the CTO before changing its address.");
    if (req.addressIs === "dev") {
      c.rec.devWallet = address;
      c.rec.mint = null;
      c.rec.status = "watching";
      c.rec.expiresAt = Date.now() + CTO_WATCH_MS;
      c.rec.foundAt = null;
      watchFeed();
    } else await setMint(c, address, "set by user");
  }
  saveRuntimeSoon();
  return ctoView(c);
}

export function deleteCto(id: string): void {
  const c = getCto(id);
  stopCto(id);
  registry().delete(c.rec.id);
  saveRuntimeSoon();
}

async function setMint(c: Cto, mint: string, how: string): Promise<void> {
  c.rec.mint = mint;
  c.rec.status = "ready";
  c.rec.expiresAt = null;
  c.rec.foundAt = Date.now();
  track(store(), mint);
  saveRuntimeSoon();
  logActivity(store(), { kind: "cto", ok: true, message: `CTO ${c.rec.name}: token ${mint.slice(0, 6)}… (${how})`, mint });
  await fillMeta(c);
  if (c.norm.some((t) => t.autoStart)) await startCto(c.rec.id, true).catch((e) => logActivity(store(), { kind: "cto", ok: false, message: `CTO ${c.rec.name}: tasks not started: ${e instanceof Error ? e.message : String(e)}`, mint }));
}

/* feed hook: a create by a watched dev wallet fills the mint in */
function watchFeed(): void {
  const rt = store().runtime;
  if (rt.ctoFeedHooked || feedDisabled()) return;
  rt.ctoFeedHooked = true;
  feedSubscribe((ev) => {
    if (ev.type !== "create" || !ev.data.creator) return;
    for (const c of registry().values()) {
      refresh(c);
      if (c.rec.status === "watching" && c.rec.devWallet === ev.data.creator) void setMint(c, ev.data.mint, "feed saw the create");
    }
  });
}

/* ------------------------------------------------------------------ run */

export async function startCto(id: string, onlyAutoStart = false): Promise<CtoRecord> {
  requireUnlocked();
  const c = getCto(id);
  refresh(c);
  if (!c.rec.mint) throw new HttpError(409, c.rec.status === "expired" ? "The 1 h watch expired without a token: set the address with PATCH." : "No token yet: the CTO is still watching its dev wallet.");
  if (c.rec.status === "running") throw new HttpError(409, "This CTO's tasks already run.");
  if (!c.norm.length && c.rec.tasks.length) c.norm = normalizeTasks({ tasks: c.rec.tasks }, null);
  const tasks = c.norm.filter((t) => !onlyAutoStart || t.autoStart);
  if (tasks.length === 0) throw new HttpError(400, "No task to run on this CTO (add tasks with PATCH).");
  const mint = c.rec.mint;
  c.rec.status = "running";
  c.cancelled.clear();
  const job = jobNew("cto", tasks.length, `CTO ${c.rec.name} · ${tasks.length} task(s) · ${mint.slice(0, 6)}…`);
  job.extra = { ctoId: id, mint };
  c.jobId = job.id;
  saveRuntimeSoon();
  jobRun(job, async () => {
    const snipers = tasks.filter((t): t is Extract<NormTask, { type: "sniper" }> => t.type === "sniper");
    await Promise.all(snipers.map((t) => runSniper(c, t)));
    for (const t of tasks) if (t.type === "buy" || t.type === "volume") startLoop(c, t);
    for (const t of tasks) if (t.type === "wash") await runWash(c, t);
    const anyLoop = [...c.loops.values()].some((l) => l.status === "running" || l.status === "paused");
    if (!anyLoop) c.rec.status = "ready";
    saveRuntimeSoon();
  });
  return ctoView(c);
}

export function stopCto(id: string): CtoRecord {
  const c = getCto(id);
  for (const t of c.norm.length ? c.norm : c.rec.tasks) {
    const tid = String(t.id ?? "");
    c.cancelled.set(tid, "stopped by user");
    const loop = c.loops.get(tid);
    if (loop) loop.stop();
    else {
      const s = c.states.get(tid);
      if (s && (s.status === "running" || s.status === "pending")) Object.assign(s, { status: "stopped", endedAt: Date.now(), error: "stopped by user" });
    }
    if (c.rec.mint) disarmAutodump(watchKey(c, tid), true);
  }
  if (c.rec.status === "running") c.rec.status = "stopped";
  saveRuntimeSoon();
  return ctoView(c);
}

function setState(c: Cto, id: string, patch: Partial<LaunchTaskState>, base: LaunchTaskState): LaunchTaskState {
  const s = Object.assign(c.states.get(id) ?? base, patch);
  c.states.set(id, s);
  saveRuntimeSoon();
  return s;
}

async function runSniper(c: Cto, t: Extract<NormTask, { type: "sniper" }>): Promise<void> {
  const mint = c.rec.mint!;
  const base: LaunchTaskState = { id: t.id, type: "sniper", status: "running", wallets: t.wallets, done: 0, total: t.wallets.length, sent: 0, failed: 0, nextAt: 0, error: null, startedAt: Date.now(), endedAt: null, steps: [] };
  setState(c, t.id, { status: "running", startedAt: Date.now() }, base);
  const key = watchKey(c, t.id);
  if (t.activitySol !== null) {
    try {
      armAutodump(mint, { percent: 100, action: "notify", externalVolumeSol: t.activitySol, label: `CTO sniper ${t.id} · Stop on activity` }, [], (reason) => c.cancelled.set(t.id, `stop on activity: ${reason}`), key);
    } catch {
      /* watch not armed: the sniper still runs */
    }
  }
  const steps: LaunchTaskState["steps"] = [];
  let remaining = [...t.wallets];
  let sent = 0;
  const cancelled = () => c.cancelled.get(t.id) ?? null;
  try {
    for (let attempt = 0; attempt <= t.autoRetryCount && remaining.length && !cancelled(); attempt++) {
      const failed: string[] = [];
      for (let i = 0; i < remaining.length; i++) {
        if (cancelled()) break;
        if (i > 0 && t.maxDelayMs > 0) await sleep(Math.round(t.minDelayMs + Math.random() * Math.max(0, t.maxDelayMs - t.minDelayMs)));
        const w = remaining[i];
        try {
          const [r] = await buyWithWallets({ mint, wallets: [w], lamportsEach: t.amounts.get(w)!, slippageBps: t.slippageBps, cuPrice: store().settings.cuPrice, tipLamports: t.tipLamports, bundle: false, job: null, kind: "sniper" });
          steps.push({ ok: r.ok, at: Date.now(), phase: "sniper", address: r.address, sol: r.sol, signature: r.signature, error: r.error ?? undefined });
          if (r.ok) sent++;
          else failed.push(w);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          steps.push({ ok: false, at: Date.now(), phase: "sniper", address: w, error: msg });
          failed.push(w);
          if (/graduated|not found|locked|Insufficient/i.test(msg)) {
            remaining = [];
            break;
          }
        }
        setState(c, t.id, { done: steps.length, sent, failed: steps.length - sent, steps: steps.slice(-50) }, base);
      }
      remaining = remaining.filter((w) => failed.includes(w));
    }
  } finally {
    disarmAutodump(key, true);
  }
  const stop = cancelled();
  setState(c, t.id, { status: stop ? "stopped" : sent === t.wallets.length ? "done" : sent === 0 ? "error" : "done", done: t.wallets.length, sent, failed: t.wallets.length - sent, endedAt: Date.now(), steps: steps.slice(-50), error: stop ?? (sent === 0 ? (steps.find((s) => s.error)?.error ?? "no buy confirmed") : null) }, base);
}

function startLoop(c: Cto, t: Extract<NormTask, { type: "buy" | "volume" }>): void {
  const mint = c.rec.mint!;
  const loop = new TradeLoop({ ...t.loopCfg, id: `cto:${c.rec.id}:${t.id}`, taskId: t.id, mint, label: `CTO ${c.rec.name} · ${t.type} ${t.id}` });
  c.loops.set(t.id, loop);
  loops().set(loop.cfg.id, loop);
  loop.start();
  if (t.activitySol !== null) {
    const key = watchKey(c, t.id);
    try {
      armAutodump(mint, { percent: 100, action: "notify", externalVolumeSol: t.activitySol, label: `CTO ${t.type} ${t.id} · Stop on activity` }, [], (reason) => {
        loop.stop();
        loop.steps.push({ ok: true, at: Date.now(), note: `Stopped on activity: ${reason}` });
      }, key);
      void (async () => {
        while (loop.status === "running" || loop.status === "paused") await sleep(1000);
        disarmAutodump(key, true);
        if (![...c.loops.values()].some((l) => l.status === "running" || l.status === "paused") && c.rec.status === "running") c.rec.status = "ready";
      })();
    } catch {
      /* watch not armed */
    }
  }
}

async function runWash(c: Cto, t: Extract<NormTask, { type: "wash" }>): Promise<void> {
  const base: LaunchTaskState = { id: t.id, type: "wash", status: "running", wallets: t.wallets, done: 0, total: t.pairs.reduce((s, p) => s + p.wash.length, 0), sent: 0, failed: 0, nextAt: 0, error: null, startedAt: Date.now(), endedAt: null, steps: [], pairs: t.pairs };
  setState(c, t.id, { status: "running", startedAt: Date.now() }, base);
  const steps: LaunchTaskState["steps"] = [];
  try {
    const res = await washPairs(c.rec.mint!, t.pairs, { minDelayMs: t.minDelayMs, maxDelayMs: t.maxDelayMs, shouldStop: () => c.cancelled.has(t.id), onStep: (s) => { steps.push(s); setState(c, t.id, { steps: steps.slice(-50), sent: steps.filter((x) => x.ok && x.signature).length, failed: steps.filter((x) => !x.ok).length }, base); } });
    const sent = res.filter((r) => r.ok).length;
    const stop = c.cancelled.get(t.id);
    setState(c, t.id, { status: stop ? "stopped" : res.length === 0 ? "done" : sent === 0 ? "error" : "done", done: res.length, sent, failed: res.length - sent, endedAt: Date.now(), error: stop ?? (res.length && sent === 0 ? (res[0].error ?? "transfer failed") : null) }, base);
  } catch (e) {
    setState(c, t.id, { status: "error", endedAt: Date.now(), error: e instanceof Error ? e.message : String(e) }, base);
  }
}
