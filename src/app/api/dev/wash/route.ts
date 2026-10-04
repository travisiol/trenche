import { intIn, json, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { requireUnlocked } from "@/server/engine";
import { jobNew, jobPush, jobRun } from "@/server/jobs";
import { store } from "@/server/store";
import { washTokens } from "@/server/wash";
import type { JobCreated, WashRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST {mint, wallets?, cuPrice?} → { jobId }: move every token of the listed wallets (default: all vault wallets)
 *  to FRESH vault wallets by SPL transfer (Block X "wash" outside a launch). The job shows one signature per wallet. */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<WashRequest>(req);
  const st = store();
  const mint = requireAddress(body.mint, "mint");
  const wallets = body.wallets?.length ? requireAddresses(body.wallets, "wallets") : st.sol.wallets.map((w) => w.address);
  const cuPrice = intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice, "cuPrice");
  const job = jobNew("wash", wallets.length, `Wash ${mint.slice(0, 6)}… · ${wallets.length} wallet(s)`);
  job.extra = { mint, wallets };
  jobRun(job, async (j) => {
    const res = await washTokens(mint, wallets, (s) => jobPush(j, s.ok, s), cuPrice);
    j.total = res.length;
    j.extra = { ...(j.extra ?? {}), results: res };
    if (res.length === 0) throw new Error("No wallet holds tokens of this mint: nothing to wash.");
    if (!res.some((r) => r.ok)) throw new Error(res[0].error ?? "transfer failed");
  });
  const r: JobCreated = { jobId: job.id };
  return json(r);
});
