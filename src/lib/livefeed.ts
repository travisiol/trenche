"use client";
/* Live trades of one mint, shared by every panel of the workspace (Activity, Tasks, Token info): ONE EventSource on
 * /api/token/[mint]/live per mint (a browser keeps ~6 HTTP/1.1 connections per origin, each stream holds one),
 * opened by the first subscriber, closed 5 s after the last. The EventSource reconnects by itself; meanwhile the
 * panels' polling (/api/token/[mint]/trades every 2 s, positions, PnL) keeps working as before — this only adds speed. */
import { useSyncExternalStore } from "react";
import type { LiveHello, LiveStatus, LiveTrade } from "./liveTypes";

/** a live trade + when THIS tab received it (a positions read sent after that already contains it) */
export type ReceivedTrade = LiveTrade & { receivedAt: number };
export type LiveFeed = {
  status: LiveStatus;
  /** newest first (≤ 300) */
  trades: ReceivedTrade[];
  /** the curve's state after the newest trade: spot price = vSol / vTok */
  last: ReceivedTrade | null;
  solUsd: number | null;
};
type Entry = { feed: LiveFeed; listeners: Set<() => void>; onTrade: Set<(t: ReceivedTrade[]) => void>; close: () => void; closeTimer: ReturnType<typeof setTimeout> | null };

const entries = new Map<string, Entry>();
const keyOf = (t: { signature: string; wallet: string; side: string }) => `${t.signature}:${t.wallet}:${t.side}`;
const IDLE: LiveFeed = { status: "connecting", trades: [], last: null, solUsd: null };

/** newest curve state: highest slot; inside one transaction the list order (newest first) decides */
function lastOf(trades: ReceivedTrade[]): ReceivedTrade | null {
  let best: ReceivedTrade | null = null;
  for (const t of trades) if (!best || t.slot > best.slot) best = t;
  return best;
}

function start(mint: string): Entry {
  const e: Entry = { feed: IDLE, listeners: new Set(), onTrade: new Set(), close: () => {}, closeTimer: null };
  entries.set(mint, e);
  const set = (patch: Partial<LiveFeed>) => {
    e.feed = { ...e.feed, ...patch };
    e.listeners.forEach((l) => l());
  };
  const add = (rows: LiveTrade[]) => {
    const have = new Set(e.feed.trades.map(keyOf));
    const now = Date.now();
    const fresh = rows.filter((r) => !have.has(keyOf(r))).map((r) => ({ ...r, receivedAt: now }));
    if (!fresh.length) return;
    const trades = [...fresh, ...e.feed.trades].slice(0, 300);
    set({ trades, last: lastOf(trades) });
    e.onTrade.forEach((f) => f(fresh));
  };
  let es: EventSource | null = null;
  try {
    es = new EventSource(`/api/token/${mint}/live`);
    es.addEventListener("hello", (ev) => {
      try {
        const h = JSON.parse((ev as MessageEvent).data) as LiveHello;
        set({ status: h.status, solUsd: h.solUsd ?? e.feed.solUsd });
        // the backlog: dated by the server's parse time (same machine) — a positions read sent after it holds it
        const have = new Set(e.feed.trades.map(keyOf));
        const old = h.trades.filter((r) => !have.has(keyOf(r))).map((r) => ({ ...r, receivedAt: r.seenAt }));
        if (old.length) {
          const trades = [...e.feed.trades, ...old].sort((a, b) => b.slot - a.slot).slice(0, 300);
          set({ trades, last: lastOf(trades) });
        }
      } catch {
        /* malformed event */
      }
    });
    es.addEventListener("trade", (ev) => {
      try {
        add(JSON.parse((ev as MessageEvent).data) as LiveTrade[]);
      } catch {
        /* malformed event */
      }
    });
    es.addEventListener("status", (ev) => {
      try {
        set({ status: JSON.parse((ev as MessageEvent).data) as LiveStatus });
      } catch {
        /* malformed event */
      }
    });
    es.addEventListener("sol", (ev) => {
      const usd = Number((ev as MessageEvent).data);
      if (Number.isFinite(usd) && usd > 0) set({ solUsd: usd });
    });
    es.onerror = () => set({ status: "down" }); // EventSource retries on its own; polling covers the gap
  } catch {
    set({ status: "down" });
  }
  e.close = () => {
    es?.close();
    es = null;
    entries.delete(mint);
  };
  return e;
}

function entryOf(mint: string): Entry {
  const e = entries.get(mint) ?? start(mint);
  if (e.closeTimer) clearTimeout(e.closeTimer);
  e.closeTimer = null;
  return e;
}

function release(mint: string, e: Entry) {
  if (e.listeners.size || e.onTrade.size || e.closeTimer) return;
  // a panel re-mounting (maximize, layout reset) must not reopen the stream
  e.closeTimer = setTimeout(() => {
    e.closeTimer = null;
    if (!e.listeners.size && !e.onTrade.size) e.close();
  }, 5000);
}

/** call `fn` with every batch of NEW trades of `mint` (one transaction each) */
export function onLiveTrades(mint: string, fn: (t: ReceivedTrade[]) => void): () => void {
  const e = entryOf(mint);
  e.onTrade.add(fn);
  return () => {
    e.onTrade.delete(fn);
    release(mint, e);
  };
}

/** live feed of `mint` (null = nothing) */
export function useLiveFeed(mint: string | null): LiveFeed {
  return useSyncExternalStore(
    (cb) => {
      if (!mint) return () => {};
      const e = entryOf(mint);
      e.listeners.add(cb);
      return () => {
        e.listeners.delete(cb);
        release(mint, e);
      };
    },
    () => (mint ? (entries.get(mint)?.feed ?? IDLE) : IDLE),
    () => IDLE,
  );
}

/** polled trade rows + the live ones not polled yet, newest first, one row per signature + wallet + side */
export function mergeLive<T extends { signature: string; wallet: string; side: string; slot: number; blockTime: number }>(polled: T[], live: LiveTrade[], toRow: (t: LiveTrade) => T): T[] {
  if (!live.length) return polled;
  const have = new Set(polled.map(keyOf));
  const extra = live.filter((t) => !have.has(keyOf(t))).map(toRow);
  if (!extra.length) return polled;
  return [...extra, ...polled].sort((a, b) => b.slot - a.slot || b.blockTime - a.blockTime);
}
