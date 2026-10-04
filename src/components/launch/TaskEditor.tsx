"use client";
/** Task cards of the Block X Tasks panel: draft cards (Edit / Delete, auto start) before launch, live cards
 *  (Start / Pause / Stop / Sell All, progress, activity watcher) once the launch runs. */
import { useState } from "react";
import { ChevronDown, Info, Pause, Pencil, Play, Square, Trash2 } from "lucide-react";
import type { JobCreated, LaunchTaskState, LaunchTaskType, TaskActionResponse, WalletInfo } from "@/lib/types";
import { PAUSABLE_TASKS } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { short, sol, time } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxSwitch, cx } from "@/components/bx/ui";
import { TASK_META, taskBuyFor, taskSentence, taskWallets, validateTask, type FormTask } from "./model";
import { TASK_STATUS_WORD } from "../dev/TaskRowCompact";

const btn = "inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

/** Draft task card — compact Block X row: type, summary, details toggle, Auto start, Edit, Delete. */
export function TaskCard({ task, wallets, detailsOpen, onEdit, onChange, onRemove }: { task: FormTask; wallets: WalletInfo[]; detailsOpen: boolean; onEdit: () => void; onChange: (t: FormTask) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(detailsOpen);
  const meta = TASK_META[task.type];
  const problems = validateTask(task);
  const picked = taskWallets(task, wallets);
  const startable = task.type === "buy" || task.type === "volume" || task.type === "wash";
  return (
    <div className={cx("task-card flex flex-col", problems.length ? "border-decrease/40" : "")}>
      <div className="flex h-10 items-center gap-2 px-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label={open ? "Collapse" : "Expand"}>
          <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", open ? "" : "-rotate-90")} />
        </button>
        <span className="text-sm font-medium text-text-100">{meta.label}</span>
        <span className="text-text-300" title={meta.blurb}>
          <Info className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-text-300">{taskSentence(task, wallets)}</span>
        {problems.length ? <span className="shrink-0 text-[11px] text-decrease">{problems[0]}</span> : null}
        {startable ? (
          <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-300" title={task.type === "wash" ? "Run the wash right after the launch confirms" : "Start as soon as the token mint is known"}>
            Auto start
            <BxSwitch checked={task.autoStart} onChange={(v) => onChange({ ...task, autoStart: v })} />
          </label>
        ) : null}
        <button type="button" onClick={onEdit} className={cx(btn, "border-line-100 text-text-200 hover:text-text-100")}>
          <Pencil className="h-3 w-3" /> Edit
        </button>
        <button type="button" onClick={onRemove} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-decrease" aria-label="Remove task">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-line-50 px-3 pb-2.5 pt-2 text-[11px]">
          {task.type === "wash" ? (
            Object.entries(task.washPairs).map(([s, ws]) => (
              <div key={s} className="flex items-center gap-2 text-text-200">
                <span className="text-text-100">{wallets.find((w) => w.address === s)?.label || short(s)}</span>
                <span className="text-text-300">→</span>
                <span className="truncate">{ws.map((a) => wallets.find((w) => w.address === a)?.label || short(a)).join(", ") || "no wash wallet"}</span>
              </div>
            ))
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((a) => {
                const w = wallets.find((x) => x.address === a);
                return (
                  <span key={a} className="inline-flex h-6 items-center gap-1.5 rounded border border-line-100 bg-bg-50 px-1.5 text-text-200">
                    {w?.label || short(a)}
                    {task.type === "bundle" || task.type === "sniper" || task.type === "buy" ? <span className="font-mono text-text-300">{sol(taskBuyFor(task, a))} SOL</span> : null}
                  </span>
                );
              })}
              {!picked.length ? <span className="text-text-300">No wallet picked yet.</span> : null}
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-300">
            <span>
              Slippage <span className="font-mono text-text-200">{task.slippagePercent}%</span>
            </span>
            <span>
              Tip <span className="font-mono text-text-200">{task.tip} SOL</span>
            </span>
            {task.type === "sniper" ? (
              <span>
                Delay <span className="font-mono text-text-200">{task.minDelaySec}–{task.maxDelaySec} s</span> · Retry <span className="font-mono text-text-200">{task.retry ? `${task.autoRetryCount}×` : "off"}</span>
              </span>
            ) : null}
            {task.stopOnActivity ? (
              <span>
                {task.type === "bundle" ? "Sell all on external" : "Stop on activity"} <span className="font-mono text-text-200">{task.stopOnActivitySol} SOL</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Live task card: Start / Pause / Stop / Sell All against POST /api/launch/[id]/tasks/[taskId]/* and /api/dev/dump. */
export function LiveTaskCard({ launchId, mint, t, wallets }: { launchId: string; mint: string; t: LaunchTaskState; wallets: WalletInfo[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const meta = TASK_META[t.type];
  const act = async (action: "pause" | "resume" | "stop") => {
    setBusy(action);
    try {
      await post<TaskActionResponse>(`/api/launch/${launchId}/tasks/${t.id}/${action}`, {});
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  const sellAll = async () => {
    if (!t.wallets.length) return toast("Sell All failed — this task has no wallet.", "err");
    if (!window.confirm(`Sell 100 % of the token on the ${t.wallets.length} wallet${t.wallets.length !== 1 ? "s" : ""} of this ${meta.label} task?`)) return;
    setBusy("sell");
    try {
      await post<JobCreated>("/api/dev/dump", { mint, wallets: t.wallets, percent: 100 });
      toast(`Selling 100 % on ${t.wallets.length} wallet${t.wallets.length !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  const pct = t.total ? Math.round((t.done / t.total) * 100) : t.status === "done" ? 100 : 0;
  const tone = t.status === "error" ? "bg-decrease" : t.status === "done" ? "bg-green-100" : t.status === "paused" || t.status === "stopped" ? "bg-yellow-100" : t.status === "running" ? "bg-accent" : "bg-text-300";
  const pausable = PAUSABLE_TASKS.includes(t.type);
  const activeNow = t.status === "running" || t.status === "paused" || t.status === "pending";
  const canStart = t.status === "paused" || t.status === "pending" || !!t.resumable;
  return (
    <div className="task-card flex flex-col">
      <div className="flex min-h-10 items-center gap-2 px-3 py-1.5 text-xs">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label={open ? "Collapse" : "Expand"}>
          <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", open ? "" : "-rotate-90")} />
        </button>
        <span className={cx("h-2 w-2 shrink-0 rounded-full", tone, t.status === "running" ? "animate-pulse" : "")} />
        <span className="font-medium text-text-100">{meta.label}</span>
        <span className="text-text-300">{TASK_STATUS_WORD[t.status]}</span>
        <span className="ml-auto font-mono text-[11px] text-text-300">
          {t.done}/{t.total ?? "∞"} · {t.sent} sent{t.failed ? ` · ${t.failed} failed` : ""} · {t.wallets.length} wallet{t.wallets.length !== 1 ? "s" : ""}
        </span>
        {canStart ? (
          <button type="button" disabled={!!busy} onClick={() => act("resume")} className={cx(btn, "border-accent bg-accent text-white")}>
            <Play className="h-3 w-3" /> Start
          </button>
        ) : null}
        {pausable && t.status === "running" ? (
          <button type="button" disabled={!!busy} onClick={() => act("pause")} className={cx(btn, "border-line-100 text-text-200 hover:text-text-100")}>
            <Pause className="h-3 w-3" /> Pause
          </button>
        ) : null}
        {activeNow ? (
          <button type="button" disabled={!!busy} onClick={() => act("stop")} className={cx(btn, "border-decrease/40 text-decrease hover:bg-decrease/10")}>
            <Square className="h-3 w-3" /> Stop
          </button>
        ) : null}
        <button type="button" disabled className={cx(btn, "border-line-100 text-text-300")} title="Tasks cannot be edited once the launch runs">
          <Pencil className="h-3 w-3" /> Edit
        </button>
        <button type="button" disabled={!!busy || !t.wallets.length} onClick={sellAll} className={cx(btn, "border-decrease/40 text-decrease hover:bg-decrease/10")} title="Sell 100 % of the token on this task's wallets">
          Sell All
        </button>
      </div>
      <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-line-50">
        <div className={cx("h-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      {t.error ? <p className="px-3 pb-2 text-[11px] text-decrease">{t.error}</p> : null}
      {t.activity ? (
        <p className="px-3 pb-2 text-[11px] text-text-300">
          External volume {t.activity.externalVolumeSol.toFixed(3)} / {t.activity.thresholdSol} SOL{t.activity.fired ? <span className="text-yellow-100"> — fired</span> : ""}
        </p>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-1 border-t border-line-50 px-3 py-2 text-[11px]">
          <div className="flex flex-wrap gap-1.5">
            {t.wallets.map((a) => (
              <span key={a} className="rounded border border-line-100 bg-bg-50 px-1.5 py-0.5 text-text-200">
                {wallets.find((w) => w.address === a)?.label || short(a)}
              </span>
            ))}
          </div>
          {t.pairs?.length ? (
            <div className="flex flex-col gap-0.5 text-text-300">
              {t.pairs.map((p) => (
                <span key={p.source}>
                  {wallets.find((w) => w.address === p.source)?.label || short(p.source)} → {p.wash.map((a) => wallets.find((w) => w.address === a)?.label || short(a)).join(", ")}
                </span>
              ))}
            </div>
          ) : null}
          {t.nextAt > 0 && t.status === "running" ? <span className="text-text-300">Next trade at {time(t.nextAt)}</span> : null}
          {t.steps.slice(-5).map((s, i) => (
            <span key={i} className={cx("truncate", s.ok ? "text-text-300" : "text-decrease")}>
              {time(s.at)} · {s.label ?? s.note ?? s.error ?? ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const TASK_TYPES = Object.keys(TASK_META) as LaunchTaskType[];
