import { json, requireAddress, route } from "@/server/api";
import { refreshCreatorRevenue } from "@/server/creatorRevenue";
import { ledgerMints, ledgerStatus, refreshLedger } from "@/server/ledger";
import type { MintPnl } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET ?mint= → the launch's on-chain breakdown (ledger): trading, costs, creator fees earned, net. The Tasks panel
 *  adds the live value of the tokens still held. Both scans refresh in the background (budgeted, ≥ 10 s apart). */
export const GET = route(async (req: Request) => {
  const mint = requireAddress(new URL(req.url).searchParams.get("mint") ?? "", "mint");
  void refreshLedger({ minIntervalMs: 10_000 }).catch(() => null);
  void refreshCreatorRevenue({ minIntervalMs: 10_000 }).catch(() => null);
  const row: MintPnl | null = ledgerMints().find((m) => m.mint === mint) ?? null;
  return json({ mint, row, ledger: ledgerStatus() });
});
