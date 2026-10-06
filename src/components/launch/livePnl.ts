"use client";
/* The Tasks panel's live layer: positions / balances / PnL moved by every trade of the live feed (src/lib/livefeed.ts)
 * between the polled reads, which stay the truth and absorb each delta when they catch up (src/lib/livePositions.ts). */
import { useEffect } from "react";
import { api, useGet, type ResourceState } from "@/lib/api";
import { onLiveTrades, useLiveFeed } from "@/lib/livefeed";
import { applyLive, spotOf } from "@/lib/livePositions";
import { balancesRes, useBalances } from "@/lib/store";
import type { BalancesResponse, MintPnl, PositionRow, PositionsResponse, TokenInfo } from "@/lib/types";

type Polled<T> = ResourceState<T> & { refresh: () => void };
type MintPnlResponse = { mint: string; row: MintPnl | null; covered?: boolean; feesThrough?: number | null };

const sentAt = (r: ResourceState<unknown>) => r.startedAt ?? r.at;

export function useLivePnl(mint: string | null, wallets: string[], positions: Polled<PositionsResponse>, mintPnl: Polled<MintPnlResponse>) {
  const feed = useLiveFeed(mint);
  // same key + interval as the Chart panel / launch page (one shared poll): the curve's spot price when the feed has no trade yet
  const token = useGet<TokenInfo>(mint ? `/api/token/${mint}` : null, 4000);
  const bal = useBalances();
  const own = new Set(wallets);
  const key = wallets.join(",");

  // one of our trades landed: re-read what it changed (balances at once, positions + ledger once the RPC indexed it)
  const { refresh: refreshPositions } = positions;
  const { refresh: refreshPnl } = mintPnl;
  useEffect(() => {
    if (!mint) return;
    const mine = new Set(key.split(","));
    const timers: ReturnType<typeof setTimeout>[] = [];
    const off = onLiveTrades(mint, (rows) => {
      if (!rows.some((t) => mine.has(t.wallet))) return;
      void api<BalancesResponse>("/api/balances?force=1").then((b) => balancesRes.mutate(b)).catch(() => null);
      timers.push(setTimeout(refreshPositions, 1200), setTimeout(refreshPnl, 2500));
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, [mint, key, refreshPositions, refreshPnl]);

  const rows = mint ? (positions.data ?? []).filter((r) => r.mint === mint) : [];
  const live = mint ? applyLive(mint, rows, feed.trades, feed.last, own, sentAt(positions)) : rows;
  const posMap = new Map<string, PositionRow>(live.map((r) => [r.wallet, r] as const));
  // the feed's reserves while it is live (the polled curve read can be a second older and would pull the price back)
  const spot = feed.last && (feed.status === "live" || feed.last.receivedAt >= token.at) ? spotOf(feed.last) : (token.data?.curve?.priceSol ?? 0);
  // the ledger replaces the estimate only when it holds every trade of ours — the ones landed after its last read included
  const pnlSentAt = sentAt(mintPnl);
  const newerOwn = feed.trades.some((t) => own.has(t.wallet) && t.receivedAt > pnlSentAt);
  const through = mintPnl.data?.feesThrough ?? 0;
  const liveFees = mintPnl.data ? feed.trades.reduce((n, t) => n + (own.has(t.creator) && t.blockTime * 1000 > through ? Number(t.creatorFeeSol) || 0 : 0), 0) : 0;
  const balSentAt = sentAt(bal);
  const balances = (base: Record<string, string | null> | null) => {
    const moved = feed.trades.filter((t) => own.has(t.wallet) && t.receivedAt > balSentAt);
    if (!base || !moved.length) return base;
    const out = { ...base };
    for (const t of moved) {
      const cur = out[t.wallet];
      if (cur === null || cur === undefined) continue;
      out[t.wallet] = String(Number(cur) + (t.side === "buy" ? -1 : 1) * Number(t.walletSol));
    }
    return out;
  };
  return { posMap, spot, solUsd: feed.solUsd, ledger: { covered: (mintPnl.data?.covered ?? true) && !newerOwn, liveFees }, balances, feed };
}
