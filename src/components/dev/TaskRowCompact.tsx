"use client";
/** Compact live task row (dashboard "Active tasks") in Block X style. */
import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import type { LaunchTaskState, TaskActionResponse } from "@/lib/types";
import { PAUSABLE_TASKS } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { toast } from "../ui";
import { cx } from "../bx/ui";
import { TASK_META } from "../launch/model";

export const TASK_STATUS_WORD: Record<LaunchTaskState["status"], string> = {
  pending: "Waiting",
  running: "Running",
  paused: "Paused",
  done: "Done",
  stopped: "Stopped",
  error: "Failed",
};

export function TaskRowCompact({ launchId, t, symbol }: { launchId: string; t: LaunchTaskState; symbol?: string }) {
  const [busy, setBusy] = useState(false);
  const meta = TASK_META[t.type];
  const act = async (action: "pause" | "resume" | "stop") => {
    setBusy(true);
    try {
      await post<TaskActionResponse>(`/api/launch/${launchId}/tasks/${t.id}/${action}`, {});
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const tone = t.status === "error" ? "bg-decrease" : t.status === "done" ? "bg-green-100" : t.status === "paused" || t.status === "stopped" ? "bg-yellow-100" : t.status === "running" ? "bg-accent" : "bg-text-300";
  const pausable = PAUSABLE_TASKS.includes(t.type);
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
  const live = t.status === "running" || t.status === "paused" || t.status === "pending";
  const btn = "inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-medium disabled:opacity-40";
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-100 px-2.5 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={cx("h-2 w-2 shrink-0 rounded-full", tone, t.status === "running" ? "animate-pulse" : "")} />
        <span className="font-medium text-text-100">{meta.label}</span>
        {symbol ? <span className="text-text-300">· {symbol}</span> : null}
        <span className="text-text-300">{TASK_STATUS_WORD[t.status]}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-text-300">
          {t.done}/{t.total ?? "∞"}
          {t.failed ? ` · ${t.failed} failed` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line-50">
          <div className={cx("h-full", tone)} style={{ width: `${pct}%` }} />
        </div>
        {live && pausable && t.status === "running" ? (
          <button type="button" disabled={busy} onClick={() => act("pause")} className={cx(btn, "border-line-100 text-text-200 hover:text-text-100")}>
            <Pause className="h-3 w-3" /> Pause
          </button>
        ) : null}
        {t.status === "paused" || t.resumable ? (
          <button type="button" disabled={busy} onClick={() => act("resume")} className={cx(btn, "border-accent bg-accent text-white")}>
            <Play className="h-3 w-3" /> Resume
          </button>
        ) : null}
        {live ? (
          <button type="button" disabled={busy} onClick={() => act("stop")} className={cx(btn, "border-decrease/40 text-decrease hover:bg-decrease/10")}>
            <Square className="h-3 w-3" /> Stop
          </button>
        ) : null}
      </div>
    </div>
  );
}
