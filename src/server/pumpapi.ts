/* pump.fun public frontend APIs (no key) — the fast path for coin info, trades and candles.
 * The RPC curve read stays the truth for balances and the fallback when pump.fun is down/blocked.
 *
 * Shapes probed on 2026-10-05 against the live mint 2vW6TTNz52fbZBPzBBvE7wVBEtCYVcBhHi6KeE9AdALu (curl):
 *
 *  GET https://frontend-api-v3.pump.fun/coins/<mint>              → 404 "Cannot GET" (route gone)
 *  GET https://frontend-api-v3.pump.fun/candlesticks/<mint>?…       → 404 "Cannot GET" (route gone)
 *  GET https://frontend-api-v3.pump.fun/trades/all/<mint>?…         → 400 (wants a CAIP chainId the API then rejects)
 *  GET https://frontend-api-v2.pump.fun/…                           → 403 Cloudflare access_denied
 *  GET https://advanced-api-v2.pump.fun/…                           → 530 (origin down)
 *
 *  GET https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=true&creator=<creator>
 *    → 200 Coin[] (newest first), the only working per-coin lookup: filter by `mint`. `searchTerm=<mint>` does NOT filter.
 *    Coin = { mint, name, symbol, description, image_uri, metadata_uri, twitter, telegram, website, bonding_curve,
 *             associated_bonding_curve, creator, created_timestamp (ms), complete, virtual_sol_reserves,
 *             virtual_token_reserves, real_sol_reserves, real_token_reserves, total_supply (1e15),
 *             market_cap (SOL), usd_market_cap, ath_market_cap (SOL), ath_market_cap_timestamp, last_trade_timestamp,
 *             reply_count, is_currently_live, program ("pump"), token_program, pool_address, is_cashback_enabled, … }
 *
 *  GET https://swap-api.pump.fun/v2/coins/<mint>/trades?limit=100[&cursor=<nextCursor>]
 *    → 200 { trades: Trade[] (newest first), pagination: { nextCursor, hasMore, limit } }
 *    Trade = { slotIndexId, tx (signature), timestamp (ISO), userAddress, type: "buy" | "sell", program: "pump",
 *              priceUsd, priceSol (SOL per token), amountUsd, amountSol (SOL moved), baseAmount (tokens),
 *              quoteAmount (SOL), fillPriceUsd, fillPriceSol } — every number is a decimal string.
 *
 *  GET https://swap-api.pump.fun/v2/coins/<mint>/candles?interval=<i>&limit=1000&currency=SOL&createdTs=<ms|0>
 *    → 200 Candle[] (oldest first). interval ∈ 1s 15s 30s 1m 5m 15m 30m 1h 4h 6h 12h 24h (no 5s, no 1d → 24h).
 *    Candle = { timestamp (ms, bucket start), open, high, low, close (SOL per token, decimal strings — plain or
 *               exponent form), volume (SOL, string) }. createdTs is required (0 is accepted).
 *
 * Every upstream call is cached server-side (2 s trades, 3 s coin, 3 s candles) and deduplicated, so N open
 * clients cost one call. A 403/429/5xx or Cloudflare block puts pump.fun in a 60 s back-off (`pumpStatus()`),
 * during which the callers fall back to the RPC. */
import type { Candle, CandleTf, TokenTrade } from "@/lib/types";

const FRONTEND = "https://frontend-api-v3.pump.fun";
const SWAP = "https://swap-api.pump.fun";
const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  origin: "https://pump.fun",
  referer: "https://pump.fun/",
};

export type PumpCoin = {
  mint: string;
  name: string | null;
  symbol: string | null;
  description: string | null;
  image: string | null;
  uri: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  creator: string | null;
  bondingCurve: string | null;
  createdAt: number | null;
  complete: boolean;
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
  totalSupply: string;
  marketCapSol: number | null;
  marketCapUsd: number | null;
  athMarketCapSol: number | null;
  lastTradeAt: number | null;
  replyCount: number | null;
  tokenProgram: string | null;
  isCashback: boolean;
};

