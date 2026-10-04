import { json, lamportsOf, numIn, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { sendSol, transferPairs } from "@/server/funds";
import type { FundTransferRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

type Body = Partial<Extract<FundTransferRequest, { from: string }>> & Partial<Extract<FundTransferRequest, { sources: string[] }>>;

/** POST {from, to, sol, viaRelay?} (one transfer) or {sources[], targets[], sol?, viaRelay?, delayMinutes?} (drop zones) → { jobId } */
export const POST = route(async (req: Request) => {
  const body = await readBody<Body>(req);
  let jobId: string;
  if (Array.isArray(body.sources) || Array.isArray(body.targets)) {
    const job = transferPairs(requireAddresses(body.sources, "sources"), requireAddresses(body.targets, "targets"), body.sol !== undefined && body.sol !== "" ? lamportsOf(body.sol, "sol") : null, !!body.viaRelay, Math.round(numIn(body.delayMinutes, 0, 1440, 0, "delayMinutes") * 60_000));
    jobId = job.id;
  } else jobId = sendSol("transfer", requireAddress(body.from, "from"), requireAddress(body.to, "to"), lamportsOf(body.sol, "sol"), !!body.viaRelay).id;
  const res: JobCreated = { jobId };
  return json(res);
});
