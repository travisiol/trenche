"use client";
/* "New trades" feed for one mint, behind a swappable source, so the chart never knows where trades come from.
 * Default source = the shared 2 s poll of GET /api/token/[mint]/trades?limit=100 — the very resource the Activity
 * panel and the trade page read (same path + interval → one request for all of them).
 * A push feed (SSE / WebSocket) plugs in with setTradeSource(): emit each new trade once, `snapshot: false`. */
import { useEffect, useRef } from "react";
import { sharedResource } from "./api";
import type { TokenTrade, TokenTradesResponse } from "./types";

export type TradeBatch = {
  /** any order; may repeat trades already delivered (consumers de-duplicate by signature + wallet + side) */
  trades: TokenTrade[];
  /** true = "the newest N trades" (a poll): a batch sharing no trade with what the consumer holds means a hole */
  snapshot: boolean;
};
export type TradeSource = (mint: string, onBatch: (b: TradeBatch) => void) => () => void;

/** trades?limit= of the poll: the Activity panel's key, keep them equal or the poll is no longer shared */
export const POLL_LIMIT = 100;
const POLL_MS = 2000;

export const pollTradeSource: TradeSource = (mint, onBatch) => {
  const res = sharedResource<TokenTradesResponse>(`/api/token/${mint}/trades?limit=${POLL_LIMIT}`, POLL_MS);
  let seenAt = 0;
  const fire = () => {
    const s = res.getSnapshot();
    if (!s.data || s.at === seenAt) return;
    seenAt = s.at;
    onBatch({ trades: s.data.trades, snapshot: true });
  };
  const off = res.subscribe(fire);
  fire(); // a poll already warm (Activity mounted first) paints at once
  return off;
};

let source: TradeSource = pollTradeSource;
const swapListeners = new Set<() => void>();
/** replace the feed (e.g. the live SSE one); subscribers re-subscribe to the new source */
export function setTradeSource(next: TradeSource) {
  if (next === source) return;
  source = next;
  swapListeners.forEach((l) => l());
}

export function subscribeTrades(mint: string, onBatch: (b: TradeBatch) => void): () => void {
  let off = source(mint, onBatch);
  const swap = () => {
    off();
    off = source(mint, onBatch);
  };
  swapListeners.add(swap);
  return () => {
    swapListeners.delete(swap);
    off();
  };
}

/** calls `onBatch` for every batch of `mint` (null = idle); the callback may change between renders */
export function useTradeStream(mint: string | null, onBatch: (b: TradeBatch) => void) {
  const cb = useRef(onBatch);
  useEffect(() => {
    cb.current = onBatch;
  });
  useEffect(() => {
    if (!mint) return;
    return subscribeTrades(mint, (b) => cb.current(b));
  }, [mint]);
}
