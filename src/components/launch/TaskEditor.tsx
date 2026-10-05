"use client";
/** Task sections of the Block X Tasks panel: a header (Sell All + ⋮ menu) over the task's wallet table. Draft
 *  sections (Edit / Auto start / Delete in the menu) before launch, live ones (Start / Pause / Stop, progress) after. */
import { useState } from "react";
import { MoreVertical, Pause, Pencil, Play, Square, Trash2, TrendingDown } from "lucide-react";
import type { LaunchTaskState, LaunchTaskType, TaskActionResponse } from "@/lib/types";
import { PAUSABLE_TASKS } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { short, time } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxSwitch, cx } from "@/components/bx/ui";
import { TASK_META, taskSentence, taskWallets, validateTask, type FormTask } from "./model";
import { TASK_STATUS_WORD } from "../dev/TaskRowCompact";
import { TaskSection, TaskTable, sectionDanger, useSellAll, type TradeCtx } from "./WalletRows";

const menuItem = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-100 hover:bg-hover-100 disabled:cursor-not-allowed disabled:opacity-40";

function Kebab({ children, label }: { children: (close: () => void) => React.ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-7 w-7 items-center justify-center rounded border border-line-100 bg-bg-50 text-text-300 transition-colors hover:text-text-100" aria-label={`${label} menu`}>
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-44 rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">{children(() => setOpen(false))}</div>
        </>
      ) : null}
    </div>
  );
}

/** Draft task section — wallet rows of the picked wallets; Edit / Auto start / Delete in the ⋮ menu. */
export function TaskCard({ task, ctx, detailsOpen, onEdit, onChange, onRemove }: { task: FormTask; ctx: TradeCtx; detailsOpen: boolean; onEdit: () => void; onChange: (t: FormTask) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(detailsOpen);
  const meta = TASK_META[task.type];
  const problems = validateTask(task);
  const picked = taskWallets(task, ctx.wallets);
  const startable = task.type === "buy" || task.type === "volume" || task.type === "wash";
  return (
    <TaskSection
      title={meta.label}
      info={`${meta.blurb}\n\n${taskSentence(task, ctx.wallets)} Slippage ${task.slippagePercent}% · tip ${task.tip} SOL.`}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      className={problems.length ? "bg-decrease/[0.04]" : undefined}
      status={problems.length ? <span className="truncate text-decrease">{problems[0]}</span> : null}
      right={
        <>
          <button type="button" disabled className={sectionDanger} title="Available once the token is launched">
            <TrendingDown className="h-3.5 w-3.5" /> Sell All
          </button>
          <Kebab label={meta.label}>
            {(close) => (
              <>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onEdit();
                  }}
                  className={menuItem}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                {startable ? (
                  <label className={cx(menuItem, "cursor-pointer justify-between")} title={task.type === "wash" ? "Run the wash right after the launch confirms" : "Start as soon as the token mint is known"}>
                    Auto start
                    <BxSwitch checked={task.autoStart} onChange={(v) => onChange({ ...task, autoStart: v })} />
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onRemove();
                  }}
                  className={cx(menuItem, "text-decrease")}
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </>
            )}
          </Kebab>
        </>
      }
    >
      {task.type === "wash" ? (
        <div className="flex flex-col gap-1 px-3 pb-2 text-[11px]">
          {Object.entries(task.washPairs).map(([s, ws]) => (
            <div key={s} className="flex items-center gap-2 text-text-200">
              <span className="text-text-100">{ctx.wallets.find((w) => w.address === s)?.label || short(s)}</span>
              <span className="text-text-300">→</span>
              <span className="truncate">{ws.map((a) => ctx.wallets.find((w) => w.address === a)?.label || short(a)).join(", ") || "no wash wallet"}</span>
            </div>
          ))}
        </div>
      ) : null}
      <TaskTable addresses={picked} ctx={ctx} />
    </TaskSection>
  );
}

