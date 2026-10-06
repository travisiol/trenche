/* Trade loops: Block X "buy" / "volume" tasks and the BRIEF volume bot.
 * One loop = a sequence of real buys/sells from a set of wallets with random amounts and delays.
 * Pausable/stoppable; every trade is journaled in a job and in activity.json. */
import type { JobStep, LaunchTaskState, TradeMode, VolumeConfig } from "@/lib/types";
import { TASK_LIMITS } from "@/lib/types";
import { lamportsOf, sleep, solString } from "./api";
import { buyWithWallets, sellWithWallets, tipLamportsFor, type TradeOutcome } from "./engine";
import { jobNew, jobPush, jobRun, jobWait } from "./jobs";
import { registerRuntimeProducer, RESTORE_NOTE, restoreSection, saveRuntimeSoon } from "./persist";
import { store, type Job } from "./store";

export type LoopConfig = {
  id: string;
  taskId: string;
  type: "buy" | "volume";
  mint: string;
  wallets: string[];
  minLamports: bigint;
  maxLamports: bigint;
  minDelayMs: number;
  maxDelayMs: number;
  tradeMode: TradeMode;
  buyRatioPercent: number;
  /** total trades to do (rounds × wallets or maxTradesPerWallet × wallets) */
  totalTrades: number;
  maxDurationMs: number | null;
  slippageBps: number;
  cuPrice: number;
  tipLamports: bigint;
  bundle: boolean;
  label: string;
  /** called on every status change (SSE) */
  onChange?: (state: LaunchTaskState) => void;
};

export class TradeLoop {
  cfg: LoopConfig;
  job: Job;
  status: LaunchTaskState["status"] = "pending";
  done = 0;
  sent = 0;
  failed = 0;
  nextAt = 0;
  error: string | null = null;
  startedAt: number | null = null;
  endedAt: number | null = null;
  steps: JobStep[] = [];
  /** true when restored from runtime.json after a restart: status "stopped", start() continues the trade count */
  resumable = false;
  private paused = false;
  private stopped = false;
  private running: Promise<void> | null = null;

  constructor(cfg: LoopConfig) {
    this.cfg = cfg;
    this.job = jobNew(cfg.type === "buy" ? "buy-loop" : "volume", cfg.totalTrades, cfg.label);
    this.job.extra = { mint: cfg.mint, taskId: cfg.taskId, loopId: cfg.id, round: 0 };
  }

  state(): LaunchTaskState {
    return {
      id: this.cfg.taskId,
      type: this.cfg.type,
      status: this.status,
      wallets: this.cfg.wallets,
      done: this.done,
      total: this.cfg.totalTrades,
      sent: this.sent,
      failed: this.failed,
      nextAt: this.nextAt,
      error: this.error,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      steps: this.steps.slice(-50),
      resumable: this.resumable || undefined,
    };
  }

  private emit(): void {
    this.cfg.onChange?.(this.state());
    saveRuntimeSoon();
  }

  /** serializable snapshot (bigints as strings) for runtime.json */
  snapshot(): SavedLoop {
    const { onChange: _o, ...c } = this.cfg;
    return { cfg: { ...c, minLamports: c.minLamports.toString(), maxLamports: c.maxLamports.toString(), tipLamports: c.tipLamports.toString() }, jobId: this.job.id, status: this.status, done: this.done, sent: this.sent, failed: this.failed, error: this.error, startedAt: this.startedAt, endedAt: this.endedAt, steps: this.steps.slice(-100) };
  }

  /** rebuild a loop from its snapshot as "stopped, resumable" (or keep its final status when it had ended) */
  static restore(saved: SavedLoop, onChange?: LoopConfig["onChange"]): TradeLoop {
    const c = saved.cfg;
    const loop = new TradeLoop({ ...c, minLamports: BigInt(c.minLamports), maxLamports: BigInt(c.maxLamports), tipLamports: BigInt(c.tipLamports), onChange });
    loop.done = saved.done;
    loop.sent = saved.sent;
    loop.failed = saved.failed;
    loop.steps = saved.steps ?? [];
    loop.startedAt = saved.startedAt;
    loop.endedAt = saved.endedAt;
    loop.error = saved.error;
    const ended = saved.status === "done" || saved.status === "error" || saved.status === "stopped";
    loop.status = ended ? saved.status : "stopped";
    loop.resumable = !ended && loop.done < c.totalTrades;
    if (loop.resumable) {
      loop.steps.push({ ok: true, at: Date.now(), note: RESTORE_NOTE });
      loop.endedAt = Date.now();
    }
    // keep the pre-restart job (restored from jobs.json) instead of a duplicate
    const st = store();
    const old = saved.jobId ? st.jobs.get(saved.jobId) : undefined;
    if (old) {
      st.jobs.delete(loop.job.id);
      loop.job = old;
    }
    loop.job.status = "stopped";
    loop.job.error = loop.resumable ? RESTORE_NOTE : null;
    loop.job.endedAt = Date.now();
    loop.job.completed = loop.done;
    loop.job.sent = loop.sent;
    loop.job.failed = loop.failed;
    return loop;
  }

