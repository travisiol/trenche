/* Token routes' data: info, trades, candles, stats, holders.
 * Primary source = pump.fun's public APIs (pumpapi.ts: coin list by creator, swap-api trades and candles — cached
 * server-side, N clients = 1 upstream call). Fallback = the RPC (curve account, curveTradeHistory). The RPC curve
 * read stays the truth for the CurveState when it answers; balances are always RPC. */
import { PublicKey } from "@solana/web3.js";
import { curveTradeHistory } from "@/engine/solana/pump/positions.js";
import { INITIAL_REAL_TOKENS, TOKEN_2022_PROGRAM, associatedTokenAddress, bondingCurvePda, tokenProgramFor } from "@/engine/solana/pump/pdas.js";
import type { Candle, CandleTf, ChartMark, CurveState, StatsWindow, TokenCandlesResponse, TokenHolder, TokenHoldersResponse, TokenInfo, TokenStatsResponse, TokenTrade, TokenTradesResponse, WindowStats } from "@/lib/types";
import { HttpError } from "./api";
import { PUMP_SUPPLY_TOKENS, fetchCurve, readConn, toCurveState, tokenProgramOf } from "./engine";
import { feedCard, feedSolUsd } from "./feed";
import { liveTrades } from "./livefeed";
import { imageUrl, rememberMeta, resolveMeta } from "./metadata";
import { solPrice } from "./price";
import { store } from "./store";
import { ownedAddresses } from "./wallets";
import { TF_SECONDS, aggregateCandles, candlesFromTrades, normalizeCandles, pumpCandles, pumpCoin, pumpTrades, type PumpCoin } from "./pumpapi";

/** creator of a mint, remembered for the process (launch records first, then the curve read once) */
const creators = new Map<string, string>();
async function creatorOf(mint: string): Promise<string | null> {
  const known = creators.get(mint);
  if (known) return known;
  const rec = store().launches.find((l) => l.mint === mint);
  const fromCard = feedCard(mint)?.creator ?? null;
  let c = rec?.dev ?? fromCard;
  if (!c) {
    const found = await fetchCurve(readConn(), new PublicKey(mint)).catch(() => null);
    c = found?.curve.creator.toBase58() ?? null;
  }
  if (c) creators.set(mint, c);
  return c;
}

/** pump.fun coin row when the API answers (never throws) */
async function coinOf(mint: string): Promise<PumpCoin | null> {
  const creator = await creatorOf(mint);
  if (!creator) return null;
  return pumpCoin(mint, creator).catch(() => null);
}

/** CurveState synthesized from the pump.fun coin row (used when the RPC curve read fails) */
function curveFromCoin(c: PumpCoin, solUsd: number | null): CurveState | null {
  if (!c.bondingCurve || c.virtualTokenReserves === "0") return null;
  const vSol = Number(c.virtualSolReserves) / 1e9;
  const vTok = Number(c.virtualTokenReserves) / 1e6;
  const priceSol = vTok > 0 ? vSol / vTok : 0;
  const sold = INITIAL_REAL_TOKENS - BigInt(c.realTokenReserves);
  const progress = c.complete ? 100 : Math.max(0, Math.min(100, Number((sold * BigInt(10000)) / INITIAL_REAL_TOKENS) / 100));
  const mcSol = c.marketCapSol ?? priceSol * PUMP_SUPPLY_TOKENS;
  return {
    bondingCurve: c.bondingCurve,
    virtualTokenReserves: c.virtualTokenReserves,
    virtualSolReserves: c.virtualSolReserves,
    realTokenReserves: c.realTokenReserves,
    realSolReserves: c.realSolReserves,
    tokenTotalSupply: c.totalSupply,
    complete: c.complete,
    creator: c.creator ?? "",
    isCashbackCoin: c.isCashback,
    progress,
    marketCapSol: mcSol,
    marketCapUsd: c.marketCapUsd ?? (solUsd ? mcSol * solUsd : null),
    priceSol,
  };
}

