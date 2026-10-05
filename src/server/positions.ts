/* Positions of vault wallets on a set of mints, via the engine's readPositions (curve + balances + trade history). */
import { PublicKey } from "@solana/web3.js";
import { readPositions } from "@/engine/solana/pump/positions.js";
import type { PositionRow } from "@/lib/types";
import { solString } from "./api";
import { isPublicRpc, labelOf, readConn } from "./engine";
import { metaCached, resolveMeta } from "./metadata";
import { ownedAddresses, trashedLabel } from "./wallets";

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

function walletLabel(a: string): string {
  const l = labelOf(a);
  return l === a.slice(0, 6) ? (trashedLabel(a) ?? l) : l;
}

export async function positions(wallets: string[], mints: string[]): Promise<PositionRow[]> {
  if (wallets.length === 0 || mints.length === 0) return [];
  // read-only: our wallets, trashed ones and launch wallets included (a dev deleted after launch keeps its position);
  // an address that is not ours is skipped instead of failing every other wallet's row
  const owned = new Set(ownedAddresses());
  const ws = wallets.filter((a) => owned.has(a)).map((a) => ({ label: walletLabel(a), owner: new PublicKey(a) }));
  if (ws.length === 0) return [];
  const conn = readConn();
  const per = isPublicRpc() ? 5 : 50;
  const rows = await mapLimit(mints.slice(0, 40), 2, async (mint): Promise<PositionRow[]> => {
    let r: Awaited<ReturnType<typeof readPositions>>;
    try {
      const parts: Awaited<ReturnType<typeof readPositions>>[] = [];
      for (let i = 0; i < ws.length; i += per) parts.push(await readPositions(conn, new PublicKey(mint), ws.slice(i, i + per), { maxSignatures: 300 }));
      r = parts[0];
      for (const x of parts.slice(1)) r.positions.push(...x.positions);
    } catch {
      return [];
    }
    const meta = metaCached(mint) ?? (await resolveMeta(mint, { name: r.name, symbol: r.symbol }, conn).catch(() => null));
    const vTok = r.reserves ? Number(r.reserves.virtualTokenReserves) / 1e6 : 0;
    const vSol = r.reserves ? Number(r.reserves.virtualSolReserves) / 1e9 : 0;
    return r.positions
      .filter((p) => p.tokens > BigInt(0) || p.spent > BigInt(0) || p.realised > BigInt(0))
      .map((p) => ({
        wallet: p.owner,
        label: walletLabel(p.owner),
        mint,
        symbol: r.symbol ?? meta?.symbol ?? null,
        name: r.name ?? meta?.name ?? null,
        image: meta?.image ?? null,
        amount: (Number(p.tokens) / 1e6).toString(),
        valueSol: solString(p.value),
        costSol: solString(p.spent),
        realisedSol: solString(p.realised),
        pnlSol: solString(p.pnl),
        supplyPct: p.supplyPct,
        isDev: p.isDev,
        onCurve: r.onCurve,
        progress: r.reserves ? r.graduationPct : null,
        marketCapSol: r.reserves && vTok > 0 ? (vSol / vTok) * 1e9 : null,
      }));
  });
  return rows.flat();
}
