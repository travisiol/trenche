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
 * Rate limit (observed 2026-10-05): pump.fun's Cloudflare answers 429 "error 1015" above ~25 calls/min per IP.
 * So every upstream call goes through ONE budget shared by all routes: ≤ 12 calls in any 60 s window (token bucket:
 * 2 burst, +1 every 5 s). A call that finds no budget is not made: the caller gets the last value (stale, up to
 * 10 min) or falls back to the chain. Caches: trades 3 s per mint (ONE page of 100 per refresh, merged into a
 * per-mint trade store of ≤ 1000 — stats and the 1s/5s/15s/1m candles are derived from that store, no extra call),
 * candles ≥ 5m 30 s, coin rows 60 s. A 403/429/1015 backs off 30 s → 2 min → 5 min (reset by the next success),
 * 5xx/timeouts 30 s; during the back-off nothing is sent (`pumpStatus()`). */
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
type TradeStore = { trades: PumpTrade[]; at: number; deep: boolean; cursor: string | null };
type PumpGlobal = {
  cache: Map<string, CacheEntry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
  blockedUntil: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastOkAt: number | null;
  callsAt: number[];
  /** consecutive rate-limit answers (back-off ladder index) */
  strikes?: number;
  tokens?: number;
  refillAt?: number;
  /** calls refused by the budget in the last minute (served stale / from the chain instead) */
  skippedAt?: number[];
  trades?: Map<string, TradeStore>;
};
declare global {
  var __trenchPump: PumpGlobal | undefined;
}
function g(): PumpGlobal {
  if (!globalThis.__trenchPump) globalThis.__trenchPump = { cache: new Map(), inflight: new Map(), blockedUntil: 0, lastError: null, lastErrorAt: null, lastOkAt: null, callsAt: [] };
  return globalThis.__trenchPump;
}

export class PumpUnavailable extends Error {}

/** ≤ 12 upstream calls in any 60 s window, bucket of 2 refilled every 5 s */
export const PUMP_BUDGET_PER_MIN = 12;
const BUCKET = 2;
const REFILL_MS = 5000;
const BACKOFF_LADDER = [30_000, 120_000, 300_000];
/** a stale cached value is still served (instead of nothing) up to this age */
const STALE_MAX = 10 * 60_000;

function takeBudget(): boolean {
  const s = g();
  const now = Date.now();
  while (s.callsAt.length && s.callsAt[0] < now - 60_000) s.callsAt.shift();
  if (s.tokens === undefined || s.refillAt === undefined) {
    s.tokens = BUCKET;
    s.refillAt = now;
  }
  s.tokens = Math.min(BUCKET, s.tokens + (now - s.refillAt) / REFILL_MS);
  s.refillAt = now;
  if (s.tokens < 1 || s.callsAt.length >= PUMP_BUDGET_PER_MIN) {
    (s.skippedAt ??= []).push(now);
    while (s.skippedAt.length && s.skippedAt[0] < now - 60_000) s.skippedAt.shift();
    return false;
  }
  s.tokens -= 1;
  return true;
}

/** true when a call could be made right now (no back-off, budget left) — no token is taken */
export function pumpCallable(): boolean {
  const s = g();
  const now = Date.now();
  if (now < s.blockedUntil) return false;
  const tokens = Math.min(BUCKET, (s.tokens ?? BUCKET) + (now - (s.refillAt ?? now)) / REFILL_MS);
  return tokens >= 1 && s.callsAt.filter((t) => t >= now - 60_000).length < PUMP_BUDGET_PER_MIN;
}

