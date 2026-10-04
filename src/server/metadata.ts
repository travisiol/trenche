/* Token metadata (name/symbol/image/description/links) resolved from the mint's `uri` with a timeout and a cache. */
import { PublicKey, type Connection } from "@solana/web3.js";
import { ipfsToHttp, parseMintMetadata } from "@/engine/solana/pump/metadata.js";
import { store } from "./store";

export type TokenMeta = {
  mint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  image: string | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  /** base58 owner program of the mint account, null when not read */
  tokenProgram: string | null;
  resolvedAt: number;
  /** true when the uri JSON was fetched (even if it had no image) */
  fetched: boolean;
};

type Cache = { map: Map<string, TokenMeta>; inflight: Map<string, Promise<TokenMeta>> };
function cache(): Cache {
  const rt = store().runtime;
  if (!rt.meta) rt.meta = { map: new Map(), inflight: new Map() } satisfies Cache;
  return rt.meta as Cache;
}

export const IMAGE_CDN = (mint: string) => `https://axiomtrading-v2.axiom-cdn.io/${mint}.webp`;

const GATEWAYS = ["https://ipfs.io/ipfs/", "https://pump.mypinata.cloud/ipfs/", "https://cloudflare-ipfs.com/ipfs/"];

/** fetch the uri JSON; tries other IPFS gateways when the first one fails */
export async function fetchUriJson(uri: string, timeoutMs = 7000): Promise<Record<string, unknown> | null> {
  const http = ipfsToHttp(uri);
  const m = http.match(/\/ipfs\/([A-Za-z0-9._-]+)\/?$/);
  const candidates = m ? [http, ...GATEWAYS.map((g) => g + m[1]).filter((u) => u !== http)] : [http];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const j = (await res.json()) as Record<string, unknown>;
      if (j && typeof j === "object") return j;
    } catch {
      /* next gateway */
    }
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** resolve metadata; `hint` carries what the feed already knows (name/symbol/uri) so no RPC call is needed */
export function resolveMeta(
  mint: string,
  hint?: { name?: string | null; symbol?: string | null; uri?: string | null },
  conn?: Connection,
): Promise<TokenMeta> {
  const c = cache();
  const have = c.map.get(mint);
  if (have && (have.fetched || Date.now() - have.resolvedAt < 60_000)) return Promise.resolve(have);
  const inflight = c.inflight.get(mint);
  if (inflight) return inflight;
  const p = (async (): Promise<TokenMeta> => {
    let name = hint?.name ?? null,
      symbol = hint?.symbol ?? null,
      uri = hint?.uri ?? null,
      tokenProgram: string | null = null;
    if ((!uri || !name) && conn) {
      try {
        const info = await conn.getAccountInfo(new PublicKey(mint), "confirmed");
        if (info) {
          tokenProgram = info.owner.toBase58();
          const parsed = parseMintMetadata(info.data);
          if (parsed) {
            name = name ?? parsed.name;
            symbol = symbol ?? parsed.symbol;
            uri = uri ?? parsed.uri;
          }
        }
      } catch {
        /* RPC down: keep what we have */
      }
    }
    const meta: TokenMeta = { mint, name, symbol, uri, image: null, description: null, twitter: null, telegram: null, website: null, tokenProgram, resolvedAt: Date.now(), fetched: false };
    if (uri) {
      const j = await fetchUriJson(uri);
      if (j) {
        meta.fetched = true;
        meta.name = meta.name ?? str(j.name);
        meta.symbol = meta.symbol ?? str(j.symbol);
        meta.image = str(j.image) ? ipfsToHttp(str(j.image)!) : null;
        meta.description = str(j.description);
        meta.twitter = str(j.twitter);
        meta.telegram = str(j.telegram);
        meta.website = str(j.website);
      }
    }
    c.map.set(mint, meta);
    if (c.map.size > 3000) {
      const oldest = [...c.map.entries()].sort((a, b) => a[1].resolvedAt - b[1].resolvedAt).slice(0, 500);
      for (const [k] of oldest) c.map.delete(k);
    }
    c.inflight.delete(mint);
    return meta;
  })();
  c.inflight.set(mint, p);
  return p;
}

export function metaCached(mint: string): TokenMeta | null {
  return cache().map.get(mint) ?? null;
}