export type PumpTrade = TokenTrade & { priceUsd: number | null; tokens: string };

export type PumpStatus = { ok: boolean; blockedUntil: number | null; lastError: string | null; lastErrorAt: number | null; lastOkAt: number | null; callsLastMinute: number };

type CacheEntry<T> = { at: number; value: T };
type PumpGlobal = {
  cache: Map<string, CacheEntry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
  blockedUntil: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastOkAt: number | null;
  callsAt: number[];
};
declare global {
  var __trenchPump: PumpGlobal | undefined;
}
function g(): PumpGlobal {
  if (!globalThis.__trenchPump) globalThis.__trenchPump = { cache: new Map(), inflight: new Map(), blockedUntil: 0, lastError: null, lastErrorAt: null, lastOkAt: null, callsAt: [] };
  return globalThis.__trenchPump;
}

export class PumpUnavailable extends Error {}

export function pumpStatus(): PumpStatus {
  const s = g();
  const now = Date.now();
  while (s.callsAt.length && s.callsAt[0] < now - 60_000) s.callsAt.shift();
  return { ok: now >= s.blockedUntil, blockedUntil: now < s.blockedUntil ? s.blockedUntil : null, lastError: s.lastError, lastErrorAt: s.lastErrorAt, lastOkAt: s.lastOkAt, callsLastMinute: s.callsAt.length };
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const s = g();
  if (Date.now() < s.blockedUntil) throw new PumpUnavailable(`pump.fun API in back-off until ${new Date(s.blockedUntil).toISOString()} (${s.lastError ?? "blocked"})`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  s.callsAt.push(Date.now());
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctl.signal, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      const blocked = res.status === 403 || res.status === 429 || res.status >= 500;
      const msg = `${res.status} ${res.statusText}: ${text.slice(0, 120).replace(/\s+/g, " ")}`;
      if (blocked) {
        s.blockedUntil = Date.now() + (res.status === 429 ? 20_000 : 60_000);
        s.lastError = msg;
        s.lastErrorAt = Date.now();
      }
      throw new PumpUnavailable(msg);
    }
    s.lastOkAt = Date.now();
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof PumpUnavailable) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    s.lastError = msg;
    s.lastErrorAt = Date.now();
    if (/abort/i.test(msg)) s.blockedUntil = Date.now() + 15_000;
    throw new PumpUnavailable(`pump.fun unreachable: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** cached + deduplicated upstream call */
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const s = g();
  const hit = s.cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  const running = s.inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = load()
    .then((v) => {
      s.cache.set(key, { at: Date.now(), value: v });
      if (s.cache.size > 500) {
        const now = Date.now();
        for (const [k, e] of s.cache) if (now - e.at > 120_000) s.cache.delete(k);
      }
      return v;
    })
    .finally(() => s.inflight.delete(key));
  s.inflight.set(key, p);
  return p;
}

type RawCoin = {
  mint: string;
  name?: string | null;
  symbol?: string | null;
  description?: string | null;
  image_uri?: string | null;
  metadata_uri?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  bonding_curve?: string | null;
  creator?: string | null;
  created_timestamp?: number | null;
  complete?: boolean;
  virtual_sol_reserves?: number | string | null;
  virtual_token_reserves?: number | string | null;
  real_sol_reserves?: number | string | null;
  real_token_reserves?: number | string | null;
  total_supply?: number | string | null;
  total_supply_str?: string | null;
  market_cap?: number | null;
  usd_market_cap?: number | null;
  ath_market_cap?: number | null;
  last_trade_timestamp?: number | null;
  reply_count?: number | null;
  token_program?: string | null;
  is_cashback_enabled?: boolean | null;
};

const big = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined) return "0";
  if (typeof v === "string") return /^\d+$/.test(v) ? v : String(Math.round(Number(v) || 0));
  return BigInt(Math.round(v)).toString();
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function toCoin(c: RawCoin): PumpCoin {
  return {
    mint: c.mint,
    name: c.name ?? null,
    symbol: c.symbol ?? null,
    description: c.description ?? null,
    image: c.image_uri ?? null,
    uri: c.metadata_uri ?? null,
    twitter: c.twitter || null,
    telegram: c.telegram || null,
    website: c.website || null,
    creator: c.creator ?? null,
    bondingCurve: c.bonding_curve ?? null,
    createdAt: num(c.created_timestamp),
    complete: !!c.complete,
    virtualSolReserves: big(c.virtual_sol_reserves),
    virtualTokenReserves: big(c.virtual_token_reserves),
    realSolReserves: big(c.real_sol_reserves),
    realTokenReserves: big(c.real_token_reserves),
    totalSupply: c.total_supply_str ?? big(c.total_supply),
    marketCapSol: num(c.market_cap),
    marketCapUsd: num(c.usd_market_cap),
    athMarketCapSol: num(c.ath_market_cap),
    lastTradeAt: num(c.last_trade_timestamp),
    replyCount: num(c.reply_count),
    tokenProgram: c.token_program ?? null,
    isCashback: !!c.is_cashback_enabled,
  };
}

/** every coin of one creator (newest first) — the only per-coin lookup frontend-api-v3 still answers */
export function pumpCoinsByCreator(creator: string): Promise<PumpCoin[]> {
  return cached(`creator:${creator}`, 3000, async () => {
    const raw = await fetchJson<RawCoin[]>(`${FRONTEND}/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=true&creator=${encodeURIComponent(creator)}`);
    return Array.isArray(raw) ? raw.filter((c) => c && typeof c.mint === "string").map(toCoin) : [];
  });
}

/** coin info of `mint`; needs its creator (launch record dev, or the curve's creator read once from the RPC) */
export async function pumpCoin(mint: string, creator: string): Promise<PumpCoin | null> {
  const list = await pumpCoinsByCreator(creator);
  return list.find((c) => c.mint === mint) ?? null;
}

type RawTrade = { tx: string; timestamp: string; userAddress: string; type: "buy" | "sell"; priceSol: string; priceUsd?: string; amountSol: string; quoteAmount?: string; baseAmount?: string; slotIndexId?: string };
type RawTrades = { trades: RawTrade[]; pagination?: { nextCursor?: string | null; hasMore?: boolean } };

function toTrade(t: RawTrade): PumpTrade {
  const ms = Date.parse(t.timestamp);
  return {
    side: t.type === "sell" ? "sell" : "buy",
    wallet: t.userAddress,
    solAmount: String(Number(t.amountSol ?? t.quoteAmount ?? 0)),
    priceSol: String(Number(t.priceSol) || 0),
    priceUsd: num(t.priceUsd),
    tokens: String(Number(t.baseAmount ?? 0)),
    blockTime: Number.isFinite(ms) ? Math.floor(ms / 1000) : 0,
    // slotIndexId = zero-padded slot (10 digits) + index; the slot is informative only
    slot: t.slotIndexId && /^\d{10}/.test(t.slotIndexId) ? Number(t.slotIndexId.slice(0, 10)) : 0,
    signature: t.tx,
  };
}

/** newest `limit` trades (≤ 300, 100 per upstream page), newest first; cached 2 s */
export function pumpTrades(mint: string, limit = 100): Promise<PumpTrade[]> {
  const want = Math.max(1, Math.min(300, limit));
  const pages = Math.ceil(want / 100);
  return cached(`trades:${mint}:${pages}`, 2000, async () => {
    const out: PumpTrade[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < pages; i++) {
      const url: string = `${SWAP}/v2/coins/${mint}/trades?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page: RawTrades = await fetchJson<RawTrades>(url);
      const rows = Array.isArray(page?.trades) ? page.trades : [];
      out.push(...rows.filter((t) => t && typeof t.tx === "string").map(toTrade));
      cursor = page.pagination?.hasMore && page.pagination.nextCursor ? page.pagination.nextCursor : null;
      if (!cursor || rows.length < 100) break;
    }
    return out;
  }).then((rows) => rows.slice(0, want));
}

