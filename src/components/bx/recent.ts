"use client";
/** "Recently viewed tokens" strip under the top bar (Block X holdings strip). Persisted on this machine. */
import { useSyncExternalStore } from "react";

export type RecentToken = { mint: string; symbol: string | null; name: string | null; image: string | null; at: number };
const KEY = "donchain.recent";
const listeners = new Set<() => void>();
let cache: RecentToken[] | null = null;

function read(): RecentToken[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    cache = [];
  }
  return cache!;
}
export function pushRecent(t: Omit<RecentToken, "at">) {
  const next = [{ ...t, at: Date.now() }, ...read().filter((x) => x.mint !== t.mint)].slice(0, 12);
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}
export function clearRecent() {
  cache = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
const EMPTY: RecentToken[] = [];
export function useRecent(): RecentToken[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    read,
    () => EMPTY,
  );
}
