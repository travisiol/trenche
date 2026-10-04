"use client";
/** Launch workspace layout: column widths, Token-info height and the maximized panel, persisted in localStorage
 *  (donchain.workspace.layout). One module-level store read through useSyncExternalStore (no setState in effects). */
import { useSyncExternalStore } from "react";

export type PanelId = "chart" | "tasks" | "info" | "activity";
export type WorkspaceLayout = { left: number; right: number; infoH: number; max: PanelId | null };

export const LAYOUT_DEFAULT: WorkspaceLayout = { left: 380, right: 400, infoH: 316, max: null };
export const LAYOUT_LIMITS = { left: [260, 900], right: [300, 900], infoH: [200, 720] } as const;
const KEY = "donchain.workspace.layout";

let state: WorkspaceLayout | null = null;
const listeners = new Set<() => void>();

function clamp(n: number, [lo, hi]: readonly [number, number]) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function sanitize(raw: unknown): WorkspaceLayout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof WorkspaceLayout, unknown>>;
  const num = (v: unknown, d: number, lim: readonly [number, number]) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lim) : d);
  const max = o.max === "chart" || o.max === "tasks" || o.max === "info" || o.max === "activity" ? o.max : null;
  return { left: num(o.left, LAYOUT_DEFAULT.left, LAYOUT_LIMITS.left), right: num(o.right, LAYOUT_DEFAULT.right, LAYOUT_LIMITS.right), infoH: num(o.infoH, LAYOUT_DEFAULT.infoH, LAYOUT_LIMITS.infoH), max };
}

function read(): WorkspaceLayout {
  if (state) return state;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    state = sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    state = { ...LAYOUT_DEFAULT };
  }
  return state;
}

function write(next: WorkspaceLayout) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export function setWorkspaceLayout(patch: Partial<WorkspaceLayout>) {
  write(sanitize({ ...read(), ...patch }));
}

export function resetWorkspaceLayout() {
  write({ ...LAYOUT_DEFAULT });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useWorkspaceLayout(): WorkspaceLayout {
  return useSyncExternalStore(subscribe, read, () => LAYOUT_DEFAULT);
}