type RawCandle = { timestamp: number; open: string | number; high: string | number; low: string | number; close: string | number; volume: string | number };

/** pump.fun interval for a UI timeframe (5s has no upstream interval: aggregated from 1s; 1D = 24h) */
const PUMP_INTERVAL: Record<CandleTf, { interval: string; sec: number; aggregate?: number }> = {
  "1s": { interval: "1s", sec: 1 },
  "5s": { interval: "1s", sec: 5, aggregate: 5 },
  "15s": { interval: "15s", sec: 15 },
  "1m": { interval: "1m", sec: 60 },
  "5m": { interval: "5m", sec: 300 },
  "15m": { interval: "15m", sec: 900 },
  "1h": { interval: "1h", sec: 3600 },
  "4h": { interval: "4h", sec: 14400 },
  "1D": { interval: "24h", sec: 86400 },
};

export const TF_SECONDS: Record<CandleTf, number> = Object.fromEntries(Object.entries(PUMP_INTERVAL).map(([k, v]) => [k, v.sec])) as Record<CandleTf, number>;

/** OHLCV candles (SOL per token, volume in SOL), oldest first, de-duplicated and strictly increasing in time */
export function pumpCandles(mint: string, tf: CandleTf, createdTs: number | null): Promise<Candle[]> {
  const spec = PUMP_INTERVAL[tf];
  return cached(`candles:${mint}:${spec.interval}`, 3000, async () => {
    const raw = await fetchJson<RawCandle[]>(`${SWAP}/v2/coins/${mint}/candles?interval=${spec.interval}&limit=1000&currency=SOL&createdTs=${createdTs ?? 0}`);
    const rows = Array.isArray(raw) ? raw : [];
    const base = spec.aggregate ? spec.sec / spec.aggregate : spec.sec;
    return normalizeCandles(
      rows.map((c) => ({ time: Math.floor(Number(c.timestamp) / 1000 / base) * base, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) || 0 })),
    );
  }).then((c) => (spec.aggregate ? aggregateCandles(c, spec.sec) : c));
}

