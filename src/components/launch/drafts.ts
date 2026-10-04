"use client";
/**
 * Launch drafts (Block X sidebar "Draft" tab). Saved through GET/POST/DELETE /api/launch/drafts; while that route is
 * not served yet (ApiFailure "missing") the same list lives in localStorage on this machine — nothing is invented,
 * the drafts are the ones the user typed.
 */
import { useSyncExternalStore } from "react";
import { del, get, isApiFailure, post } from "@/lib/api";
import { normalizeForm, type LaunchForm } from "./model";

export type LaunchDraft = {
  id: string;
  name: string;
  symbol: string;
  /** image data URL or null */
  image: string | null;
  updatedAt: number;
  /** the full form */
  form: LaunchForm;
};
export type LaunchDraftsResponse = { drafts: LaunchDraft[] };

const LOCAL_KEY = "donchain.launch.drafts";
const LEGACY_KEY = "trench.launch.draft";

let serverMissing = false;
/** /api/launch/drafts is shadowed by /api/launch/[id] until the server ships it: a 404/405 there means "not served yet" */
const routeMissing = (e: unknown) => isApiFailure(e) && (e.kind === "missing" || e.status === 404 || e.status === 405);
let cache: LaunchDraft[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readLocal(): LaunchDraft[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const list = raw ? (JSON.parse(raw) as LaunchDraft[]) : [];
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !list.length) {
      const f = normalizeForm(JSON.parse(legacy));
      if (f.name || f.symbol || f.imageDataUrl || f.tasks.length) list.push(toDraft(f));
      localStorage.removeItem(LEGACY_KEY);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    }
    return list.map((d) => ({ ...d, form: normalizeForm(d.form) }));
  } catch {
    return [];
  }
}
function writeLocal(list: LaunchDraft[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}
export function toDraft(f: LaunchForm): LaunchDraft {
  return { id: f.id, name: f.name.trim(), symbol: f.symbol.trim(), image: f.imageDataUrl || null, updatedAt: f.updatedAt || Date.now(), form: f };
}

export async function loadDrafts(): Promise<LaunchDraft[]> {
  if (!serverMissing) {
    try {
      const r = await get<LaunchDraftsResponse>("/api/launch/drafts");
      cache = (r.drafts ?? []).map((d) => ({ ...d, form: normalizeForm({ ...(d.form ?? {}), id: d.id }) }));
      loaded = true;
      emit();
      return cache;
    } catch (e) {
      if (routeMissing(e)) serverMissing = true;
      else throw e;
    }
  }
  cache = readLocal();
  loaded = true;
  emit();
  return cache;
}

export async function saveDraft(f: LaunchForm): Promise<LaunchDraft> {
  const d = { ...toDraft(f), updatedAt: Date.now() };
  d.form = { ...d.form, updatedAt: d.updatedAt };
  if (!serverMissing) {
    try {
      const r = await post<{ draft: LaunchDraft }>("/api/launch/drafts", { draft: d });
      const saved = r?.draft ? { ...r.draft, form: normalizeForm({ ...(r.draft.form ?? d.form), id: r.draft.id }) } : d;
      cache = [saved, ...cache.filter((x) => x.id !== saved.id)];
      emit();
      return saved;
    } catch (e) {
      if (routeMissing(e)) serverMissing = true;
      else throw e;
    }
  }
  cache = [d, ...cache.filter((x) => x.id !== d.id)];
  writeLocal(cache);
  emit();
  return d;
}

export async function deleteDraft(id: string): Promise<void> {
  if (!serverMissing) {
    try {
      await del(`/api/launch/drafts/${encodeURIComponent(id)}`);
      cache = cache.filter((x) => x.id !== id);
      emit();
      return;
    } catch (e) {
      if (routeMissing(e)) serverMissing = true;
      else throw e;
    }
  }
  cache = cache.filter((x) => x.id !== id);
  writeLocal(cache);
  emit();
}

/** true once a request proved the server route is not there (the list then lives in localStorage) */
export function draftsAreLocal() {
  return serverMissing;
}

const EMPTY: LaunchDraft[] = [];
export function useDrafts(): { drafts: LaunchDraft[]; loaded: boolean } {
  const drafts = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!loaded) loadDrafts().catch(() => {});
      return () => {
        listeners.delete(l);
      };
    },
    () => cache,
    () => EMPTY,
  );
  return { drafts, loaded };
}
