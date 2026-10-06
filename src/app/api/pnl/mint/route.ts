import { json, requireAddress, route } from "@/server/api";
import { knownTradeSigs } from "@/engine/solana/pump/positions.js";
import { creatorFeesThrough, refreshCreatorRevenue } from "@/server/creatorRevenue";
import { ledgerMints, ledgerMissing, ledgerReadNow, ledgerStatus, refreshLedger } from "@/server/ledger";
import { liveTrades } from "@/server/livefeed";
import { store } from "@/server/store";
import { ownedAddresses } from "@/server/wallets";
import type { MintPnl } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET ?mint= → the launch's on-chain breakdown (ledger): trading, costs, creator fees earned, net. The Tasks panel
 *  adds the live value of the tokens still held. Both scans refresh in the background (budgeted, ≥ 10 s apart).
 *  `covered`: the ledger holds every transaction of this mint we know of (the launch's create, our trades counted by
 *  the positions read or seen by the live feed) — until then its row is incomplete and the badge keeps its live
 *  estimate; the missing ones are read at once, ahead of the scan queue.
 *  `feesThrough`: block time (ms) of the newest creator fee counted — the live feed adds the fees of later trades. */
export const GET = route(async (req: Request) => {
  const mint = requireAddress(new URL(req.url).searchParams.get("mint") ?? "", "mint");
  void refreshLedger({ minIntervalMs: 10_000 }).catch(() => null);
  void refreshCreatorRevenue({ minIntervalMs: 10_000 }).catch(() => null);
  const owned = new Set(ownedAddresses());
  const launch = store().launches.find((l) => l.mint === mint);
  const known = [...(launch?.createSignature && !launch.createError ? [launch.createSignature] : []), ...knownTradeSigs(mint, owned), ...liveTrades(mint).filter((t) => owned.has(t.wallet)).map((t) => t.signature)];
  if (ledgerMissing(known).length) await Promise.race([ledgerReadNow(known).catch(() => null), new Promise((r) => setTimeout(r, 2500))]);
  const row: MintPnl | null = ledgerMints().find((m) => m.mint === mint) ?? null;
  return json({ mint, row, ledger: ledgerStatus(), covered: ledgerMissing(known).length === 0, feesThrough: creatorFeesThrough(mint) });
});
