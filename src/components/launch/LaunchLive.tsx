"use client";
/**
 * Live launch panel: subscribes to GET /api/launch/[id]/stream (events: state, step, task_status, done, error),
 * falls back to polling GET /api/launch/[id] every 2 s when the stream errors.
 * Shows mint, create signature, per-task status with pause/resume/stop, step log.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LaunchState, LaunchStep, LaunchTaskState, TaskActionResponse } from "@/lib/ui-types";
import { PAUSABLE_TASKS } from "@/lib/ui-types";
import { api, failureMessage, post, useSSE } from "@/lib/api";
import { pumpfunUrl, short, solscanTx, time } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { Button, Copy, Dot, Progress, Spinner, cx, toast } from "../ui";
import { TASK_META } from "./model";

export function useLaunchState(id: string | null) {
  const [state, setState] = useState<LaunchState | null>(null);
  const [sseDead, setSseDead] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = id && !sseDead ? `/api/launch/${id}/stream` : null;
  useSSE(url, {
    state: (d) => setState(d as LaunchState),
    done: (d) => setState(d as LaunchState),
    step: (d) => setState((s) => (s ? { ...s, steps: [...s.steps, d as LaunchStep] } : s)),
    task_status: (d) => setState((s) => (s ? { ...s, tasks: s.tasks.map((t) => (t.id === (d as LaunchTaskState).id ? (d as LaunchTaskState) : t)) } : s)),
    error: (d) => setErr((d as { error?: string })?.error ?? "stream error"),
    onError: () => setSseDead(true),
  });
  const finished = state?.status === "done" || state?.status === "failed";
  const polling = !!id && !url && !finished;
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const tick = () =>
      api<LaunchState>(`/api/launch/${id}`)
        .then((s) => alive && (setState(s), setErr(null)))
        .catch((e) => alive && setErr(failureMessage(e)));
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, polling]);
  return { state, error: err, viaPolling: sseDead };
}

const STATUS_TONE: Record<LaunchState["status"], "accent" | "up" | "down" | "warn"> = { preparing: "accent", sending: "accent", live: "up", failed: "down", done: "up" };

export function LaunchLive({ id, onReset }: { id: string; onReset?: () => void }) {
  const { state, error, viaPolling } = useLaunchState(id);
  if (!state) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-3 p-4">
        <Spinner size={14} /> {error ?? "Connecting to the launch stream…"}
      </div>
    );
  }
  const running = state.status === "preparing" || state.status === "sending";
  return (
    <div className="flex flex-col gap-4 fade-in">
      <div className="flex items-center gap-3">
        <Icon3D name="launch" size={36} glow />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{state.name}</span>
            <span className="text-text-3">{state.symbol}</span>
            <span className={cx("capsule", STATUS_TONE[state.status] === "up" ? "text-up border-up/30" : STATUS_TONE[state.status] === "down" ? "text-down border-down/30" : "text-accent border-accent/30")}>
              <Dot tone={STATUS_TONE[state.status]} pulse={running || state.status === "live"} /> {state.status}
            </span>
            {viaPolling ? <span className="text-[10px] text-text-3">polling</span> : null}
          </div>
          <div className="flex items-center gap-3 text-[11px] mt-0.5">
            <Copy text={state.mint}>{short(state.mint, 6, 6)}</Copy>
            <a href={pumpfunUrl(state.mint)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              pump.fun
            </a>
            <Link href={`/trade/${state.mint}`} className="text-accent hover:underline">
              Trade
            </Link>
            <Link href={`/dashboard?mint=${state.mint}`} className="text-accent hover:underline">
              Dev room
            </Link>
            {state.createSignature ? (
              <a href={solscanTx(state.createSignature)} target="_blank" rel="noreferrer" className="mono text-text-2 hover:text-accent">
                create {short(state.createSignature)} {state.createConfirmed ? "✓" : state.createConfirmed === false ? "✗" : "…"}
              </a>
            ) : null}
          </div>
        </div>
        {onReset && !running ? (
          <Button size="sm" variant="ghost" onClick={onReset}>
            New launch
          </Button>
        ) : null}
      </div>
      {state.error ? <div className="text-xs text-down bg-down-soft border border-down/20 rounded-lg px-3 py-2">{state.error}</div> : null}

      {state.tasks.length ? (
        <div className="flex flex-col gap-2">
          {state.tasks.map((t) => (
            <TaskRow key={t.id} launchId={state.id} t={t} />
          ))}
        </div>
      ) : null}

      {state.sellOnExternal ? (
        <div className="flex items-center gap-2 text-[11px] text-text-2">
          <Icon3D name="autodump" size={16} />
          Sell on external volume: {state.sellOnExternal.externalVolumeSol.toFixed(3)} / {state.sellOnExternal.threshold} SOL {state.sellOnExternal.fired ? "— fired" : ""}
        </div>
      ) : null}
      {state.autoDump?.armed ? (
        <div className="flex items-center gap-2 text-[11px] text-auto">
          <Icon3D name="autodump" size={16} />
          Auto-dump armed{state.autoDump.config?.mcUsd ? ` at $${state.autoDump.config.mcUsd}` : ""}
          {state.autoDump.config?.afterSec ? ` after ${state.autoDump.config.afterSec}s` : ""}
          {state.autoDump.firedAt ? " — fired" : ""}
        </div>
      ) : null}

      <StepLog steps={state.steps} />
    </div>
  );
}

function TaskRow({ launchId, t }: { launchId: string; t: LaunchTaskState }) {
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
  const pctDone = t.total ? Math.round((t.done / t.total) * 100) : t.status === "done" ? 100 : 0;
  const tone = t.status === "error" ? "down" : t.status === "done" ? "up" : t.status === "paused" ? "warn" : t.status === "running" ? "accent" : "muted";
  const pausable = PAUSABLE_TASKS.includes(t.type);
  return (
    <div className="card p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <Icon3D name={meta.icon} size={20} />
        <span className="font-medium">{meta.label}</span>
        <Dot tone={tone} pulse={t.status === "running"} />
        <span className="text-text-3">{t.status}</span>
        <span className="mono text-text-3 ml-auto">
          {t.done}/{t.total ?? "∞"} · {t.sent} sent{t.failed ? ` · ${t.failed} failed` : ""} · {t.wallets.length} wallets
        </span>
        {t.status === "running" || t.status === "paused" || t.status === "pending" ? (
          <span className="flex gap-1">
            {pausable && t.status === "running" ? (
              <Button size="xs" busy={busy} onClick={() => act("pause")}>
                Pause
              </Button>
            ) : null}
            {pausable && t.status === "paused" ? (
              <Button size="xs" variant="primary" busy={busy} onClick={() => act("resume")}>
                Resume
              </Button>
            ) : null}
            <Button size="xs" variant="danger" busy={busy} onClick={() => act("stop")}>
              Stop
            </Button>
          </span>
        ) : null}
      </div>
      <Progress value={pctDone} color={meta.color} />
      {t.error ? <div className="text-[11px] text-down">{t.error}</div> : null}
      {t.nextAt > 0 && t.status === "running" ? <div className="text-[10px] text-text-3">next at {time(t.nextAt)}</div> : null}
    </div>
  );
}

export function StepLog({ steps }: { steps: LaunchStep[] }) {
  return (
    <ul className="flex flex-col gap-0.5 max-h-72 overflow-y-auto rounded-lg border border-line bg-bg p-1.5 mono text-[11px]">
      {!steps.length ? <li className="text-text-3 p-1">Waiting for the first step…</li> : null}
      {steps.map((s, i) => (
        <li key={i} className={cx("flex items-center gap-2 px-1.5 py-0.5 rounded", s.ok ? "" : "bg-down-soft/50")}>
          <span className="text-text-3">{time(s.at)}</span>
          <span className={cx("w-14 shrink-0", s.ok ? "text-accent" : "text-down")}>{s.phase}</span>
          <span className={cx("truncate", s.ok ? "text-text-2" : "text-down")}>{s.message}</span>
          {s.signature ? (
            <a href={solscanTx(s.signature)} target="_blank" rel="noreferrer" className="ml-auto text-accent hover:underline shrink-0">
              {short(s.signature)}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
