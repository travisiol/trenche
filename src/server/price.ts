/* SOL/USD price: Jupiter price API v3 (verified responding 2026-10-04), fallback coingecko; 30 s cache. */
import type { SolPriceResponse } from "@/lib/types";
import { store } from "./store";

const WSOL = "So11111111111111111111111111111111111111112";
const TTL = 30_000;

type Cache = { value: SolPriceResponse | null; at: number; inflight: Promise<SolPriceResponse | null> | null };

function cache(): Cache {
  const rt = store().runtime;
  if (!rt.price) rt.price = { value: null, at: 0, inflight: null } satisfies Cache;
  return rt.price as Cache;
}

async function fetchJupiter(): Promise<SolPriceResponse | null> {
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, { usdPrice?: number }>;
  const usd = Number(data?.[WSOL]?.usdPrice);
  return Number.isFinite(usd) && usd > 0 ? { usd, at: Date.now(), source: "jupiter" } : null;
}

async function fetchCoingecko(): Promise<SolPriceResponse | null> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { solana?: { usd?: number } };
  const usd = Number(data?.solana?.usd);
  return Number.isFinite(usd) && usd > 0 ? { usd, at: Date.now(), source: "coingecko" } : null;
}

/** null when both providers fail and nothing is cached */
export async function solPrice(): Promise<SolPriceResponse | null> {
  const c = cache();
  if (c.value && Date.now() - c.at < TTL) return c.value;
  if (c.inflight) return c.inflight;
  c.inflight = (async () => {
    let v: SolPriceResponse | null = null;
    try {
      v = await fetchJupiter();
    } catch {
      v = null;
    }
    if (!v) {
      try {
        v = await fetchCoingecko();
      } catch {
        v = null;
      }
    }
    if (v) {
      c.value = v;
      c.at = Date.now();
    }
    c.inflight = null;
    return c.value;
  })();
  return c.inflight;
}

/** last known price without network (null if never fetched) */
export function solPriceCached(): number | null {
  return cache().value?.usd ?? null;
}
