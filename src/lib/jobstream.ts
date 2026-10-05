"use client";
/* One live view per job id, shared by every component that shows it (job line, pending trades, toasts):
 * an EventSource on /api/jobs/[id]/stream (steps pushed by the server the moment they are written), closed as soon
 * as the job is done; when the stream errors before the end, GET /api/jobs/[id] is polled every second instead.
 * Sharing matters: a browser keeps ~6 HTTP/1.1 connections per origin and every open EventSource holds one. */
import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { JobView } from "./types";
import { soundOnJob } from "./sounds";

type Entry = { job: JobView | null; error: string | null; listeners: Set<() => void>; close: () => void; done: boolean };
const entries = new Map<string, Entry>();

function start(id: string): Entry {
  const e: Entry = { job: null, error: null, listeners: new Set(), close: () => {}, done: false };
  entries.set(id, e);
  const emit = () => e.listeners.forEach((l) => l());
  const set = (j: JobView) => {
    soundOnJob(j);
    e.job = j;
    e.error = null;
    if (j.done) finish();
    emit();
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  let es: EventSource | null = null;
  const finish = () => {
    e.done = true;
    es?.close();
    es = null;
    if (timer) clearInterval(timer);
    timer = null;
  };
  const poll = () => {
    if (timer || e.done) return;
    const tick = () =>
      api<JobView>(`/api/jobs/${id}`)
        .then(set)
        .catch((err: unknown) => {
          e.error = err instanceof Error ? err.message : String(err);
          emit();
        });
    void tick();
    timer = setInterval(tick, 1000);
  };
  try {
    es = new EventSource(`/api/jobs/${id}/stream`);
    const onJob = (ev: MessageEvent) => {
      try {
        set(JSON.parse(ev.data) as JobView);
      } catch {
        /* malformed event */
      }
    };
    es.addEventListener("job", onJob);
    es.addEventListener("done", onJob);
    es.onerror = () => {
      es?.close();
      es = null;
      if (!e.done) poll();
    };
  } catch {
    poll();
  }
  e.close = finish;
  return e;
}

/** subscribe to a job's live view; the stream opens on the first subscriber and closes when done or unused */
export function subscribeJob(id: string, fn: (job: JobView | null, error: string | null) => void): () => void {
  const e = entries.get(id) ?? start(id);
  const l = () => fn(e.job, e.error);
  e.listeners.add(l);
  if (e.job) queueMicrotask(l);
  return () => {
    e.listeners.delete(l);
    if (!e.listeners.size) {
      e.close();
      // keep the finished view cached a while (re-mounts re-read it); a running one restarts on the next subscribe
      if (!e.done) entries.delete(id);
      else setTimeout(() => !e.listeners.size && entries.delete(id), 60_000);
    }
  };
}

const NONE = { job: null as JobView | null, error: null as string | null };

/** React hook over subscribeJob (null id = nothing) */
export function useJobStream(id: string | null): { job: JobView | null; error: string | null } {
  return useSyncExternalStore(
    (cb) => (id ? subscribeJob(id, cb) : () => {}),
    () => {
      if (!id) return NONE;
      const e = entries.get(id);
      return e ? snapshot(e) : NONE;
    },
    () => NONE,
  );
}

// stable snapshot objects per (job, error) pair so useSyncExternalStore does not loop
const snaps = new WeakMap<Entry, { job: JobView | null; error: string | null }>();
function snapshot(e: Entry): { job: JobView | null; error: string | null } {
  const s = snaps.get(e);
  if (s && s.job === e.job && s.error === e.error) return s;
  const n = { job: e.job, error: e.error };
  snaps.set(e, n);
  return n;
}
