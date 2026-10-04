/* One global RPC queue in front of every @solana/web3.js Connection the server opens.
 *
 * Why: the free public RPC (publicnode) answers 429 as soon as a launch page polls the curve, the balances, the
 * trade history and a sendMany confirms 10 signatures at once. web3.js then throws "429 Too Many Requests" into
 * every caller, confirmations time out, and the UI shows raw 429 toasts although the transactions landed.
 *
 * What this module does (it is plugged in as the `fetch` of every Connection, see `queuedConnection`):
 *  - a per-host concurrency limiter: 2 requests in flight on a public RPC, 8 on a private one (Helius, QuickNode…),
 *    with a short cool-down of the whole queue after a 429;
 *  - per-request retry with exponential backoff + jitter on HTTP 429/502/503/504, JSON-RPC -32005 ("rate limit"),
 *    ECONNRESET / fetch failed;
 *  - a micro-cache (1–3 s) + in-flight dedup for identical reads (account infos, balances, curve reads, token info,
 *    block height) so N pollers of the same mint cost one upstream call;
 *  - counters for GET /api/rpc/health: latency, 429s in the last minute, queue depth, provider kind.
 * Writes (sendTransaction, simulateTransaction) and confirmation reads (getSignatureStatuses, getLatestBlockhash)
 * are never cached. State lives on globalThis so it survives Turbopack HMR. */
import { Connection, type FetchFn } from "@solana/web3.js";

export type RpcProvider = "public" | "private";

export type RpcHealth = {
  provider: RpcProvider;
  /** read RPC with any api-key masked */
  url: string;
  /** median round-trip of the last 20 upstream calls (ms), null before the first call */
  latencyMs: number | null;
  /** HTTP 429 / -32005 answers in the last 60 s (after our retries each counts once per upstream answer) */
  rateLimited: number;
  requestsLastMinute: number;
  cacheHitsLastMinute: number;
  inflight: number;
  queued: number;
  lastError: string | null;
  lastErrorAt: number | null;
  at: number;
};

type CacheEntry = { at: number; ttl: number; body: Record<string, unknown> };

type HostState = {
  max: number;
  active: number;
  waiters: (() => void)[];
  pausedUntil: number;
};

type Stats = {
  /** round-trips of the health probe (getSlot through the queue), last 10 */
  probes: number[];
  latencies: number[];
  rateLimitedAt: number[];
  requestsAt: number[];
  cacheHitsAt: number[];
  lastError: string | null;
  lastErrorAt: number | null;
};

type RpcGlobal = {
  hosts: Map<string, HostState>;
  cache: Map<string, CacheEntry>;
  inflight: Map<string, Promise<{ status: number; statusText: string; text: string }>>;
  connections: Map<string, Connection>;
  stats: Stats;
  lastReadUrl: string;
};

declare global {
  var __trenchRpc: RpcGlobal | undefined;
}

function g(): RpcGlobal {
  if (!globalThis.__trenchRpc) {
    globalThis.__trenchRpc = {
      hosts: new Map(),
      cache: new Map(),
      inflight: new Map(),
      connections: new Map(),
      stats: { probes: [], latencies: [], rateLimitedAt: [], requestsAt: [], cacheHitsAt: [], lastError: null, lastErrorAt: null },
      lastReadUrl: "",
    };
  }
  return globalThis.__trenchRpc;
}

/** publicnode and the Solana Foundation endpoints: shared, unauthenticated, rate-limited per IP */
export function isPublicRpcUrl(url: string): boolean {
  return /publicnode\.com|api\.(mainnet-beta|devnet|testnet)\.solana\.com/i.test(url) || !/api[-_]?key=|\/[0-9a-f]{32,}|helius|quicknode|alchemy|triton|rpcpool|shyft|ankr|chainstack|getblock/i.test(url);
}

export const PUBLIC_CONCURRENCY = 2;
export const PRIVATE_CONCURRENCY = 8;

export function maskRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/key|token|secret/i.test(k)) u.searchParams.set(k, "•••");
    // path-embedded keys (QuickNode / Alchemy style)
    u.pathname = u.pathname.replace(/[0-9a-zA-Z_-]{24,}/g, "•••");
    return u.toString();
  } catch {
    return url;
  }
}