export async function tokenInfo(mint: string): Promise<TokenInfo> {
  const conn = readConn();
  const mintPk = new PublicKey(mint);
  const card = feedCard(mint);
  const [coin, found, price] = await Promise.all([coinOf(mint), fetchCurve(conn, mintPk).catch(() => null), solPrice().catch(() => null)]);
  const usd = price?.usd ?? feedSolUsd();
  const hint = coin ? { name: coin.name ?? undefined, symbol: coin.symbol ?? undefined, uri: coin.uri ?? undefined } : card ? { name: card.name, symbol: card.symbol, uri: card.uri } : undefined;
  // metadata: pump.fun row first (no RPC; remembered on disk for the back-off days), else the on-chain metadata →
  // uri → IPFS JSON (resolveMeta: cached on disk forever per mint), so name + image never disappear
  const meta = coin?.name && coin.symbol ? { name: coin.name, symbol: coin.symbol, uri: coin.uri, image: coin.image, description: coin.description, twitter: coin.twitter, telegram: coin.telegram, website: coin.website, tokenProgram: coin.tokenProgram } : await resolveMeta(mint, hint, conn);
  if (coin?.name && coin.symbol) rememberMeta({ mint, ...meta });
  const curve = found ? toCurveState(found.curve, found.pda, usd) : coin ? curveFromCoin(coin, usd) : null;
  // pump.fun's USD market cap is fresher than solPrice × SOL mc when both exist
  if (curve && coin?.marketCapUsd && !curve.complete) curve.marketCapUsd = coin.marketCapUsd;
  const tokenProgram = meta.tokenProgram ?? (found ? await tokenProgramOf(conn, mintPk).then((p) => p.toBase58()).catch(() => null) : null);
  return {
    mint,
    name: meta.name,
    symbol: meta.symbol,
    uri: meta.uri,
    image: imageUrl(meta.image),
    description: meta.description,
    twitter: meta.twitter,
    telegram: meta.telegram,
    website: meta.website,
    tokenProgram,
    creator: curve?.creator || coin?.creator || card?.creator || null,
    createdAt: coin?.createdAt ?? card?.createdAt ?? null,
    curve,
    complete: curve?.complete ?? coin?.complete ?? card?.complete ?? false,
    solPrice: usd,
    source: coin ? (found ? "pump+rpc" : "pump") : found ? "rpc" : "none",
    athMarketCapSol: coin?.athMarketCapSol ?? null,
    links: { pumpfun: `https://pump.fun/coin/${mint}`, solscan: `https://solscan.io/token/${mint}` },
  };
}

/** trades newest first: pump.fun swap-api (≤ 300), else the curve history read from the RPC */
/** pump.fun's trade list MERGED with the chain's (the curve's signatures, incremental, on our RPC): pump.fun is
 *  budgeted (12 calls/min for the whole app) and indexes a fresh coin seconds late — the chain has a trade the moment
 *  it lands (Cghynn…pump: chart and trades "took too long to appear"). One row per signature + wallet + side: a
 *  create carries the dev buy and the inline bundle buys under ONE signature. */
/** curveTradeHistory shared by concurrent callers: chart + trades + stats open together on a fresh coin and each
 *  started the same signature scan + getTransaction batch (3× the RPC work, all queued behind each other) */
/** curveTradeHistory reads its new transactions 2 at a time (engine code): 20 trades on a fresh coin = 10 round trips
 *  ≈ 2 s before the first candle. Fetch them first 4 at a time with the exact same RPC params — the RPC queue's
 *  cache (getTransaction 60 s, getSignaturesForAddress 2 s) then answers the engine's calls instantly. 4 lanes, not
 *  8: the launch engine shares the queue. Each signature is warmed once per process. */
const warmed = new Map<string, Set<string>>();
async function warmCurveTxs(mint: string): Promise<void> {
  const conn = readConn();
  const sigs = await conn.getSignaturesForAddress(bondingCurvePda(new PublicKey(mint)), { limit: 100 }).catch(() => []);
  let seen = warmed.get(mint);
  if (!seen) {
    seen = new Set();
    warmed.set(mint, seen);
    if (warmed.size > 200) warmed.delete(warmed.keys().next().value!);
  }
  const todo = sigs.filter((s) => !s.err && !seen.has(s.signature)).slice(0, 30);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, todo.length) }, async () => {
      while (i < todo.length) {
        const s = todo[i++];
        const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
        if (tx) seen.add(s.signature); // not found yet: retried on the next call
      }
    }),
  );
}

const chainInflight = new Map<string, { max: number; p: Promise<Awaited<ReturnType<typeof curveTradeHistory>>> }>();
function chainTrades(mint: string, max: number) {
  const run = chainInflight.get(mint);
  if (run && run.max >= max) return run.p;
  const p = warmCurveTxs(mint)
    .then(() => curveTradeHistory(readConn(), mint, { max }))
    .catch(() => [])
    .finally(() => {
      if (chainInflight.get(mint)?.p === p) chainInflight.delete(mint);
    });
  chainInflight.set(mint, { max, p });
  return p;
}

