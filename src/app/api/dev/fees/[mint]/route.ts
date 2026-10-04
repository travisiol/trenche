import { PublicKey } from "@solana/web3.js";
import { readPumpCreatorFees } from "@/engine/solana/pump/fees.js";
import { json, requireAddress, route, solString } from "@/server/api";
import { fetchCurve, labelOf, readConn } from "@/server/engine";
import { store } from "@/server/store";
import type { CreatorFeesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** creator fees accrue per CREATOR (vault PDA), not per mint: we read the vault of the mint's creator */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  const m = requireAddress(mint, "mint");
  const st = store();
  const conn = readConn();
  const found = await fetchCurve(conn, new PublicKey(m));
  const creator = found?.curve.creator.toBase58() ?? st.launches.find((l) => l.mint === m)?.dev ?? null;
  const res: CreatorFeesResponse = { mint: m, creator, isMine: false, vault: null, claimableSol: null, cashbackSol: null, ammPendingSol: null };
  if (creator) {
    res.isMine = st.sol.wallets.some((w) => w.address === creator);
    const [f] = await readPumpCreatorFees(conn, [{ label: labelOf(creator), address: creator }]);
    if (f) {
      res.vault = f.vault;
      res.claimableSol = solString(f.claimable);
      res.cashbackSol = solString(f.cashback);
      res.ammPendingSol = solString(f.ammPending);
    }
  }
  return json(res);
});
