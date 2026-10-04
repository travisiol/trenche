"use client";
/**
 * Live view of a server job (`GET /api/jobs/[id]`, polled every second until done).
 * Launch jobs prefer SSE (`/api/launch/[id]/stream`) and fall back to polling when the stream errors.
 */
import { useEffect, useState } from "react";
import { api, useSSE } from "@/lib/api";
import type { JobView, JobStep } from "@/lib/ui-types";
import { short, solscanTx, time } from "@/lib/format";
import { Dot, Progress, Spinner, cx } from "./ui";

export function useJob(jobId: string | null, opts?: { sse?: string | null; intervalMs?: number }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sseDead, setSseDead] = useState(false);
  const sseUrl = opts?.sse && !sseDead ? opts.sse : null;
  useSSE(sseUrl, {
    job: (d) => setJob(d as JobView),
    done: (d) => setJob(d as JobView),
    onError: () => setSseDead(true),
  });
  const polling = !!jobId && !sseUrl && !job?.done;
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = await api<JobView>(`/api/jobs/${jobId}`);
        if (alive) {
          setJob(j);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const t = setInterval(tick, opts?.intervalMs ?? 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId, polling, opts?.intervalMs]);
  return { job, error: err };
}

export function JobProgress({ jobId, sse, compact }: { jobId: string | null; sse?: string | null; compact?: boolean }) {
  const { job, error } = useJob(jobId, { sse });
  if (!jobId) return null;
  if (!job) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-3">
        <Spinner size={14} /> {error ? `Waiting for job ${short(jobId, 6, 4)} — ${error}` : `Starting job ${short(jobId, 6, 4)}…`}
      </div>
    );
  }
  const pctDone = job.total ? Math.round((job.completed / job.total) * 100) : job.done ? 100 : 0;
  return (
    <div className="flex flex-col gap-2.5 fade-in">
      <div className="flex items-center gap-2 text-xs">
        <Dot tone={job.status === "error" ? "down" : job.status === "done" ? "up" : "accent"} pulse={job.status === "running"} />
        <span className="font-medium">{job.label || job.kind}</span>
        <span className="text-text-3 mono ml-auto">
          {job.completed}/{job.total || "?"} · {job.sent} sent{job.failed ? ` · ${job.failed} failed` : ""}
        </span>
      </div>
      <Progress value={pctDone} color={job.status === "error" ? "var(--down)" : job.status === "done" ? "var(--up)" : undefined} />
      {job.error ? <div className="text-xs text-down break-words">{job.error}</div> : null}
      {!compact ? (
        <ul className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
          {job.steps.map((s, i) => (
            <StepRow key={i} step={s} />
          ))}
          {job.status === "running" && job.nextAt > 0 ? <li className="text-[11px] text-text-3 pl-4">next send at {time(job.nextAt)}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function StepRow({ step }: { step: JobStep }) {
  return (
    <li className={cx("flex items-center gap-2 text-[11px] px-2 py-1 rounded-md", step.ok ? "bg-up-soft/40" : "bg-down-soft/40")}>
      <Dot tone={step.ok ? "up" : "down"} />
      <span className="text-text-2 truncate">
        {step.phase ? <span className="text-text-3 mr-1">{step.phase}</span> : null}
        {step.label ?? step.note ?? ""}
      </span>
      {step.address ? <span className="mono text-text-3">{short(step.address)}</span> : null}
      {step.sol ? <span className="mono">{step.sol} SOL</span> : null}
      <span className="ml-auto flex items-center gap-2">
        {step.error ? (
          <span className="text-down truncate max-w-[22ch]" title={step.error}>
            {step.error}
          </span>
        ) : null}
        {step.signature ? (
          <a href={solscanTx(step.signature)} target="_blank" rel="noreferrer" className="mono text-accent hover:underline">
            {short(step.signature, 4, 4)}
          </a>
        ) : null}
        <span className="text-text-3 mono">{time(step.at)}</span>
      </span>
    </li>
  );
}
