"use client";
import { useState } from "react";
import type { LaunchTaskState, TaskActionResponse } from "@/lib/types";
import { PAUSABLE_TASKS } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { Icon3D } from "../Icon3D";
import { Button, Dot, Progress, toast } from "../ui";
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
  const tone = t.status === "error" ? "down" : t.status === "done" ? "up" : t.status === "paused" ? "warn" : t.status === "running" ? "accent" : "muted";
  const pausable = PAUSABLE_TASKS.includes(t.type);
  const pctDone = t.total ? Math.round((t.done / t.total) * 100) : 0;
  const live = t.status === "running" || t.status === "paused" || t.status === "pending";
  return (
    <div className="card px-3 py-2.5 flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <Icon3D name={meta.icon} size={20} />
        <span className="font-medium">{meta.label}</span>
        {symbol ? <span className="text-text-3">· {symbol}</span> : null}
        <Dot tone={tone} pulse={t.status === "running"} />
        <span className="text-text-2">{TASK_STATUS_WORD[t.status]}</span>
        <span className="ml-auto mono text-[13px] text-text-3">
          {t.done}/{t.total ?? "∞"} trades{t.failed ? ` · ${t.failed} failed` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={pctDone} color={meta.color} className="flex-1" />
        {live ? (
          <span className="flex gap-1.5">
            {t.status === "running" && pausable ? (
              <Button size="xs" busy={busy} onClick={() => act("pause")} icon="pause">
                Pause
              </Button>
            ) : null}
            {t.status === "paused" ? (
              <Button size="xs" variant="primary" busy={busy} onClick={() => act("resume")} icon="play">
                Resume
              </Button>
            ) : null}
            <Button size="xs" variant="danger" busy={busy} onClick={() => act("stop")} icon="stop">
              Stop
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
