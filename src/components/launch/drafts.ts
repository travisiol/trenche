"use client";
/**
 * Launch drafts (Block X sidebar "Draft" tab) — GET/POST /api/launch/drafts, DELETE /api/launch/drafts/[id]
 * (contract: LaunchDraft in src/lib/types.ts). While that route is not served yet (404/405 from the
 * /api/launch/[id] catch-all) the same list lives in localStorage on this machine — the drafts are the user's own.
 */
import { useSyncExternalStore } from "react";
import type { LaunchDraft, LaunchDraftResponse, LaunchDraftsResponse } from "@/lib/types";
import { del, get, isApiFailure, post } from "@/lib/api";
import { normalizeForm, type LaunchForm } from "./model";

export type DraftRow = LaunchDraft & { parsed: LaunchForm };

const LOCAL_KEY = "donchain.launch.drafts";
const LEGACY_KEY = "trench.launch.draft";

let serverMissing = false;
/** /api/launch/drafts is shadowed by /api/launch/[id] until the server ships it: a 404/405 there means "not served yet" */
const routeMissing = (e: unknown) => isApiFailure(e) && (e.kind === "missing" || e.status === 404 || e.status === 405);
let cache: DraftRow[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function toRow(d: LaunchDraft): DraftRow {
  const parsed = normalizeForm({ ...(d.form as Partial<LaunchForm>), id: d.id, updatedAt: d.updatedAt });
  return { ...d, name: d.name ?? (parsed.name.trim() || null), symbol: d.symbol ?? (parsed.symbol.trim() || null), image: d.image ?? (parsed.imageDataUrl || null), parsed };
}
function fromForm(f: LaunchForm, prev?: LaunchDraft): LaunchDraft {
  const now = Date.now();
  return { id: f.id, name: f.name.trim() || null, symbol: f.symbol.trim() || null, image: f.imageDataUrl || null, form: { ...f, updatedAt: now }, createdAt: prev?.createdAt ?? now, updatedAt: now, launchedMint: prev?.launchedMint ?? null };
}

function readLocal(): DraftRow[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const list = raw ? (JSON.parse(raw) as LaunchDraft[]) : [];
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !list.length) {
      const f = normalizeForm(JSON.parse(legacy));
      if (f.name || f.symbol || f.imageDataUrl || f.tasks.length) list.push(fromForm(f));
      localStorage.removeItem(LEGACY_KEY);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    }
    return list.map(toRow);
  } catch {
    return [];
  }
}
function writeLocal(list: DraftRow[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.map(({ parsed: _p, ...d }) => (void _p, d))));
  } catch {
    /* quota / private mode */
  }
}

export async function loadDrafts(): Promise<DraftRow[]> {
  if (!serverMissing) {
    try {
      const r = await get<LaunchDraftsResponse>("/api/launch/drafts");
      cache = (r.drafts ?? []).map(toRow);
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

export async function saveDraft(f: LaunchForm): Promise<DraftRow> {
  const prev = cache.find((x) => x.id === f.id);
  const d = fromForm(f, prev);
  if (!serverMissing) {
    try {
      const r = await post<LaunchDraftResponse>("/api/launch/drafts", { id: d.id, form: d.form });
      const saved = toRow(r?.draft ?? d);
      cache = [saved, ...cache.filter((x) => x.id !== saved.id && x.id !== d.id)];
      emit();
      return saved;
    } catch (e) {
      if (routeMissing(e)) serverMissing = true;
      else throw e;
    }
  }
  const row = toRow(d);
  cache = [row, ...cache.filter((x) => x.id !== d.id)];
  writeLocal(cache);
  emit();
  return row;
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

const EMPTY: DraftRow[] = [];
export function useDrafts(): { drafts: DraftRow[]; loaded: boolean } {
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
  return { drafts: drafts.filter((d) => !d.launchedMint), loaded };
}
