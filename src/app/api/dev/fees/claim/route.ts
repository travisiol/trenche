import { HttpError, intIn, json, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { creatorOf, runClaimJob } from "@/server/fees";
import { requireUnlocked } from "@/server/engine";
import { store } from "@/server/store";
import { syncPumpCluster } from "@/server/pumpcluster";
import type { FeesClaimRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST {mint, wallet?} | {wallets} → { jobId }. Claims the creator vault(s) to the creator wallet(s) (pump.fun pays the
 *  vault out to the creator account; the payer — the creator itself when it can pay, else the richest vault wallet —
 *  only signs). The job always exists, even when the claim fails (RPC, nothing to claim, no payer): read its `error`.
 *  job.extra = { totalSol, signatures, claimed, confirmed, payer, pendingAfterSol } once done. See src/server/fees.ts. */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  await syncPumpCluster().catch(() => null);
  const body = await readBody<FeesClaimRequest>(req);
  const st = store();
  const mint = body.mint ? requireAddress(body.mint, "mint") : undefined;
  let owners: string[];
  if (body.wallets?.length) owners = requireAddresses(body.wallets, "wallets");
  else if (body.wallet) owners = [requireAddress(body.wallet, "wallet")];
  else if (mint) {
    const creator = await creatorOf(mint);
    if (!creator) throw new HttpError(404, "Creator unknown for this mint (bonding curve unreadable and not launched here).");
    owners = [creator];
  } else owners = st.sol.wallets.map((w) => w.address);
  const mine = owners.filter((o) => st.sol.wallets.some((w) => w.address === o));
  if (mine.length === 0) throw new HttpError(400, `Creator ${owners[0]?.slice(0, 6) ?? "?"}… is not a vault wallet: the fees would go to it, not to you — nothing to claim from here.`);
  const cuPrice = intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice);
  const { job } = runClaimJob(mine, { mint, cuPrice, kind: "fees", preferPayer: mine.length === 1 ? mine[0] : undefined });
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
