/* "Search tokens" dialog: matches among launches, drafts, CTOs, recently viewed and the vault's tracked mints (what
 * the vault launched or traded), plus the token itself when q is a full mint (one RPC read). Market cap / age /
 * volume come from the feed's card when it knows the mint, from the launch record or the token read otherwise. */
import type { SearchResponse, SearchResult, SearchSort, TokenInfo } from "@/lib/types";
import { isAddress } from "./api";
import { listCtos } from "./cto";
import { listDrafts } from "./drafts";
import { feedCard } from "./feed";
import { metaCached } from "./metadata";
import { listRecent } from "./recent";
import { store } from "./store";
import { tokenInfo } from "./token";

const RANK: Record<SearchResult["kind"], number> = { mint: 0, launch: 1, cto: 2, draft: 3, recent: 4, position: 5 };

function matches(q: string, fields: Record<string, string | null | undefined>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) if (v && v.toLowerCase().includes(q)) out.push(k);
  return out;
}

function enrich(r: SearchResult): SearchResult {
  if (!r.mint) return r;
  const card = feedCard(r.mint);
  const meta = metaCached(r.mint);
  return {
    ...r,
    name: r.name ?? card?.name ?? meta?.name ?? null,
    symbol: r.symbol ?? card?.symbol ?? meta?.symbol ?? null,
    image: r.image ?? card?.image ?? meta?.image ?? null,
    marketCapSol: r.marketCapSol ?? card?.marketCapSol ?? null,
    marketCapUsd: r.marketCapUsd ?? card?.marketCapUsd ?? null,
    ageSec: r.ageSec ?? (card ? Math.round((Date.now() - card.createdAt) / 1000) : null),
    volumeSol: r.volumeSol ?? card?.volumeSol ?? null,
    progress: r.progress ?? card?.progress ?? null,
  };
}

export async function search(qRaw: string, sort: SearchSort, limit: number): Promise<SearchResponse> {
  const st = store();
  const q = qRaw.trim().toLowerCase();
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const push = (r: SearchResult) => {
    const key = r.mint ?? `${r.kind}:${r.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(enrich(r));
  };
  let info: TokenInfo | null = null;
  if (q) {
    for (const l of st.launches) {
      const m = matches(q, { name: l.name, symbol: l.symbol, mint: l.mint });
      if (m.length) push({ kind: "launch", mint: l.mint, id: null, name: l.name, symbol: l.symbol, image: l.image, marketCapSol: null, marketCapUsd: null, ageSec: Math.round((Date.now() - l.at) / 1000), volumeSol: null, progress: null, href: `/launch?open=${l.mint}`, matched: m });
    }
    for (const c of listCtos()) {
      const m = matches(q, { name: c.name, symbol: c.symbol, mint: c.mint, dev: c.devWallet });
      if (m.length) push({ kind: "cto", mint: c.mint, id: c.id, name: c.name, symbol: c.symbol, image: c.image, marketCapSol: null, marketCapUsd: null, ageSec: null, volumeSol: null, progress: null, href: `/launch?cto=${c.id}`, matched: m });
    }
    for (const d of listDrafts()) {
      const m = matches(q, { name: d.name, symbol: d.symbol, id: d.id, mint: d.launchedMint });
      if (m.length) push({ kind: "draft", mint: d.launchedMint, id: d.id, name: d.name ?? "Untitled", symbol: d.symbol, image: d.image, marketCapSol: null, marketCapUsd: null, ageSec: Math.round((Date.now() - d.createdAt) / 1000), volumeSol: null, progress: null, href: d.launchedMint ? `/launch?open=${d.launchedMint}` : `/launch?draft=${d.id}`, matched: m });
    }
    for (const r of listRecent()) {
      const m = matches(q, { name: r.name, symbol: r.symbol, mint: r.mint });
      if (m.length) push({ kind: "recent", mint: r.mint, id: null, name: r.name, symbol: r.symbol, image: r.image, marketCapSol: null, marketCapUsd: null, ageSec: null, volumeSol: null, progress: null, href: `/trade/${r.mint}`, matched: m });
    }
    for (const mint of st.tracked) {
      const meta = metaCached(mint);
      const card = feedCard(mint);
      const m = matches(q, { name: meta?.name ?? card?.name, symbol: meta?.symbol ?? card?.symbol, mint });
      if (m.length) push({ kind: "position", mint, id: null, name: null, symbol: null, image: null, marketCapSol: null, marketCapUsd: null, ageSec: null, volumeSol: null, progress: null, href: `/trade/${mint}`, matched: m });
    }
    if (isAddress(qRaw.trim())) {
      const mint = qRaw.trim();
      info = await tokenInfo(mint).catch(() => null);
      if (info && (info.curve || info.name)) {
        const r: SearchResult = { kind: "mint", mint, id: null, name: info.name, symbol: info.symbol, image: info.image, marketCapSol: info.curve && !info.curve.complete ? info.curve.marketCapSol : null, marketCapUsd: info.curve && !info.curve.complete ? info.curve.marketCapUsd : null, ageSec: info.createdAt ? Math.round((Date.now() - info.createdAt) / 1000) : null, volumeSol: null, progress: info.curve?.progress ?? null, href: `/trade/${mint}`, matched: ["mint"] };
        // the token read wins over the lighter rows of the same mint
        const i = results.findIndex((x) => x.mint === mint);
        if (i >= 0) results[i] = { ...r, kind: results[i].kind === "launch" ? "launch" : r.kind, href: results[i].kind === "launch" ? results[i].href : r.href };
        else {
          seen.add(mint);
          results.push(r);
        }
      }
    }
  }
  const num = (v: number | null, dir: 1 | -1) => (v === null ? Infinity : dir * v);
  // ascending on the key: mc/volume keys are negated (biggest first), unknown values sort last, then source rank
  results.sort((a, b) => {
    const d = sort === "mc" ? num(a.marketCapUsd ?? a.marketCapSol, -1) - num(b.marketCapUsd ?? b.marketCapSol, -1) : sort === "age" ? num(a.ageSec, 1) - num(b.ageSec, 1) : num(a.volumeSol, -1) - num(b.volumeSol, -1);
    return Number.isNaN(d) || d === 0 ? RANK[a.kind] - RANK[b.kind] : d;
  });
  return { q: qRaw.trim(), sort, results: results.slice(0, limit), tokenInfo: info, at: Date.now() };
}
