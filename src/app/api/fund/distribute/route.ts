import { HttpError, json, lamportsOf, numIn, readBody, requireAddresses, route, solString } from "@/server/api";
import { delayRangeOf, distribute, shuffleOf } from "@/server/funds";
import type { FundDisperseResponse, FundDistributeRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST {sources: [one], targets[], totalSol?, variationPct?, delayMinutes? | delayMinSec?+delayMaxSec?, shuffle?, viaRelay?} → FundDisperseResponse */
export const POST = route(async (req: Request) => {
  const body = await readBody<FundDistributeRequest>(req);
  const sources = requireAddresses(body.sources, "sources");
  if (sources.length !== 1) throw new HttpError(400, "Distribute takes exactly one source wallet (use Disperse for several).");
  const r = await distribute({
    source: sources[0],
    targets: requireAddresses(body.targets, "targets"),
    totalLam: body.totalSol !== undefined && body.totalSol !== "" ? lamportsOf(body.totalSol, "totalSol") : undefined,
    variationPct: numIn(body.variationPct, 0, 100, 0, "variationPct"),
    delay: delayRangeOf(body),
    shuffle: shuffleOf(body.shuffle),
    viaRelay: !!body.viaRelay,
  });
  const res: FundDisperseResponse = { jobId: r.job.id, from: r.from, plan: r.plan.map((p) => ({ address: p.address, label: p.label, sol: solString(p.lamports), delayMs: p.delayMs })), needSol: solString(r.needLam), totalSol: solString(r.totalLam), etaMs: r.etaMs };
  return json(res);
});
