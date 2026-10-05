/* In-memory job registry (donchain's jobNew/jobRun/jobPush/jobWait, typed). */
import type { JobStep, JobView } from "@/lib/types";
import { saveJobsSoon, store, type Job } from "./store";

/* change listeners per job id: the SSE route (/api/jobs/[id]/stream) pushes a step the moment it is written
   instead of polling the job every 500 ms. Lives on globalThis (survives HMR). */
type Listener = () => void;
declare global {
  var __trenchJobListeners: Map<string, Set<Listener>> | undefined;
}
function listeners(): Map<string, Set<Listener>> {
  if (!globalThis.__trenchJobListeners) globalThis.__trenchJobListeners = new Map();
  return globalThis.__trenchJobListeners;
}
function changed(job: Job): void {
  const set = listeners().get(job.id);
  if (set) for (const l of [...set]) l();
}
/** call `fn` on every change of job `id` (steps, counters, status); returns the unsubscribe */
export function jobOnChange(id: string, fn: Listener): () => void {
  const m = listeners();
  let set = m.get(id);
  if (!set) {
    set = new Set();
    m.set(id, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) m.delete(id);
  };
}

export function jobNew(kind: string, total: number, label = ""): Job {
  const st = store();
  const id = "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job: Job = {
    id,
    kind,
    label,
    total: Math.max(0, Number(total) || 0),
    completed: 0,
    sent: 0,
    failed: 0,
    steps: [],
    status: "running",
    cluster: st.settings.cluster,
    nextAt: 0,
    error: null,
    extra: null,
    startedAt: Date.now(),
    endedAt: null,
    stop: false,
  };
  st.jobs.set(id, job);
  if (st.jobs.size > 60) {
    const oldest = [...st.jobs.values()].filter((j) => j.status !== "running").sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) st.jobs.delete(oldest.id);
  }
  saveJobsSoon(st);
  return job;
}

export function jobWait(job: Job | null, ms: number): void {
  if (!job) return;
  job.nextAt = Date.now() + Math.max(0, ms | 0);
  changed(job);
}

export function jobPush(job: Job | null, ok: boolean, row: Omit<JobStep, "ok" | "at"> = {}): void {
  if (!job) return;
  job.completed++;
  job.nextAt = 0;
  if (ok) job.sent++;
  else job.failed++;
  job.steps.push({ ok, at: Date.now(), ...row });
  if (job.steps.length > 400) job.steps.splice(0, job.steps.length - 400);
  saveJobsSoon();
  changed(job);
}

export function jobNote(job: Job | null, note: string, extra: Partial<JobStep> = {}): void {
  if (!job) return;
  job.steps.push({ ok: true, at: Date.now(), note, ...extra });
  saveJobsSoon();
  changed(job);
}

export function jobRun(job: Job, fn: (job: Job) => Promise<void>): void {
  Promise.resolve()
    .then(() => fn(job))
    .then(() => {
      if (job.status === "running") job.status = "done";
      job.endedAt = Date.now();
      saveJobsSoon();
      changed(job);
    })
    .catch((err: unknown) => {
      // a cooperative stop (POST /api/jobs/[id]/stop) ends the loop by throwing: that is "stopped", not a failure
      job.status = job.stop ? "stopped" : "error";
      job.error = (err instanceof Error ? err.message : String(err)).slice(0, 400);
      job.endedAt = Date.now();
      saveJobsSoon();
      changed(job);
    });
}

/** a job's extra/label changed outside jobPush/jobNote (stream listeners re-send it) */
export function jobTouched(job: Job | null): void {
  if (job) changed(job);
}

export function jobView(job: Job): JobView {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    cluster: job.cluster,
    done: job.status !== "running",
    total: job.total,
    completed: job.completed,
    sent: job.sent,
    failed: job.failed,
    nextAt: job.nextAt,
    steps: job.steps.slice(-120),
    error: job.error,
    extra: job.extra,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  };
}

export function jobGet(id: string): Job | undefined {
  return store().jobs.get(id);
}
