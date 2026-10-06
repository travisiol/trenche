"use client";
/**
 * Typed fetch client + SSE hook for the TRENCH API (contract in BRIEF.md / ui-types.ts).
 * Every failure becomes an ApiFailure with a `kind` the UI can turn into a precise message:
 *  - "network"  → the Next server is not reachable at all
 *  - "missing"  → the route does not exist yet (404 without a JSON `error`)
 *  - "locked"   → the keystore is locked (403/423)
 *  - "error"    → the server answered `{ error }`
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { JobCreated, JobView } from "./types";

export type ApiFailureKind = "network" | "missing" | "locked" | "error";

export class ApiFailure extends Error {
  kind: ApiFailureKind;
  status: number;
  path: string;
  constructor(kind: ApiFailureKind, message: string, status: number, path: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.path = path;
  }
}

export function isApiFailure(e: unknown): e is ApiFailure {
  return e instanceof ApiFailure;
}

export function failureMessage(e: unknown): string {
  if (isApiFailure(e)) {
    if (e.kind === "network") return "Server not reachable";
    if (e.kind === "missing") return `Route missing: ${e.path}`;
    if (e.kind === "locked") return "Vault is locked";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  const { json, ...rest } = init ?? {};
  try {
    res = await fetch(path, {
      ...rest,
      method: rest.method ?? (json !== undefined ? "POST" : "GET"),
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiFailure("network", e instanceof Error ? e.message : "fetch failed", 0, path);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.ok && data === null && /text\/html/.test(res.headers.get("content-type") ?? "")) {
    throw new ApiFailure("missing", `Route missing: ${path}`, res.status, path);
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    if (res.status === 404 && !msg) throw new ApiFailure("missing", `Route missing: ${path}`, 404, path);
    if (res.status === 423 || (res.status === 403 && /lock/i.test(msg ?? ""))) throw new ApiFailure("locked", msg ?? "Vault is locked", res.status, path);
    throw new ApiFailure("error", msg ?? `${res.status} ${res.statusText}`, res.status, path);
  }
  return data as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, json: unknown, method: "POST" | "PATCH" | "PUT" = "POST") => api<T>(path, { json, method });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });

/* ------------------------------------------------------------------ SSE */

export type SseHandlers = Record<string, (data: unknown) => void> & {
  onOpen?: () => void;
  onError?: () => void;
};

/**
 * Subscribes to a Server-Sent-Events route. Handlers are kept in a ref so the EventSource
 * is only rebuilt when `url` changes. Pass `null` to stay disconnected.
 */
export function useSSE(url: string | null, handlers: SseHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    const names = Object.keys(ref.current).filter((n) => n !== "onOpen" && n !== "onError");
    const listeners = names.map((name) => {
      const fn = (ev: MessageEvent) => {
        let data: unknown = ev.data;
        try {
          data = JSON.parse(ev.data);
        } catch {
          /* raw string */
        }
        ref.current[name]?.(data);
      };
      es.addEventListener(name, fn);
      return [name, fn] as const;
    });
    es.onopen = () => ref.current.onOpen?.();
    es.onerror = () => ref.current.onError?.();
    return () => {
      for (const [name, fn] of listeners) es.removeEventListener(name, fn);
      es.close();
    };
  }, [url]);
}

/* -------------------------------------------------------- resource store */

export type ResourceState<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
  at: number;
};

type Listener = () => void;

/**
 * A polled external store (useSyncExternalStore-friendly, no setState in effects).
 * `useResource` subscribes; polling runs only while someone is subscribed.
 */
/* Polling pauses while the tab is hidden (visibilitychange) and every paused resource refreshes once it is
 * visible again: a background tab must not keep the RPC queue busy. */
const pausedResources = new Set<() => void>();
let visibilityHooked = false;
const tabHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
function hookVisibility() {
  if (visibilityHooked || typeof document === "undefined") return;
  visibilityHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (tabHidden()) return;
    const wake = [...pausedResources];
    pausedResources.clear();
    wake.forEach((fn) => fn());
  });
}