/** Live task section: Start / Pause / Stop against POST /api/launch/[id]/tasks/[taskId]/*, Sell All, wallet rows. */
export function LiveTaskCard({ launchId, t, ctx, controls = true }: { launchId: string; t: LaunchTaskState; ctx: TradeCtx; /** false = CTO task states (controlled as a whole by Start / Stop on the rail) */ controls?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const meta = TASK_META[t.type];
  const { sellAll, busy: selling } = useSellAll(ctx);
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
  const pct = t.total ? Math.round((t.done / t.total) * 100) : t.status === "done" ? 100 : 0;
  const tone = t.status === "error" ? "bg-decrease" : t.status === "done" ? "bg-green-100" : t.status === "paused" || t.status === "stopped" ? "bg-yellow-100" : t.status === "running" ? "bg-accent" : "bg-text-300";
  const pausable = PAUSABLE_TASKS.includes(t.type);
  const activeNow = t.status === "running" || t.status === "paused" || t.status === "pending";
  const canStart = t.status === "paused" || t.status === "pending" || !!t.resumable;
  const ctl = "inline-flex h-7 items-center gap-1 rounded border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <TaskSection
      title={meta.label}
      info={`${meta.blurb}\n\n${t.done}/${t.total ?? "∞"} done · ${t.sent} sent${t.failed ? ` · ${t.failed} failed` : ""}`}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      status={
        <>
          <span className={cx("h-2 w-2 shrink-0 rounded-full", tone, t.status === "running" ? "animate-pulse" : "")} />
          <span>{TASK_STATUS_WORD[t.status]}</span>
          {t.total ? <span className="font-mono">{pct}%</span> : null}
        </>
      }
      right={
        <>
          {controls && canStart ? (
            <button type="button" disabled={!!busy} onClick={() => act("resume")} className={cx(ctl, "border-accent bg-accent text-white")}>
              <Play className="h-3 w-3" /> Start
            </button>
          ) : null}
          {controls && pausable && t.status === "running" ? (
            <button type="button" disabled={!!busy} onClick={() => act("pause")} className={cx(ctl, "border-line-100 bg-bg-50 text-text-200 hover:text-text-100")}>
              <Pause className="h-3 w-3" /> Pause
            </button>
          ) : null}
          {controls && activeNow ? (
            <button type="button" disabled={!!busy} onClick={() => act("stop")} className={cx(ctl, "border-line-100 bg-bg-50 text-decrease hover:bg-decrease/10")}>
              <Square className="h-3 w-3" /> Stop
            </button>
          ) : null}
          <button type="button" disabled={selling || !t.wallets.length} onClick={() => sellAll(t.wallets, meta.label)} className={sectionDanger} title="Sell 100 % of the token on this task's wallets">
            <TrendingDown className="h-3.5 w-3.5" /> Sell All
          </button>
          <Kebab label={meta.label}>
            {() => (
              <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto px-1 py-1 text-[11px]">
                <span className="text-text-200">
                  {t.done}/{t.total ?? "∞"} · {t.sent} sent{t.failed ? ` · ${t.failed} failed` : ""}
                </span>
                {t.nextAt > 0 && t.status === "running" ? <span className="text-text-300">Next trade at {time(t.nextAt)}</span> : null}
                {t.steps.slice(-6).map((s, i) => (
                  <span key={i} className={cx("truncate", s.ok ? "text-text-300" : "text-decrease")} title={s.label ?? s.note ?? s.error ?? ""}>
                    {time(s.at)} · {s.label ?? s.note ?? s.error ?? ""}
                  </span>
                ))}
                {!t.steps.length ? <span className="text-text-300">No step yet.</span> : null}
              </div>
            )}
          </Kebab>
        </>
      }
    >
      {t.total ? (
        <div className="mx-3 mb-2 h-0.5 overflow-hidden rounded-full bg-line-50">
          <div className={cx("h-full", tone)} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {t.error ? <p className="px-3 pb-2 text-[11px] text-decrease">{t.error}</p> : null}
      {t.activity ? (
        <p className="px-3 pb-2 text-[11px] text-text-300">
          External volume {t.activity.externalVolumeSol.toFixed(3)} / {t.activity.thresholdSol} SOL{t.activity.fired ? <span className="text-yellow-100"> — fired</span> : ""}
        </p>
      ) : null}
      {t.pairs?.length ? (
        <div className="flex flex-col gap-0.5 px-3 pb-2 text-[11px] text-text-300">
          {t.pairs.map((p) => (
            <span key={p.source}>
              {ctx.wallets.find((w) => w.address === p.source)?.label || short(p.source)} → {p.wash.map((a) => ctx.wallets.find((w) => w.address === a)?.label || short(a)).join(", ")}
            </span>
          ))}
        </div>
      ) : null}
      <TaskTable addresses={t.wallets} ctx={ctx} empty="This task has no wallet." />
    </TaskSection>
  );
}

export const TASK_TYPES = Object.keys(TASK_META) as LaunchTaskType[];
