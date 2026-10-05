import { HttpError, json, lamportsOf, numIn, readBody, requireAddress, requireAddresses, route, solString } from "@/server/api";
import { delayRangeOf, partsOf, privateSend, sendSol, shuffleOf, transferPairs } from "@/server/funds";
import type { FundPrivateSendResponse, FundTransferRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

type Body = Partial<Extract<FundTransferRequest, { from: string }>> & Partial<Extract<FundTransferRequest, { sources: string[] }>>;

/** POST {from, to, sol, viaRelay?} (one transfer) → { jobId }
 *  POST {from, to (vault wallet or any address), sol | max: true, viaRelay?, parts? 1–5, variationPct?, delayMinSec?, delayMaxSec?}
 *       (Private send: split into random parts, each after a random delay, each through its own relay) → FundPrivateSendResponse
 *  POST {sources[], targets[], sol?, viaRelay?, delayMinutes? | delayMinSec?+delayMaxSec?, shuffle?} (drop zones) → { jobId } */
export const POST = route(async (req: Request) => {
  const body = await readBody<Body>(req);
  if (Array.isArray(body.sources) || Array.isArray(body.targets)) {
    const job = transferPairs(requireAddresses(body.sources, "sources"), requireAddresses(body.targets, "targets"), body.sol !== undefined && body.sol !== "" ? lamportsOf(body.sol, "sol") : null, !!body.viaRelay, delayRangeOf(body), shuffleOf(body.shuffle));
    const res: JobCreated = { jobId: job.id };
    return json(res);
  }
  const from = requireAddress(body.from, "from");
  const to = requireAddress(body.to, "to");
  const isPrivate = body.max !== undefined || body.parts !== undefined || body.partsSol !== undefined || body.delayMinSec !== undefined || body.delayMaxSec !== undefined || body.variationPct !== undefined;
  if (!isPrivate) {
    const res: JobCreated = { jobId: sendSol("transfer", from, to, lamportsOf(body.sol, "sol"), !!body.viaRelay).id };
    return json(res);
  }
  const max = body.max === true;
  if (body.partsSol !== undefined && (!Array.isArray(body.partsSol) || max)) throw new HttpError(400, "partsSol: an array of SOL amounts (not with max).");
  const amounts = body.partsSol?.map((v, i) => lamportsOf(v, `partsSol[${i}]`));
  const r = privateSend({
    from,
    to,
    lamports: max || amounts ? null : lamportsOf(body.sol, "sol"),
    amounts,
    parts: amounts ? partsOf(amounts.length) : partsOf(body.parts),
    variationPct: numIn(body.variationPct, 0, 100, 40, "variationPct"),
    delay: delayRangeOf(body),
    viaRelay: !!body.viaRelay,
  });
  const res: FundPrivateSendResponse = {
    jobId: r.job.id,
    plan: r.plan ? r.plan.map((p) => ({ address: p.address, label: p.label, sol: solString(p.lamports), delayMs: p.delayMs })) : null,
    totalSol: r.totalLam === null ? null : solString(r.totalLam),
    needSol: r.needLam === null ? null : solString(r.needLam),
    etaMs: r.etaMs,
  };
  return json(res);
});