export function createResource<T>(path: string, intervalMs = 0) {
  let state: ResourceState<T> = { data: null, error: null, loading: true, at: 0 };
  const listeners = new Set<Listener>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let currentPath = path;

  const emit = () => listeners.forEach((l) => l());
  const set = (patch: Partial<ResourceState<T>>) => {
    state = { ...state, ...patch };
    emit();
  };
  const schedule = () => {
    if (!(intervalMs > 0) || !listeners.size) return;
    if (timer) clearTimeout(timer);
    if (tabHidden()) {
      // resume with an immediate refresh when the tab comes back
      pausedResources.add(refresh);
      return;
    }
    timer = setTimeout(refresh, intervalMs);
  };
  const refresh = () => {
    if (inflight) return inflight;
    hookVisibility();
    inflight = api<T>(currentPath)
      .then((data) => set({ data, error: null, loading: false, at: Date.now() }))
      .catch((error) => set({ error, loading: false, at: Date.now() }))
      .finally(() => {
        inflight = null;
        schedule();
      });
    return inflight;
  };
  const subscribe = (l: Listener) => {
    listeners.add(l);
    if (listeners.size === 1) refresh();
    return () => {
      listeners.delete(l);
      if (!listeners.size) {
        pausedResources.delete(refresh);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    };
  };
  const getSnapshot = () => state;
  const mutate = (data: T) => set({ data, error: null, loading: false, at: Date.now() });
  const setPath = (next: string) => {
    if (next === currentPath) return;
    currentPath = next;
    state = { data: null, error: null, loading: true, at: 0 };
    emit();
    refresh();
  };
  return { subscribe, getSnapshot, refresh, mutate, setPath };
}

export type Resource<T> = ReturnType<typeof createResource<T>>;

const SERVER_SNAPSHOT: ResourceState<never> = { data: null, error: null, loading: true, at: 0 };

export function useResource<T>(res: Resource<T>): ResourceState<T> & { refresh: () => void } {
  const state = useSyncExternalStore(res.subscribe, res.getSnapshot, () => SERVER_SNAPSHOT as ResourceState<T>);
  return { ...state, refresh: res.refresh };
}

/** Per-component polled fetch keyed by path (cached across mounts of the same path). */
const cache = new Map<string, Resource<unknown>>();
/** Shared never-fetching resource for `useGet(null)` (keeps hook order stable, no ref in render). */
const IDLE_SNAPSHOT: ResourceState<never> = { data: null, error: null, loading: false, at: 0 };
const IDLE: Resource<unknown> = {
  subscribe: () => () => {},
  getSnapshot: () => IDLE_SNAPSHOT as ResourceState<unknown>,
  refresh: () => Promise.resolve(),
  mutate: () => {},
  setPath: () => {},
};
/** the resource useGet(path, intervalMs) reads — for non-React consumers (trade stream) sharing the same poll */
export function sharedResource<T>(path: string, intervalMs = 0): Resource<T> {
  let res = cache.get(`${path}|${intervalMs}`) as Resource<T> | undefined;
  if (!res) {
    res = createResource<T>(path, intervalMs);
    cache.set(`${path}|${intervalMs}`, res as Resource<unknown>);
  }
  return res;
}
export function useGet<T>(path: string | null, intervalMs = 0): ResourceState<T> & { refresh: () => void } {
  const res = path ? sharedResource<T>(path, intervalMs) : undefined;
  const active = (res ?? IDLE) as Resource<T>;
  const state = useSyncExternalStore(active.subscribe, active.getSnapshot, () => SERVER_SNAPSHOT as ResourceState<T>);
  return { ...state, refresh: active.refresh };
}

/** Poll GET /api/jobs/[id] until the job is done (or `timeoutMs` elapses) and return its final view. */
export async function waitJob(jobId: string, timeoutMs = 120_000, everyMs = 1000): Promise<JobView> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const job = await get<JobView>(`/api/jobs/${jobId}`);
    if (job.done || Date.now() > until) return job;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Result of a creator-fees claim, read back from its job (extra.totalSol / extra.signatures). */
export type ClaimResult = { error: string | null; totalSol: string; confirmed: number; signatures: string[] };
export async function claimFees(body: { mint?: string; wallet?: string; wallets?: string[] }): Promise<ClaimResult> {
  const { jobId } = await post<JobCreated>("/api/dev/fees/claim", body);
  const job = await waitJob(jobId);
  const signatures = Array.isArray(job.extra?.signatures) ? (job.extra!.signatures as string[]) : job.steps.map((s) => s.signature).filter((s): s is string => !!s);
  const totalSol = typeof job.extra?.totalSol === "string" ? job.extra.totalSol : typeof job.extra?.totalSol === "number" ? String(job.extra.totalSol) : "0";
  return { error: job.error, totalSol, confirmed: job.steps.filter((s) => s.ok && s.signature).length, signatures };
}
