/* Token routes' data: info (metadata + curve), trades (curveTradeHistory), holders (getTokenLargestAccounts), candles. */
import { PublicKey } from "@solana/web3.js";
import { curveTradeHistory } from "@/engine/solana/pump/positions.js";
import { TOKEN_2022_PROGRAM, associatedTokenAddress, bondingCurvePda, tokenProgramFor } from "@/engine/solana/pump/pdas.js";
import type { Candle, CandleTf, StatsWindow, TokenCandlesResponse, TokenHolder, TokenHoldersResponse, TokenInfo, TokenStatsResponse, TokenTrade, TokenTradesResponse, WindowStats } from "@/lib/types";
import { HttpError } from "./api";
import { fetchCurve, readConn, toCurveState, tokenProgramOf } from "./engine";
import { feedCard, feedSolUsd } from "./feed";
import { resolveMeta } from "./metadata";
import { solPrice } from "./price";

export async function tokenInfo(mint: string): Promise<TokenInfo> {
  const conn = readConn();
  const mintPk = new PublicKey(mint);
  const card = feedCard(mint);
  const [meta, found, price] = await Promise.all([
    resolveMeta(mint, card ? { name: card.name, symbol: card.symbol, uri: card.uri } : undefined, conn),
    fetchCurve(conn, mintPk),
    solPrice().catch(() => null),
  ]);
  const usd = price?.usd ?? feedSolUsd();
  const curve = found ? toCurveState(found.curve, found.pda, usd) : null;
  const tokenProgram = meta.tokenProgram ?? (found ? await tokenProgramOf(conn, mintPk).then((p) => p.toBase58()).catch(() => null) : null);
  return {
    mint,
    name: meta.name,
    symbol: meta.symbol,
    uri: meta.uri,
    image: meta.image,
    description: meta.description,
    twitter: meta.twitter,
    telegram: meta.telegram,
    website: meta.website,
    tokenProgram,
    creator: curve?.creator ?? card?.creator ?? null,
    createdAt: card?.createdAt ?? null,
    curve,
    complete: curve?.complete ?? card?.complete ?? false,
    solPrice: usd,
    links: { pumpfun: `https://pump.fun/coin/${mint}`, solscan: `https://solscan.io/token/${mint}` },
  };
}

export async function tokenTrades(mint: string, limit: number): Promise<TokenTradesResponse> {
  const rows = await curveTradeHistory(readConn(), mint, { max: Math.min(600, Math.max(20, limit)) });
  const trades: TokenTrade[] = rows.slice(0, limit).map((t) => ({ side: t.side, wallet: t.wallet, solAmount: t.quoteEth, priceSol: t.priceEth, blockTime: t.blockTime, slot: t.block, signature: t.hash }));
  return { mint, trades, supplyTokens: "1000000000" };
}

const TF_SEC: Record<CandleTf, number> = { "1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1D": 86400 };

export async function tokenCandles(mint: string, tf: CandleTf): Promise<TokenCandlesResponse> {
  const rows = await curveTradeHistory(readConn(), mint, { max: 600 });
  const sec = TF_SEC[tf];
  const sorted = rows.filter((t) => t.blockTime > 0 && Number(t.priceEth) > 0).sort((a, b) => a.blockTime - b.blockTime || a.block - b.block);
  const candles: Candle[] = [];
  for (const t of sorted) {
    const bucket = Math.floor(t.blockTime / sec) * sec;
    const price = Number(t.priceEth);
    const vol = Number(t.quoteEth);
    const last = candles[candles.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += vol;
    } else candles.push({ time: bucket, open: last?.close ?? price, high: Math.max(price, last?.close ?? price), low: Math.min(price, last?.close ?? price), close: price, volume: vol });
  }
  return { mint, tf, candles, trades: sorted.length };
}

const WINDOWS: Record<StatsWindow, number> = { "5m": 300, "1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600 };

/** Block X window stats (5m / 1h / 6h / 24h: volume, buys/sells, price change) from the last 600 curve trades */
export async function tokenStats(mint: string): Promise<TokenStatsResponse> {
  const rows = await curveTradeHistory(readConn(), mint, { max: 600 });
  const sorted = rows.filter((t) => t.blockTime > 0).sort((a, b) => a.blockTime - b.blockTime || a.block - b.block);
  const now = Math.floor(Date.now() / 1000);
  const oldest = sorted[0]?.blockTime ?? now;
  const last = sorted[sorted.length - 1];
  const lastPrice = last ? Number(last.priceEth) : null;
  const windows = {} as Record<StatsWindow, WindowStats>;
  for (const [name, sec] of Object.entries(WINDOWS) as [StatsWindow, number][]) {
    const start = now - sec;
    const inWin = sorted.filter((t) => t.blockTime >= start);
    let buysSol = 0,
      sellsSol = 0,
      buys = 0,
      sells = 0;
    for (const t of inWin) {
      const v = Number(t.quoteEth) || 0;
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
    const basePrice = base ? Number(base.priceEth) : 0;
    const priceChangePct = lastPrice !== null && basePrice > 0 && inWin.length > 0 ? ((lastPrice - basePrice) / basePrice) * 100 : null;
    const partial = sorted.length >= 600 && oldest > start;
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
  return { mint, at: Date.now(), lastPriceSol: lastPrice, tradesRead: sorted.length, windows };
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