async function tradesOf(mint: string, limit: number, opts: { pumpWaitMs?: number } = {}): Promise<{ trades: TokenTrade[]; source: "pump" | "rpc" }> {
  const pumpCall = pumpTrades(mint, limit).catch(() => null);
  // pumpWaitMs: do not hold the chain's answer for pump.fun's (8 s timeout) — the call keeps filling its store
  const pumpCapped = opts.pumpWaitMs === undefined ? pumpCall : Promise.race([pumpCall, new Promise<null>((r) => setTimeout(() => r(null), opts.pumpWaitMs))]);
  const [pump, chain] = await Promise.all([
    pumpCapped,
    chainTrades(mint, Math.min(600, Math.max(20, limit))),
  ]);
  const out = new Map<string, TokenTrade>();
  const key = (t: { signature: string; wallet: string; side: string }) => `${t.signature}:${t.wallet}:${t.side}`;
  for (const t of chain) {
    const row: TokenTrade = { side: t.side, wallet: t.wallet, solAmount: t.quoteEth, priceSol: t.priceEth, blockTime: t.blockTime, slot: t.block, signature: t.hash };
    out.set(key(row), row);
  }
  // the live feed's rows (livefeed.ts: confirmed trades pushed by the RPC's WebSocket) — in the list before the polls see them
  for (const { side, wallet, solAmount, priceSol, blockTime, slot, signature } of liveTrades(mint)) {
    const t: TokenTrade = { side, wallet, solAmount, priceSol, blockTime, slot, signature };
    if (!out.has(key(t))) out.set(key(t), t);
  }
  for (const { priceUsd: _u, tokens: _t, ...t } of pump ?? []) out.set(key(t), t); // pump.fun's row wins (same trade)
  const trades = [...out.values()].sort((a, b) => b.slot - a.slot || b.blockTime - a.blockTime).slice(0, limit);
  return { trades, source: pump?.length ? "pump" : "rpc" };
}

export async function tokenTrades(mint: string, limit: number): Promise<TokenTradesResponse> {
  const { trades, source } = await tradesOf(mint, limit);
  return { mint, trades, supplyTokens: "1000000000", source };
}

/** chart markers: trades of our wallets (vault, trash, launch wallets) and of the coin's creator */
function marksOf(trades: TokenTrade[], creator: string | null): ChartMark[] {
  const ours = new Set(ownedAddresses());
  return trades
    .filter((t) => t.blockTime > 0 && (ours.has(t.wallet) || t.wallet === creator))
    .map((t) => ({ time: t.blockTime, side: t.side, solAmount: t.solAmount, wallet: t.wallet, dev: t.wallet === creator, signature: t.signature }));
}

export async function tokenCandles(mint: string, tf: CandleTf): Promise<TokenCandlesResponse> {
  const sec = TF_SECONDS[tf];
  let candles: Candle[] | null = null;
  let source: TokenCandlesResponse["source"] = "pump";
  // the chart's first paint: pump.fun gets 1.5 s, the chain's list answers alone after that (a fresh coin is on the
  // chain before pump.fun indexes it); the trade list also gives the markers, on every timeframe
  const [recent, creator] = await Promise.all([tradesOf(mint, 1000, { pumpWaitMs: 1500 }).then((r) => r.trades).catch(() => null), creatorOf(mint).catch(() => null)]);
  const marks = marksOf(recent ?? [], creator);
  if (sec <= 60) {
    // 1s / 5s / 15s / 1m: derived locally from the merged trade list (pump.fun + the chain) — no candle call, and the
    // newest trade is in the chart as soon as it is in the list
    if (recent?.length) {
      candles = normalizeCandles(candlesFromTrades(recent, sec));
      source = "trades";
    }
  } else {
    // 5m and up: pump.fun candles (cached 30 s), the trade store as a fallback
    const coin = await coinOf(mint);
    candles = await pumpCandles(mint, tf, coin?.createdAt ?? null).catch(() => null);
    if (!candles?.length && recent?.length) {
      candles = normalizeCandles(candlesFromTrades(recent, sec));
      source = "trades";
    }
  }
  if (!candles || !candles.length) {
    const rows = await curveTradeHistory(readConn(), mint, { max: 600 });
    candles = aggregateCandles(candlesFromTrades(rows.map((t) => ({ blockTime: t.blockTime, priceSol: t.priceEth, solAmount: t.quoteEth })), 1), sec);
    source = "rpc";
  }
  return { mint, tf, candles, trades: candles.reduce((n, c) => n + (c.volume > 0 ? 1 : 0), 0), source, marks, creator };
}