/** method → cache TTL in ms. Anything missing is never cached. */
const CACHE_TTL: Record<string, number> = {
  getAccountInfo: 2000,
  getMultipleAccounts: 2000,
  getBalance: 2000,
  getTokenAccountBalance: 2000,
  getTokenAccountsByOwner: 3000,
  getTokenLargestAccounts: 3000,
  getTokenSupply: 3000,
  getProgramAccounts: 3000,
  getSignaturesForAddress: 2000,
  getTransaction: 60_000,
  getBlockHeight: 1000,
  // getSlot is NOT cached: it is the health probe (one call per GET /api/rpc/health)
  getEpochInfo: 5000,
  getRecentPrioritizationFees: 5000,
  getMinimumBalanceForRentExemption: 300_000,
  getAddressLookupTable: 10_000,
};
/** a null result (account / tx not found yet) is only kept this long: it may appear a slot later */
const NULL_TTL = 700;

const RETRY_STATUS = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function hostState(url: string): HostState {
  const s = g();
  const host = hostOf(url);
  let h = s.hosts.get(host);
  const max = isPublicRpcUrl(url) ? PUBLIC_CONCURRENCY : PRIVATE_CONCURRENCY;
  if (!h) {
    h = { max, active: 0, waiters: [], pausedUntil: 0 };
    s.hosts.set(host, h);
  } else h.max = max;
  return h;
}

async function acquire(h: HostState): Promise<() => void> {
  while (h.active >= h.max || Date.now() < h.pausedUntil) {
    if (h.active >= h.max) await new Promise<void>((r) => h.waiters.push(r));
    else await sleep(h.pausedUntil - Date.now());
  }
  h.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    h.active--;
    h.waiters.shift()?.();
  };
}

function prune(arr: number[], now: number, windowMs = 60_000): void {
  while (arr.length && arr[0] < now - windowMs) arr.shift();
}

function record(kind: "req" | "429" | "hit", latency?: number): void {
  const st = g().stats;
  const now = Date.now();
  if (kind === "req") {
    st.requestsAt.push(now);
    if (latency !== undefined) {
      st.latencies.push(latency);
      if (st.latencies.length > 20) st.latencies.shift();
    }
  } else if (kind === "429") st.rateLimitedAt.push(now);
  else st.cacheHitsAt.push(now);
  prune(st.requestsAt, now);
  prune(st.rateLimitedAt, now);
  prune(st.cacheHitsAt, now);
}

function noteError(msg: string): void {
  const st = g().stats;
  st.lastError = msg.slice(0, 200);
  st.lastErrorAt = Date.now();
}

type RpcBody = { method?: string; params?: unknown; id?: unknown; jsonrpc?: string };

function parseBody(init?: RequestInit): RpcBody | RpcBody[] | null {
  if (!init || typeof init.body !== "string") return null;
  try {
    return JSON.parse(init.body) as RpcBody | RpcBody[];
  } catch {
    return null;
  }
}

function cacheKey(url: string, b: RpcBody): string {
  return `${hostOf(url)}|${b.method}|${JSON.stringify(b.params ?? null)}`;
}

function isRateLimitBody(json: Record<string, unknown> | null): boolean {
  const err = json?.error as { code?: number; message?: string } | undefined;
  if (!err) return false;
  return err.code === -32005 || /rate ?limit|too many requests/i.test(err.message ?? "");
}