/** sort, drop non-finite rows, merge duplicate buckets (lightweight-charts needs strictly increasing unique times) */
export function normalizeCandles(rows: Candle[]): Candle[] {
  const ok = rows.filter((c) => Number.isFinite(c.time) && c.time > 0 && [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0));
  ok.sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  for (const c of ok) {
    const last = out[out.length - 1];
    if (last && last.time === c.time) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else out.push({ ...c });
  }
  return out;
}

/** re-bucket finer candles into `sec`-wide buckets */
export function aggregateCandles(rows: Candle[], sec: number): Candle[] {
  const out: Candle[] = [];
  for (const c of rows) {
    const t = Math.floor(c.time / sec) * sec;
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
  }
  return out;
}

/** candles from a trade list (any timeframe) — used for 1s/5s/15s when the candle API has no row yet */
export function candlesFromTrades(trades: { blockTime: number; priceSol: string; solAmount: string }[], sec: number): Candle[] {
  const sorted = trades.filter((t) => t.blockTime > 0 && Number(t.priceSol) > 0).sort((a, b) => a.blockTime - b.blockTime);
  const out: Candle[] = [];
  for (const t of sorted) {
    const bucket = Math.floor(t.blockTime / sec) * sec;
    const price = Number(t.priceSol);
    const vol = Number(t.solAmount) || 0;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += vol;
    } else out.push({ time: bucket, open: last?.close ?? price, high: Math.max(price, last?.close ?? price), low: Math.min(price, last?.close ?? price), close: price, volume: vol });
  }
  return out;
}