const WINDOWS: Record<StatsWindow, number> = { "5m": 300, "1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600 };

/** Block X window stats (5m / 1h / 6h / 24h: volume, buys/sells, price change) from the trade store (≤ 300) */
export async function tokenStats(mint: string): Promise<TokenStatsResponse> {
  const { trades, source } = await tradesOf(mint, 300);
  const sorted = trades.filter((t) => t.blockTime > 0).sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot);
  const now = Math.floor(Date.now() / 1000);
  const oldest = sorted[0]?.blockTime ?? now;
  const last = sorted[sorted.length - 1];
  const lastPrice = last ? Number(last.priceSol) : null;
  const windows = {} as Record<StatsWindow, WindowStats>;
  for (const [name, sec] of Object.entries(WINDOWS) as [StatsWindow, number][]) {
    const start = now - sec;
    const inWin = sorted.filter((t) => t.blockTime >= start);
    let buysSol = 0,
      sellsSol = 0,
      buys = 0,
      sells = 0;
    for (const t of inWin) {
      const v = Number(t.solAmount) || 0;
      if (t.side === "buy") {
        buysSol += v;
        buys++;
      } else {
        sellsSol += v;
        sells++;
      }
    }
    // price change: last trade vs the last trade BEFORE the window (or the first inside it when history starts inside)
    const before = [...sorted].reverse().find((t) => t.blockTime < start);
    const base = before ?? inWin[0];
    const basePrice = base ? Number(base.priceSol) : 0;
    const priceChangePct = lastPrice !== null && basePrice > 0 && inWin.length > 0 ? ((lastPrice - basePrice) / basePrice) * 100 : null;
    const partial = sorted.length >= 300 && oldest > start;
    windows[name] = {
      volumeSol: round(buysSol + sellsSol),
      buysSol: round(buysSol),
      sellsSol: round(sellsSol),
      netSol: round(buysSol - sellsSol),
      buys,
      sells,
      priceChangePct: priceChangePct === null ? null : Math.round(priceChangePct * 100) / 100,
      coverageSec: Math.max(0, Math.min(sec, now - Math.max(oldest, start))),
      partial,
    };
  }
  return { mint, at: Date.now(), lastPriceSol: lastPrice, tradesRead: sorted.length, windows, source };
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export async function tokenHolders(mint: string): Promise<TokenHoldersResponse> {
  const conn = readConn();
  const mintPk = new PublicKey(mint);
  const mintInfo = await conn.getAccountInfo(mintPk, "confirmed");
  if (!mintInfo) throw new HttpError(404, "Mint account not found.");
  const tp = tokenProgramFor(mintInfo.owner.toBase58() ?? TOKEN_2022_PROGRAM);
  let largest, supply, found;
  try {
    [largest, supply, found] = await Promise.all([conn.getTokenLargestAccounts(mintPk, "confirmed"), conn.getTokenSupply(mintPk, "confirmed"), fetchCurve(conn, mintPk)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Indexed requests|personal token|403|-32602/i.test(msg))
      throw new HttpError(503, "The read RPC refuses indexed requests (getTokenLargestAccounts). Holders need a Helius key or a private RPC in Settings.");
    throw new HttpError(502, `Holders unavailable: ${msg.slice(0, 160)}`);
  }
  const total = BigInt(supply.value.amount || "0");
  const curveAta = associatedTokenAddress(found?.pda ?? bondingCurvePda(mintPk), mintPk, tp).toBase58();
  const dev = found?.curve.creator.toBase58() ?? null;
  const accounts = largest.value.map((v) => v.address);
  const infos = accounts.length ? await conn.getMultipleAccountsInfo(accounts, "confirmed").catch(() => accounts.map(() => null)) : [];
  const holders: TokenHolder[] = largest.value.map((v, i) => {
    const data = infos[i]?.data;
    let owner: string | null = null;
    if (data && data.length >= 64) {
      try {
        owner = new PublicKey(Buffer.from(data).subarray(32, 64)).toBase58();
      } catch {
        owner = null;
      }
    }
    const amount = BigInt(v.amount);
    const account = v.address.toBase58();
    return { account, owner, amount: amount.toString(), pct: total > BigInt(0) ? Number((amount * BigInt(1_000_000)) / total) / 10_000 : 0, isCurve: account === curveAta, isDev: !!dev && owner === dev };
  });
  const nonCurve = holders.filter((h) => !h.isCurve);
  const top10Pct = total > BigInt(0) ? Math.round(nonCurve.slice(0, 10).reduce((s, h) => s + h.pct, 0) * 100) / 100 : null;
  const devPct = dev ? Math.round(nonCurve.filter((h) => h.isDev).reduce((s, h) => s + h.pct, 0) * 100) / 100 : null;
  return { mint, totalSupply: total.toString(), holders, top10Pct, devPct };
}
