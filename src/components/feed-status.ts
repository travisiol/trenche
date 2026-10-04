"use client";
/**
 * Feed status shared between the navbar dot and the Trenches page.
 * The Trenches page owns the EventSource and publishes `status` events here;
 * when no page is connected the navbar shows "Feed off" (true, not a guess).
 */
import { useSyncExternalStore } from "react";
import type { FeedStatus } from "@/lib/ui-types";

const OFF: FeedStatus = { connected: false, since: null, lastMessageAt: null, tracked: 0, tradesLive: false, reconnects: 0, error: null };
let state: FeedStatus = OFF;
const listeners = new Set<() => void>();

export function publishFeedStatus(s: FeedStatus | null) {
  state = s ?? OFF;
  listeners.forEach((l) => l());
}
export function useFeedStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
    () => OFF,
  );
}
