"use client";
import { useState } from "react";
import type { LaunchTaskState, TaskActionResponse } from "@/lib/ui-types";
import { PAUSABLE_TASKS } from "@/lib/ui-types";
import { failureMessage, post } from "@/lib/api";
import { Icon3D } from "../Icon3D";
import { Button, Dot, Progress, toast } from "../ui";
import { TASK_META } from "../launch/model";

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
  return (
    <div className="card px-3 py-2 flex items-center gap-2 text-xs">
      <Icon3D name={meta.icon} size={18} />
      <span className="font-medium">{meta.label}</span>
      {symbol ? <span className="text-text-3">{symbol}</span> : null}
      <Dot tone={tone} pulse={t.status === "running"} />
      <span className="text-text-3">{t.status}</span>
      <div className="flex-1 min-w-[60px]">
        <Progress value={pctDone} color={meta.color} />
      </div>
      <span className="mono text-[11px] text-text-3">
        {t.done}/{t.total ?? "∞"}
        {t.failed ? ` · ${t.failed} failed` : ""}
      </span>
      {t.status === "running" && pausable ? (
        <Button size="xs" busy={busy} onClick={() => act("pause")}>
          Pause
        </Button>
      ) : null}
      {t.status === "paused" ? (
        <Button size="xs" variant="primary" busy={busy} onClick={() => act("resume")}>
          Resume
        </Button>
      ) : null}
      {t.status === "running" || t.status === "paused" || t.status === "pending" ? (
        <Button size="xs" variant="danger" busy={busy} onClick={() => act("stop")}>
          Stop
        </Button>
      ) : null}
    </div>
  );
}
