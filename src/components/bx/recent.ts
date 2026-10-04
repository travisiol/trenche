"use client";
/** "Recently viewed tokens" strip under the top bar (Block X holdings strip) and the search dialog History.
 *  Server list GET/POST/DELETE /api/recent (contract RecentResponse); a local copy on this machine keeps the strip
 *  filled while the route is not served. */
import { useSyncExternalStore } from "react";
import type { RecentResponse, RecentToken } from "@/lib/types";
import { del, get, isApiFailure, post } from "@/lib/api";

export type { RecentToken };
const KEY = "donchain.recent";
const listeners = new Set<() => void>();
let cache: RecentToken[] | null = null;
let serverMissing = false;
let synced = false;
const missing = (e: unknown) => isApiFailure(e) && (e.kind === "missing" || e.status === 404 || e.status === 405);

function read(): RecentToken[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    cache = [];
  }
  return cache!;
}
function write(next: RecentToken[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}
/** Pull the server list (once per page load, and after every push). */
export async function syncRecent() {
  if (serverMissing) return;
  try {
    const r = await get<RecentResponse>("/api/recent");
    synced = true;
    write(r.recent ?? []);
  } catch (e) {
    if (missing(e)) serverMissing = true;
  }
}
export function pushRecent(t: Omit<RecentToken, "at">) {
  write([{ ...t, at: Date.now() }, ...read().filter((x) => x.mint !== t.mint)].slice(0, 20));
  if (!serverMissing) post("/api/recent", { mint: t.mint }).then(() => syncRecent()).catch((e) => missing(e) && (serverMissing = true));
}
export function clearRecent() {
  write([]);
  if (!serverMissing) del("/api/recent").catch((e) => missing(e) && (serverMissing = true));
}
const EMPTY: RecentToken[] = [];
export function useRecent(): RecentToken[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!synced) syncRecent();
      return () => {
        listeners.delete(l);
      };
    },
    read,
    () => EMPTY,
  );
}

