"use client";
/**
 * Live launch panel: subscribes to GET /api/launch/[id]/stream (events: state, step, task_status, done, error),
 * falls back to polling GET /api/launch/[id] every 2 s when the stream errors.
 * Shows mint, create signature, per-task status with pause/resume/stop, step log.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LaunchState, LaunchStep, LaunchTaskState, TaskActionResponse } from "@/lib/types";
import { PAUSABLE_TASKS } from "@/lib/types";
import { api, failureMessage, post, useSSE } from "@/lib/api";
import { pumpfunUrl, short, solscanTx, time } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { Icon } from "../icons";
import { Button, Capsule, Copy, Dot, Progress, Section, Spinner, StepItem, StepList, cx, toast } from "../ui";
import { TASK_META } from "./model";
import { TASK_STATUS_WORD } from "../dev/TaskRowCompact";

export function useLaunchState(id: string | null) {
  // every value is tagged with the launch it belongs to: switching launch never shows (nor stops polling on) the
  // previous launch's state — a "failed" one used to stay on screen over a launch that went live
  const [tagged, setTagged] = useState<{ id: string; state: LaunchState } | null>(null);
  const [deadFor, setDeadFor] = useState<string | null>(null);
  const [errFor, setErrFor] = useState<{ id: string; error: string } | null>(null);
  const state = id && tagged?.id === id ? tagged.state : null;
  const sseDead = !!id && deadFor === id;
  const err = id && errFor?.id === id ? errFor.error : null;
  const url = id && !sseDead ? `/api/launch/${id}/stream` : null;
  const put = (fn: (s: LaunchState | null) => LaunchState | null) =>
    setTagged((t) => {
      if (!id) return t;
      const next = fn(t?.id === id ? t.state : null);
      return next ? { id, state: next } : t;
    });
  useSSE(url, {
    state: (d) => put(() => d as LaunchState),
    done: (d) => put(() => d as LaunchState),
    step: (d) => put((s) => (s ? { ...s, steps: [...s.steps, d as LaunchStep] } : s)),
    task_status: (d) => put((s) => (s ? { ...s, tasks: s.tasks.map((t) => (t.id === (d as LaunchTaskState).id ? (d as LaunchTaskState) : t)) } : s)),
    error: (d) => id && setErrFor({ id, error: (d as { error?: string })?.error ?? "stream error" }),
    onError: () => setDeadFor(id),
  });
  const finished = state?.status === "done" || state?.status === "failed";
  const polling = !!id && !url && !finished;
  useEffect(() => {
    if (!polling || !id) return;
    let alive = true;
    const tick = () =>
      api<LaunchState>(`/api/launch/${id}`)
        .then((s) => {
          if (!alive) return;
          setTagged({ id, state: s });
          setErrFor(null);
        })
        .catch((e) => alive && setErrFor({ id, error: failureMessage(e) }));
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, polling]);
  return { state, error: err, viaPolling: sseDead };
}

const STATUS: Record<LaunchState["status"], { tone: "accent" | "up" | "down"; word: string }> = {
  preparing: { tone: "accent", word: "Preparing" },
  sending: { tone: "accent", word: "Sending" },
  live: { tone: "up", word: "Live" },
  failed: { tone: "down", word: "Failed" },
  done: { tone: "up", word: "Done" },
};

export function LaunchLive({ id, onReset }: { id: string; onReset?: () => void }) {
  const { state, error, viaPolling } = useLaunchState(id);
  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-3 p-4">
        <Spinner size={14} /> {error ?? "Connecting to the launch stream…"}
      </div>
    );
  }
  const running = state.status === "preparing" || state.status === "sending";
  const st = STATUS[state.status];
  return (
    <div className="flex flex-col gap-6 fade-in">
      <div className="flex flex-wrap items-center gap-4">
        <Icon3D name="launch" size={44} glow />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold">{state.name}</span>
            <span className="text-text-2 mono">{state.symbol}</span>
            <Capsule tone={st.tone}>
              <Dot tone={st.tone} pulse={running || state.status === "live"} /> {st.word}
            </Capsule>
            {viaPolling ? <span className="hint">(polling)</span> : null}
          </div>
          <div className="flex items-center gap-4 text-[13px] mt-1 flex-wrap">
            <Copy text={state.mint}>{short(state.mint, 6, 6)}</Copy>
            <a href={pumpfunUrl(state.mint)} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              pump.fun <Icon name="external" size={12} />
            </a>
            <Link href={`/trade/${state.mint}`} className="text-accent hover:underline">
              Trade page
            </Link>
            <Link href={`/dashboard?mint=${state.mint}`} className="text-accent hover:underline">
              Dev room
            </Link>
            {state.createSignature ? (
              <a href={solscanTx(state.createSignature)} target="_blank" rel="noreferrer" className="mono text-text-2 hover:text-accent">
                create {short(state.createSignature)} {state.createConfirmed ? "confirmed" : state.createConfirmed === false ? "failed" : "pending…"}
              </a>
            ) : null}
          </div>
        </div>
        {onReset && !running ? (
          <Button variant="outline" onClick={onReset} icon="rocket">
            New launch
          </Button>
        ) : null}
      </div>
      {state.error ? <div className="text-sm text-down bg-down-soft border border-down/20 rounded-lg px-3 py-2.5">{state.error}</div> : null}

      {state.tasks.length ? (
        <Section title="Tasks" description="Each task reports its own progress. Buy and Volume can be paused.">
          <div className="flex flex-col gap-2">
            {state.tasks.map((t) => (
              <TaskRow key={t.id} launchId={state.id} t={t} />
            ))}
          </div>
        </Section>
      ) : null}

      {state.sellOnExternal || state.autoDump?.armed ? (
        <Section title="Automatic sells" description="Armed on the server; they fire without you.">
          <div className="flex flex-col gap-2 text-sm">
            {state.sellOnExternal ? (
              <div className="flex items-center gap-2 text-text-2">
                <Icon3D name="sniper" size={18} />
                Sell on external volume: {state.sellOnExternal.externalVolumeSol.toFixed(3)} of {state.sellOnExternal.threshold} SOL seen{state.sellOnExternal.fired ? <span className="text-up"> — fired</span> : ""}
              </div>
            ) : null}
            {state.autoDump?.armed ? (
              <div className="flex items-center gap-2 text-auto">
                <Icon3D name="autodump" size={18} />
                Auto-dump armed{state.autoDump.config?.mcUsd ? ` at $${state.autoDump.config.mcUsd}` : ""}
                {state.autoDump.config?.afterSec ? ` after ${state.autoDump.config.afterSec} s` : ""}
                {state.autoDump.firedAt ? " — fired" : ""}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title="Steps" description="Every action in order, with its signature on Solscan.">
        <StepLog steps={state.steps} />
      </Section>
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
    <div className="card p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <Icon3D name={meta.icon} size={22} />
        <span className="font-medium">{meta.label}</span>
        <Dot tone={tone} pulse={t.status === "running"} />
        <span className="text-text-2">{TASK_STATUS_WORD[t.status]}</span>
        <span className="mono text-[13px] text-text-3 ml-auto">
          {t.done}/{t.total ?? "∞"} done · {t.sent} sent{t.failed ? ` · ${t.failed} failed` : ""} · {t.wallets.length} wallet{t.wallets.length !== 1 ? "s" : ""}
        </span>
        {t.status === "running" || t.status === "paused" || t.status === "pending" ? (
          <span className="flex gap-1.5">
            {pausable && t.status === "running" ? (
              <Button size="xs" busy={busy} onClick={() => act("pause")} icon="pause">
                Pause
              </Button>
            ) : null}
            {pausable && t.status === "paused" ? (
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
      <Progress value={pctDone} color={meta.color} />
      {t.error ? <div className="text-sm text-down">{t.error}</div> : null}
      {t.nextAt > 0 && t.status === "running" ? <div className="hint">Next trade at {time(t.nextAt)}</div> : null}
    </div>
  );
}

export function StepLog({ steps }: { steps: LaunchStep[] }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 max-h-80 overflow-y-auto">
      {!steps.length ? <p className="hint py-3">Waiting for the first step…</p> : null}
      <StepList>
        {steps.map((s, i) => (
          <StepItem
            key={i}
            ok={s.ok}
            right={
              <>
                {s.signature ? (
                  <a href={solscanTx(s.signature)} target="_blank" rel="noreferrer" className="mono text-accent hover:underline">
                    {short(s.signature)} ↗
                  </a>
                ) : null}
                <span className="mono text-text-3">{time(s.at)}</span>
              </>
            }
          >
            <span className={cx("mono text-[13px] mr-2", s.ok ? "text-accent" : "text-down")}>{s.phase}</span>
            <span className={s.ok ? "" : "text-down"}>{s.message}</span>
          </StepItem>
        ))}
      </StepList>
    </div>
  );
}