  start(): void {
    if (this.running) return;
    this.resumable = false;
    this.stopped = false;
    this.job.status = "running";
    this.job.error = null;
    this.job.endedAt = null;
    this.job.stop = false;
    this.status = "running";
    this.startedAt = this.startedAt ?? Date.now();
    this.endedAt = null;
    this.emit();
    this.running = this.run();
    jobRun(this.job, async () => {
      await this.running;
      if (this.error) throw new Error(this.error);
    });
  }

  pause(): void {
    if (this.status === "running") {
      this.paused = true;
      this.status = "paused";
      this.emit();
    }
  }

  resume(): void {
    if (this.status === "paused") {
      this.paused = false;
      this.status = "running";
      this.emit();
    }
  }

  stop(): void {
    if (this.status === "running" || this.status === "paused" || this.status === "pending") {
      this.stopped = true;
      this.paused = false;
      this.job.stop = true;
      // the run loop notices within 250 ms; report "stopped" right away (no trade starts after this point)
      this.status = "stopped";
      this.nextAt = 0;
      this.endedAt = Date.now();
      this.emit();
    }
  }

  private pickSide(): "buy" | "sell" {
    if (this.cfg.tradeMode === "buy") return "buy";
    if (this.cfg.tradeMode === "sell") return "sell";
    return Math.random() * 100 < this.cfg.buyRatioPercent ? "buy" : "sell";
  }

