/* Token routes' data: info (metadata + curve), trades (curveTradeHistory), holders (getTokenLargestAccounts), candles. */
import { PublicKey } from "@solana/web3.js";
import { curveTradeHistory } from "@/engine/solana/pump/positions.js";
import { TOKEN_2022_PROGRAM, associatedTokenAddress, bondingCurvePda, tokenProgramFor } from "@/engine/solana/pump/pdas.js";
import type { Candle, CandleTf, TokenCandlesResponse, TokenHolder, TokenHoldersResponse, TokenInfo, TokenTrade, TokenTradesResponse } from "@/lib/types";
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

const TF_SEC: Record<CandleTf, number> = { "1s": 1, "15s": 15, "1m": 60 };

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
