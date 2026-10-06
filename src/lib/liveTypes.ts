/* Live trade feed of one mint (server: src/server/livefeed.ts, SSE /api/token/[mint]/live, client: src/lib/livefeed.ts). */
import type { TokenTrade } from "./types";

/** one pump.fun trade event, pushed the moment its transaction is confirmed */
export type LiveTrade = TokenTrade & {
  /** tokens moved (decimal string, 6 decimals applied) */
  tokens: string;
  /** SOL that left (buy) / reached (sell) the wallet for this trade, pump.fun fees inside — same rule as the engine's
   *  wallet history, so a live delta and the next positions read agree */
  walletSol: string;
  /** coin creator and the creator fee this trade paid it (SOL) */
  creator: string;
  creatorFeeSol: string;
  /** curve reserves right after the trade (raw u64 decimal strings): the live price and the live quote of holdings */
  vSol: string;
  vTok: string;
  realTok: string;
  /** epoch ms the server parsed it (latency measurement) */
  seenAt: number;
};

export type LiveStatus = "connecting" | "live" | "down";

/** first SSE event: the feed's recent trades + state; then `trade` (LiveTrade[]), `status`, `sol` events */
export type LiveHello = { mint: string; status: LiveStatus; trades: LiveTrade[]; solUsd: number | null };
