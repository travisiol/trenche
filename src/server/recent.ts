/* Holdings strip "Recently viewed": server-side list (recent.json), newest first, RECENT_MAX entries, upserted on every
 * trading-page visit; metadata resolved so the chip shows image + symbol. */
import type { RecentToken } from "@/lib/types";
import { RECENT_MAX } from "@/lib/types";
import { readConn } from "./engine";
import { feedCard } from "./feed";
import { metaCached, resolveMeta } from "./metadata";
import { dataPath, readJson, writeJson } from "./store";
import { store } from "./store";

function all(): RecentToken[] {
  const rt = store().runtime;
  if (!rt.recent) rt.recent = readJson<RecentToken[]>(dataPath("recent"), []).filter((r) => r && typeof r.mint === "string");
  return rt.recent as RecentToken[];
}

export function listRecent(): RecentToken[] {
  return [...all()].sort((a, b) => b.at - a.at);
}

export async function addRecent(mint: string): Promise<RecentToken[]> {
  const list = all();
  const card = feedCard(mint);
  const meta = metaCached(mint) ?? (await resolveMeta(mint, card ? { name: card.name, symbol: card.symbol, uri: card.uri } : undefined, readConn()).catch(() => null));
  const have = list.find((r) => r.mint === mint);
  const row: RecentToken = { mint, symbol: meta?.symbol ?? card?.symbol ?? have?.symbol ?? null, name: meta?.name ?? card?.name ?? have?.name ?? null, image: meta?.image ?? card?.image ?? have?.image ?? null, at: Date.now() };
  const next = [row, ...list.filter((r) => r.mint !== mint)].slice(0, RECENT_MAX);
  store().runtime.recent = next;
  writeJson(dataPath("recent"), next);
  return next;
}

export function clearRecent(): void {
  store().runtime.recent = [];
  writeJson(dataPath("recent"), []);
}
