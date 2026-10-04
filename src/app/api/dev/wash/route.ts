import { PublicKey } from "@solana/web3.js";
import { HttpError, intIn, json, numIn, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { readBalancesChunked, readConn, requireUnlocked, tokenProgramOf } from "@/server/engine";
import { jobNew, jobPush, jobRun } from "@/server/jobs";
import { store } from "@/server/store";
import { resolveWashPairs, washPairs } from "@/server/wash";
import type { WashRequest, WashResponse } from "@/lib/types";
import { TASK_LIMITS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST WashRequest → { jobId, pairs }: each source's tokens move to its wash wallets by SPL transfer in random
 *  slices (Block X wash task outside a launch). The job shows one signature per slice. */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<WashRequest>(req);
  const st = store();
  const mint = requireAddress(body.mint, "mint");
  const cuPrice = intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice, "cuPrice");
  const minD = numIn(body.minDelaySec, 0, TASK_LIMITS.maxWashDelaySec, 0, "minDelaySec");
  const maxD = numIn(body.maxDelaySec, 0, TASK_LIMITS.maxWashDelaySec, 0, "maxDelaySec");
  if (maxD < minD) throw new HttpError(400, "maxDelaySec must be ≥ minDelaySec.");
  let pairs;
  if (body.pairs?.length) pairs = resolveWashPairs({ pairs: body.pairs });
  else {
    // sources = listed wallets, else every vault wallet that holds the token
    let sources = body.wallets?.length ? requireAddresses(body.wallets, "wallets") : st.sol.wallets.map((w) => w.address);
    if (!body.wallets?.length) {
      const conn = readConn();
      const tp = await tokenProgramOf(conn, new PublicKey(mint));
      const bal = await readBalancesChunked(conn, sources, mint, tp);
      sources = bal.filter((b) => b.tokens !== null && b.tokens > BigInt(0)).map((b) => b.owner);
      if (sources.length === 0) throw new HttpError(409, "No vault wallet holds tokens of this mint: nothing to wash.");
    }
    pairs = resolveWashPairs({ sources, perSource: body.perSource ?? 1, autoPairFrom: body.autoPairFrom ?? "fresh" });
  }
  const slices = pairs.reduce((s, p) => s + p.wash.length, 0);
  const job = jobNew("wash", slices, `Wash ${mint.slice(0, 6)}… · ${pairs.length} pair(s), ${slices} slice(s)`);
  job.extra = { mint, pairs };
  jobRun(job, async (j) => {
    const res = await washPairs(mint, pairs, { onStep: (s) => jobPush(j, s.ok, s), cuPrice, minDelayMs: Math.round(minD * 1000), maxDelayMs: Math.round(maxD * 1000), shouldStop: () => j.stop });
    j.extra = { ...(j.extra ?? {}), results: res };
    if (res.length === 0) throw new Error("No source wallet holds tokens of this mint: nothing to wash.");
    if (!res.some((r) => r.ok)) throw new Error(res[0].error ?? "transfer failed");
  });
  const r: WashResponse = { jobId: job.id, pairs };
  return json(r);
});
