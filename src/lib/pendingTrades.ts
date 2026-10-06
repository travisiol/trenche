"use client";
/* Our own trades, shown in the trade lists the moment they are SENT — before pump.fun's trade API (or the RPC
 * history) returns them. Fed by the job stream of every buy / sell / dump this tab started:
 *   "sent" step → pending row · "landed" (processed) → landed · "send" result → confirmed / failed.
 * A row disappears as soon as the API list contains its signature (the real row replaces it), a confirmed row after
 * 90 s at most, a failed one after 12 s. A single toast per job when its first transaction lands. */
import { useSyncExternalStore } from "react";
import { toast } from "@/components/ui";
import { subscribeJob } from "./jobstream";
import type { TokenTrade } from "./types";

export type PendingStatus = "sent" | "landed" | "confirmed" | "failed";
export type PendingTrade = { mint: string; signature: string; wallet: string; side: "buy" | "sell"; solAmount: string; at: number; status: PendingStatus; error?: string };
export type ListedTrade = TokenTrade & { pending?: PendingStatus };

const rows = new Map<string, PendingTrade>(); // by signature + wallet (a create carries the dev + inline buys)
const keyOf = (r: { signature: string; wallet: string }) => `${r.signature}:${r.wallet}`;
const listeners = new Set<() => void>();
let snapshotByMint = new Map<string, PendingTrade[]>();
let sweep: ReturnType<typeof setInterval> | null = null;

function emit() {
  const m = new Map<string, PendingTrade[]>();
  for (const r of rows.values()) {
    const list = m.get(r.mint) ?? [];
    list.push(r);
    m.set(r.mint, list);
  }
  for (const list of m.values()) list.sort((a, b) => b.at - a.at);
  snapshotByMint = m;
  listeners.forEach((l) => l());
  if (rows.size && !sweep)
    sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, r] of rows)
        if ((r.status === "failed" && now - r.at > 12_000) || now - r.at > 90_000) {
          rows.delete(k);
          changed = true;
        }
      if (changed) emit();
      if (!rows.size && sweep) {
        clearInterval(sweep);
        sweep = null;
      }
    }, 3000);
}

const RANK: Record<PendingStatus, number> = { sent: 0, landed: 1, confirmed: 2, failed: 2 };

function upsert(r: PendingTrade) {
  const have = rows.get(keyOf(r));
  if (have && RANK[have.status] > RANK[r.status]) return false;
  if (have && have.status === r.status) return false;
  rows.set(keyOf(r), { ...r, at: have?.at ?? r.at });
  return true;
}

/** follow a trade job: its sent / landed / settled steps become pending rows of `mint` */
export function trackTradeJob(jobId: string, meta: { mint: string; side: "buy" | "sell"; label: string }): void {
  let toasted = false;
  let unsub: (() => void) | null = null;
  unsub = subscribeJob(jobId, (job) => {
    if (!job) return;
    let changed = false;
    for (const s of job.steps) {
      if (!s.signature || !s.address) continue;
      const base = { mint: meta.mint, signature: s.signature, wallet: s.address, side: meta.side, solAmount: s.sol ?? "0", at: s.at };
      if (s.phase === "sent") changed = upsert({ ...base, status: "sent" }) || changed;
      else if (s.phase === "landed") {
        changed = upsert({ ...base, status: s.ok ? "landed" : "failed", error: s.ok ? undefined : s.error }) || changed;
        if (s.ok && !toasted) {
          toasted = true;
          toast(`${meta.label}: landed`, "ok");
        }
      } else if (s.phase === "send" || s.phase === "bundle") changed = upsert({ ...base, status: s.ok ? "confirmed" : "failed", error: s.error }) || changed;
    }
    if (changed) emit();
    if (job.done) queueMicrotask(() => unsub?.());
  });
}

/** this tab's pending trades of `mint`, newest first */
export function usePendingTrades(mint: string | null): PendingTrade[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => (mint ? (snapshotByMint.get(mint) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}
const EMPTY: PendingTrade[] = [];

/** API trades + our pending ones not listed yet (pending first, newest first); a listed signature drops its pending row */
export function mergePending(api: TokenTrade[], pending: PendingTrade[], priceSol: number | null): ListedTrade[] {
  if (!pending.length) return api;
  const listed = new Set(api.map(keyOf));
  const extra: ListedTrade[] = pending
    .filter((p) => !listed.has(keyOf(p)))
    .map((p) => ({ side: p.side, wallet: p.wallet, solAmount: p.solAmount, priceSol: String(priceSol ?? 0), blockTime: Math.floor(p.at / 1000), slot: 0, signature: p.signature, pending: p.status }));
  // a listed one is done with: forget it (outside render, on the next tick)
  const seen = pending.filter((p) => listed.has(keyOf(p)));
  if (seen.length)
    queueMicrotask(() => {
      for (const p of seen) rows.delete(keyOf(p));
      emit();
    });
  return extra.length ? [...extra, ...api] : api;
}