  private async run(): Promise<void> {
    const c = this.cfg;
    const st = store();
    const t0 = Date.now();
    let i = 0;
    try {
      while (this.done < c.totalTrades && !this.stopped) {
        if (c.maxDurationMs && Date.now() - t0 > c.maxDurationMs) {
          this.steps.push({ ok: true, at: Date.now(), note: "Max duration reached." });
          break;
        }
        while (this.paused && !this.stopped) await sleep(250);
        if (this.stopped) break;
        // Buy task (Block X: Min (s) / Max (s) only): the delay comes BEFORE each wallet's buy — "buy 0.1 between 2 and
        // 5 s", once per wallet (2026-10-06: it bought at once, then looped). Volume keeps trade-then-wait.
        if (c.type === "buy" && c.maxDelayMs > 0) {
          const gap = c.minDelayMs + Math.random() * Math.max(0, c.maxDelayMs - c.minDelayMs);
          this.nextAt = Date.now() + gap;
          jobWait(this.job, gap);
          this.emit();
          const until = Date.now() + gap;
          while (Date.now() < until && !this.stopped) await sleep(Math.min(250, until - Date.now()));
          this.nextAt = 0;
          while (this.paused && !this.stopped) await sleep(250);
          if (this.stopped) break;
        }
        const wallet = c.wallets[i % c.wallets.length];
        i++;
        const side = this.pickSide();
        const span = Number(c.maxLamports - c.minLamports);
        const lamports = c.minLamports + BigInt(Math.round(Math.random() * Math.max(0, span)));
        let out: TradeOutcome[] = [];
        let err: string | null = null;
        try {
          out =
            side === "buy"
              ? await buyWithWallets({ mint: c.mint, wallets: [wallet], lamportsEach: lamports, slippageBps: c.slippageBps, cuPrice: c.cuPrice, tipLamports: c.tipLamports, bundle: c.bundle, job: null, kind: c.type === "buy" ? "buy-loop" : "volume" })
              : await sellWithWallets({ mint: c.mint, wallets: [wallet], percent: 25 + Math.floor(Math.random() * 76), slippageBps: c.slippageBps, cuPrice: c.cuPrice, tipLamports: c.tipLamports, bundle: c.bundle, job: null, kind: c.type === "buy" ? "buy-loop" : "volume" });
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }
        const o = out[0];
        const ok = !!o?.ok;
        this.done++;
        if (ok) this.sent++;
        else this.failed++;
        const step: JobStep = { ok, at: Date.now(), phase: side, address: wallet, sol: o?.sol ?? solString(lamports), signature: o?.signature ?? null, error: err ?? o?.error ?? undefined };
        this.steps.push(step);
        if (this.steps.length > 400) this.steps.splice(0, this.steps.length - 400);
        jobPush(this.job, ok, step);
        this.job.extra = { ...(this.job.extra ?? {}), round: Math.ceil(this.done / c.wallets.length) };
        this.emit();
        // a curve that no longer exists / graduated: stop instead of hammering
        if (err && /graduated|not found|locked/i.test(err)) {
          this.error = err;
          break;
        }
        if (this.done >= c.totalTrades) break;
        if (c.type === "buy") continue; // its delay is taken before the next wallet's buy
        const gap = c.minDelayMs + Math.random() * Math.max(0, c.maxDelayMs - c.minDelayMs);
        this.nextAt = Date.now() + gap;
        jobWait(this.job, gap);
        this.emit();
        const until = Date.now() + gap;
        while (Date.now() < until && !this.stopped) await sleep(Math.min(250, until - Date.now()));
        this.nextAt = 0;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.status = this.error ? "error" : this.stopped ? "stopped" : "done";
    this.endedAt = Date.now();
    this.running = null;
    this.nextAt = 0;
    this.emit();
    void st;
  }
}

export type SavedLoop = {
  cfg: Omit<LoopConfig, "onChange" | "minLamports" | "maxLamports" | "tipLamports"> & { minLamports: string; maxLamports: string; tipLamports: string };
  jobId?: string;
  status: LaunchTaskState["status"];
  done: number;
  sent: number;
  failed: number;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
  steps: JobStep[];
};

type Registry = Map<string, TradeLoop>;
/** every loop (launch tasks + standalone volume bots). Standalone `vol:` loops are persisted here; launch loops
 *  are persisted with their launch (launch.ts) */
export function loops(): Registry {
  const rt = store().runtime;
  if (!rt.loops) {
    const map = new Map<string, TradeLoop>();
    rt.loops = map;
    registerRuntimeProducer("volumeLoops", () => [...map.values()].filter((l) => l.cfg.id.startsWith("vol:")).map((l) => l.snapshot()));
    for (const saved of restoreSection<SavedLoop[]>("volumeLoops") ?? []) {
      try {
        const loop = TradeLoop.restore(saved);
        map.set(loop.cfg.id, loop);
      } catch {
        /* unreadable entry */
      }
    }
  }
  return rt.loops as Registry;
}

export function loopGet(id: string): TradeLoop | undefined {
  return loops().get(id);
}

/** build a loop from the BRIEF VolumeConfig (standalone volume bot, id = `vol:<mint>`) */
export function volumeLoopFromConfig(mint: string, cfg: VolumeConfig, wallets: string[], label: string): TradeLoop {
  const st = store();
  const id = `vol:${mint}`;
  const prev = loops().get(id);
  if (prev && (prev.status === "running" || prev.status === "paused")) throw new Error("A volume bot already runs on this mint. Stop it first.");
  const minL = lamportsOf(cfg.minSol, "minSol");
  const maxL = lamportsOf(cfg.maxSol ?? cfg.minSol, "maxSol");
  if (maxL < minL) throw new Error("maxSol must be ≥ minSol.");
  const rounds = Math.max(1, Math.min(TASK_LIMITS.maxTradesPerWallet, Math.round(Number(cfg.rounds) || 1)));
  const minDelay = cfg.minDelayMs !== undefined ? Number(cfg.minDelayMs) : Number(cfg.minDelaySec ?? 0) * 1000;
  const maxDelay = cfg.maxDelayMs !== undefined ? Number(cfg.maxDelayMs) : Number(cfg.maxDelaySec ?? 0) * 1000;
  const mode: TradeMode = cfg.mode === "buy" || cfg.mode === "sell" ? cfg.mode : "both";
  const loop = new TradeLoop({
    id,
    taskId: id,
    type: "volume",
    mint,
    wallets,
    minLamports: minL,
    maxLamports: maxL,
    minDelayMs: Math.max(0, Math.min(TASK_LIMITS.maxIntervalSec * 1000, minDelay || 0)),
    maxDelayMs: Math.max(0, Math.min(TASK_LIMITS.maxIntervalSec * 1000, maxDelay || 0)),
    tradeMode: mode,
    buyRatioPercent: Math.max(0, Math.min(100, Number(cfg.buyRatioPercent ?? 50))),
    totalTrades: rounds * wallets.length,
    maxDurationMs: null,
    slippageBps: cfg.slippageBps ?? st.settings.slippageBps,
    cuPrice: cfg.cuPrice ?? st.settings.cuPrice,
    tipLamports: tipLamportsFor(undefined),
    bundle: false,
    label,
  });
  loops().set(id, loop);
  return loop;
}
