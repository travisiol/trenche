"use client";
/** Job progress in Block X style: status line, bar, steps with phase (relay / hop1 / hop2 / recover …) and explorer links. */
import { useState } from "react";
import { ExternalLink, Square } from "lucide-react";
import { useJob } from "@/components/JobProgress";
import { failureMessage, post } from "@/lib/api";
import { toast } from "@/components/ui";
import { useSettings } from "@/lib/store";
import type { JobStep, JobView } from "@/lib/types";
import { short, solscanTx, time } from "@/lib/format";
import { cx } from "./ui";

/** "stopped" = ended by a Stop click or by a server restart; the job error line says which */
const WORD: Record<JobView["status"], string> = { running: "Running", done: "Done", error: "Failed", stopped: "Stopped" };

/** Stop a running job (cooperative: waiting jobs end at their next check; a transaction in flight is never cancelled). */
export function StopJobButton({ jobId, className }: { jobId: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const stop = async () => {
    setBusy(true);
    try {
      await post(`/api/jobs/${jobId}/stop`, {});
      toast("Stop requested — the job ends at its next check", "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={busy} onClick={stop} className={cx("inline-flex h-6 shrink-0 items-center gap-1 rounded border border-decrease/40 px-2 text-[11px] font-medium text-decrease transition-colors hover:bg-decrease/10 disabled:opacity-40", className)} title="Stop this job — nothing already sent is cancelled">
      <Square className="h-3 w-3" /> Stop
    </button>
  );
}

export function useExplorerSuffix() {
  const settings = useSettings();
  return settings.data?.explorerSuffix ?? "";
}

export function TxLink({ sig, className }: { sig: string; className?: string }) {
  const suffix = useExplorerSuffix();
  return (
    <a href={solscanTx(sig) + suffix} target="_blank" rel="noreferrer" className={cx("inline-flex items-center gap-0.5 font-mono text-[11px] text-accent hover:underline", className)} onClick={(e) => e.stopPropagation()}>
      {short(sig, 4, 4)}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function BxJob({ jobId, compact }: { jobId: string | null; compact?: boolean }) {
  const { job, error } = useJob(jobId);
  if (!jobId) return null;
  if (!job) return <p className="text-xs text-text-300">{error ? `Waiting for job ${short(jobId, 6, 4)} — ${error}` : `Starting job ${short(jobId, 6, 4)}…`}</p>;
  const pct = job.total ? Math.round((job.completed / job.total) * 100) : job.done ? 100 : 0;
  const tone = job.status === "error" ? "bg-decrease" : job.status === "done" ? "bg-green-100" : job.status === "stopped" ? "bg-yellow-100" : "bg-accent";
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={cx("h-2 w-2 shrink-0 rounded-full", tone, job.status === "running" ? "animate-pulse" : "")} />
        <span className="font-medium text-text-100">{job.label || job.kind}</span>
        <span className="min-w-0 truncate text-text-300">· {WORD[job.status]}</span>
        <span className="ml-auto shrink-0 font-mono tabular-nums text-text-300">
          {job.completed}/{job.total || "?"} · {job.sent} sent{job.failed ? ` · ${job.failed} failed` : ""}
        </span>
        {job.status === "running" ? <StopJobButton jobId={job.id} /> : null}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line-50">
        <div className={cx("h-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      {job.error ? <p className="text-decrease">{job.error}</p> : null}
      {!compact ? (
        <ul className="flex max-h-56 flex-col overflow-y-auto">
          {job.steps.map((s, i) => (
            <StepLine key={i} s={s} />
          ))}
          {job.status === "running" && job.nextAt > 0 ? <li className="py-1 pl-4 text-text-300">Next send at {time(job.nextAt)}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

const PHASE: Record<string, string> = { relay: "Relay", hop1: "Hop 1/2", hop2: "Hop 2/2", recover: "Recover", wait: "Delay", pay: "Payment" };

export function StepLine({ s }: { s: JobStep }) {
  return (
    <li className="flex min-h-7 items-center gap-2 border-b border-line-50 py-1 last:border-0">
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", s.ok ? "bg-green-100" : "bg-decrease")} />
      {s.phase ? <span className={cx("shrink-0 rounded px-1 text-[10px] font-medium uppercase", s.phase === "recover" ? "bg-yellow-100/15 text-yellow-100" : s.phase === "wait" ? "bg-line-50 text-text-300" : "bg-accent-muted text-accent")}>{PHASE[s.phase] ?? s.phase}</span> : null}
      <span className="min-w-0 flex-1 truncate text-text-200">
        {s.label ?? s.note ?? ""}
        {s.address ? <span className="ml-1 font-mono text-text-300">{short(s.address)}</span> : null}
      </span>
      {s.error ? (
        <span className="max-w-[28ch] truncate text-decrease" title={s.error}>
          {s.error}
        </span>
      ) : null}
      {s.sol ? <span className="font-mono text-text-200">{s.sol} SOL</span> : null}
      {s.signature ? <TxLink sig={s.signature} /> : null}
      <span className="font-mono text-text-300">{time(s.at)}</span>
    </li>
  );
}