export function pumpStatus(): PumpStatus & { budgetPerMinute: number; skippedLastMinute: number } {
  const s = g();
  const now = Date.now();
  while (s.callsAt.length && s.callsAt[0] < now - 60_000) s.callsAt.shift();
  const skipped = (s.skippedAt ?? []).filter((t) => t >= now - 60_000).length;
  return { ok: now >= s.blockedUntil, blockedUntil: now < s.blockedUntil ? s.blockedUntil : null, lastError: s.lastError, lastErrorAt: s.lastErrorAt, lastOkAt: s.lastOkAt, callsLastMinute: s.callsAt.length, budgetPerMinute: PUMP_BUDGET_PER_MIN, skippedLastMinute: skipped };
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const s = g();
  if (Date.now() < s.blockedUntil) throw new PumpUnavailable(`pump.fun API in back-off until ${new Date(s.blockedUntil).toISOString()} (${s.lastError ?? "blocked"})`);
  if (!takeBudget()) throw new PumpUnavailable(`pump.fun call budget (${PUMP_BUDGET_PER_MIN}/min) spent: served from cache / chain`);
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
        // rate limited (429 / Cloudflare 1015 / 403): 30 s → 2 min → 5 min; a 5xx: 30 s
        const limited = res.status === 429 || res.status === 403 || /1015|rate.?limit/i.test(text);
        const strike = limited ? Math.min(BACKOFF_LADDER.length - 1, s.strikes ?? 0) : 0;
        if (limited) s.strikes = (s.strikes ?? 0) + 1;
        s.blockedUntil = Date.now() + BACKOFF_LADDER[strike];
        s.lastError = msg;
        s.lastErrorAt = Date.now();
      }
      throw new PumpUnavailable(msg);
    }
    s.lastOkAt = Date.now();
    s.strikes = 0;
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof PumpUnavailable) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    s.lastError = msg;
    s.lastErrorAt = Date.now();
    if (/abort/i.test(msg)) s.blockedUntil = Date.now() + 30_000;
    throw new PumpUnavailable(`pump.fun unreachable: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** cached + deduplicated upstream call; when pump.fun cannot be called (back-off, budget spent, error) the last
 *  value is served as long as it is younger than STALE_MAX */
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const s = g();
  const hit = s.cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  const stale = hit && Date.now() - hit.at < STALE_MAX ? hit.value : undefined;
  // nothing can be sent right now: the stale value, without even trying
  if (stale !== undefined && !pumpCallable()) return Promise.resolve(stale);
  const running = s.inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = load()
    .then((v) => {
      s.cache.set(key, { at: Date.now(), value: v });
      if (s.cache.size > 500) {
        const now = Date.now();
        for (const [k, e] of s.cache) if (now - e.at > STALE_MAX) s.cache.delete(k);
      }
      return v;
    })
    .catch((e: unknown) => {
      if (stale !== undefined && e instanceof PumpUnavailable) return stale;
      throw e;
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
  return cached(`creator:${creator}`, 60_000, async () => {
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
    // slotIndexId = zero-padded slot (12 digits) + transaction index (10 digits): "000453396800" + "0010880000"
    slot: t.slotIndexId && /^\d{12}/.test(t.slotIndexId) ? Number(t.slotIndexId.slice(0, 12)) : 0,
    signature: t.tx,
  };
}

const sortTrades = (a: PumpTrade, b: PumpTrade) => b.blockTime - a.blockTime || b.slot - a.slot;

async function tradesPage(mint: string, cursor: string | null): Promise<{ rows: PumpTrade[]; next: string | null }> {
  const url: string = `${SWAP}/v2/coins/${mint}/trades?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const page: RawTrades = await fetchJson<RawTrades>(url);
  const rows = (Array.isArray(page?.trades) ? page.trades : []).filter((t) => t && typeof t.tx === "string").map(toTrade);
  return { rows, next: page.pagination?.hasMore && page.pagination.nextCursor && rows.length >= 100 ? page.pagination.nextCursor : null };
}

/** newest `limit` trades (≤ 1000), newest first, from the per-mint trade store. ONE upstream page (100 newest) per
 *  refresh, at most every 3 s and within the shared budget, merged into the store; two older pages are fetched once
 *  (when `limit` > 100 and budget is left) to deepen the history the 5m…24h stats read. */
export async function pumpTrades(mint: string, limit = 100): Promise<PumpTrade[]> {
  const want = Math.max(1, Math.min(1000, limit));
  const s = g();
  const stores: Map<string, TradeStore> = (s.trades ??= new Map<string, TradeStore>());
  await cached(`trades:${mint}`, 3000, async () => {
    const { rows: fresh, next } = await tradesPage(mint, null);
    const have = stores.get(mint);
    const known = new Set(have?.trades.map((t) => t.signature));
    // a page that does not overlap the store (> 100 trades since the last refresh) replaces it: no hole in the list
    const overlaps = !have || !have.trades.length || fresh.length < 100 || fresh.some((t) => known.has(t.signature));
    const merged = overlaps ? [...fresh.filter((t) => !known.has(t.signature)), ...(have?.trades ?? [])] : fresh;
    merged.sort(sortTrades);
    stores.set(mint, { trades: merged.slice(0, 1000), at: Date.now(), deep: !next || (overlaps && !!have?.deep), cursor: next });
    if (stores.size > 100) stores.delete(stores.keys().next().value!);
    return true;
  }).catch((e: unknown) => {
    if (!stores.get(mint)?.trades.length) throw e;
  });
  const st = stores.get(mint);
  if (!st) return [];
  if (want > 100 && !st.deep && st.trades.length < want && pumpCallable()) {
    st.deep = true;
    void (async () => {
      const older: PumpTrade[] = [];
      let cursor: string | null = st.cursor;
      // the cursor after the newest page: at most 2 more calls
      for (let i = 0; i < 2 && cursor && pumpCallable(); i++) {
        const page = await tradesPage(mint, cursor);
        older.push(...page.rows);
        cursor = page.next;
      }
      const cur = stores.get(mint);
      if (!cur || !older.length) return;
      const known = new Set(cur.trades.map((t) => t.signature));
      cur.trades = [...cur.trades, ...older.filter((t) => !known.has(t.signature))].sort(sortTrades).slice(0, 1000);
    })().catch(() => {});
  }
  return st.trades.slice(0, want);
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
  return cached(`candles:${mint}:${spec.interval}`, 30_000, async () => {
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