/** the fetch given to every Connection: queue → retry → cache. Signature-compatible with globalThis.fetch. */
export async function queuedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const s = g();
  const body = parseBody(init);
  const single = body && !Array.isArray(body) ? body : null;
  const ttl = single?.method ? (CACHE_TTL[single.method] ?? 0) : 0;
  const key = single && ttl > 0 ? cacheKey(url, single) : null;
  const respond = (status: number, statusText: string, text: string) => new Response(text, { status, statusText, headers: { "content-type": "application/json" } });
  const withId = (b: Record<string, unknown>) => JSON.stringify({ ...b, id: single?.id ?? b.id });

  if (key) {
    const hit = s.cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) {
      record("hit");
      return respond(200, "OK", withId(hit.body));
    }
    const running = s.inflight.get(key);
    if (running) {
      record("hit");
      const r = await running;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(r.text) as Record<string, unknown>;
      } catch {
        /* non-JSON upstream answer */
      }
      return respond(r.status, r.statusText, parsed ? withId(parsed) : r.text);
    }
  }

  const run = async (): Promise<{ status: number; statusText: string; text: string }> => {
    const h = hostState(url);
    let last: { status: number; statusText: string; text: string } = { status: 599, statusText: "no answer", text: "" };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const release = await acquire(h);
      const t0 = Date.now();
      let rateLimited = false;
      let transient = false;
      try {
        const res = await fetch(url, init);
        const text = await res.text();
        record("req", Date.now() - t0);
        last = { status: res.status, statusText: res.statusText, text };
        if (RETRY_STATUS.has(res.status)) {
          rateLimited = res.status === 429;
          transient = true;
        } else if (res.ok) {
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            json = null;
          }
          if (json && !Array.isArray(json) && isRateLimitBody(json)) {
            rateLimited = true;
            transient = true;
          } else {
            if (key && json && !Array.isArray(json) && !("error" in json)) {
              const nullResult = json.result === null || (json.result as { value?: unknown } | null)?.value === null;
              s.cache.set(key, { at: Date.now(), ttl: nullResult ? Math.min(ttl, NULL_TTL) : ttl, body: json });
              if (s.cache.size > 2000) {
                const now = Date.now();
                for (const [k, v] of s.cache) if (now - v.at > v.ttl) s.cache.delete(k);
              }
            }
            return last;
          }
        } else {
          noteError(`${res.status} ${res.statusText}: ${text.slice(0, 120)}`);
          return last;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        record("req", Date.now() - t0);
        noteError(msg);
        last = { status: 599, statusText: "network error", text: JSON.stringify({ jsonrpc: "2.0", id: single?.id ?? null, error: { code: -32000, message: `RPC unreachable: ${msg}` } }) };
        transient = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|UND_ERR|network/i.test(msg);
        if (!transient) {
          release();
          return last;
        }
      } finally {
        release();
      }
      if (rateLimited) {
        record("429");
        noteError(`429 rate limited by ${hostOf(url)}`);
        // cool the whole queue down, not just this request
        h.pausedUntil = Math.max(h.pausedUntil, Date.now() + Math.min(4000, 400 * 2 ** attempt));
      }
      if (!transient || attempt === MAX_ATTEMPTS - 1) return last;
      await sleep(Math.min(6000, 350 * 2 ** attempt) + Math.random() * 250);
    }
    return last;
  };

  const p = run();
  if (key) {
    s.inflight.set(key, p);
    p.finally(() => s.inflight.delete(key)).catch(() => {});
  }
  const r = await p;
  if (r.status === 599) {
    // web3.js only looks at `ok`/status/text: a JSON-RPC error body makes it throw a readable message
    return respond(503, "Service Unavailable", r.text);
  }
  return respond(r.status, r.statusText, r.text);
}

/** one Connection per URL, with the queued fetch (replaces engine/rpc.js makeConnection for the server) */
export function queuedConnection(url: string): Connection {
  const s = g();
  const key = url.trim();
  let c = s.connections.get(key);
  if (!c) {
    c = new Connection(key, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: queuedFetch as unknown as FetchFn });
    s.connections.set(key, c);
  }
  return c;
}

/** remember which URL is the read RPC (for the health pill) */
export function noteReadRpc(url: string): void {
  g().lastReadUrl = url;
}

/** one lightweight getSlot through the queue, timed; keeps the last 10 (p50 = the pill's latency) */
export async function probeRpc(url: string): Promise<number | null> {
  const s = g();
  if (!Array.isArray(s.stats.probes)) s.stats.probes = [];
  const t0 = Date.now();
  try {
    await queuedConnection(url).getSlot({ commitment: "processed" });
  } catch {
    return null;
  }
  const ms = Date.now() - t0;
  s.stats.probes.push(ms);
  if (s.stats.probes.length > 10) s.stats.probes.shift();
  return ms;
}

export function rpcHealth(): RpcHealth {
  const s = g();
  const st = s.stats;
  const now = Date.now();
  prune(st.requestsAt, now);
  prune(st.rateLimitedAt, now);
  prune(st.cacheHitsAt, now);
  const probes = Array.isArray(st.probes) ? st.probes : [];
  const sorted = [...(probes.length ? probes : st.latencies.slice(-10))].sort((a, b) => a - b);
  const url = s.lastReadUrl;
  let inflight = 0;
  let queued = 0;
  for (const h of s.hosts.values()) {
    inflight += h.active;
    queued += h.waiters.length;
  }
  return {
    provider: url && !isPublicRpcUrl(url) ? "private" : "public",
    url: url ? maskRpcUrl(url) : "",
    latencyMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    rateLimited: st.rateLimitedAt.length,
    requestsLastMinute: st.requestsAt.length,
    cacheHitsLastMinute: st.cacheHitsAt.length,
    inflight,
    queued,
    lastError: st.lastError,
    lastErrorAt: st.lastErrorAt,
    at: now,
  };
}

/** drop cached reads of one account (after a send we know the balance changed) */
export function invalidateRpcCache(predicate?: (key: string) => boolean): void {
  const s = g();
  if (!predicate) return s.cache.clear();
  for (const k of [...s.cache.keys()]) if (predicate(k)) s.cache.delete(k);
}
