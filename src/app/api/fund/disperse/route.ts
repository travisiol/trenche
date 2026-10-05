import { HttpError, intIn, json, lamportsOf, numIn, readBody, requireAddress, requireAddresses, route, solString } from "@/server/api";
import { delayRangeOf, disperse, disperseV2, shuffleOf } from "@/server/funds";
import type { FundDisperseLegacyRequest, FundDisperseRequest, FundDisperseResponse, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST FundDisperseRequest (Block X drawer: vault wallet or fresh deposit wallet, total/variation, random delay range
 *  delayMinSec–delayMaxSec or fixed delayMinutes, shuffle) → FundDisperseResponse (the drawn plan in execution order).
 *  The legacy {from, to, minSol, maxSol, minDelay, maxDelay} shape still returns { jobId }. */
export const POST = route(async (req: Request) => {
  const body = await readBody<FundDisperseRequest & FundDisperseLegacyRequest>(req);
  if (body.minSol !== undefined && body.totalSol === undefined && body.amountSol === undefined && body.amounts === undefined) {
    const job = disperse(requireAddress(body.from, "from"), requireAddresses(body.to, "to"), lamportsOf(body.minSol, "minSol"), lamportsOf(body.maxSol ?? body.minSol, "maxSol"), intIn(body.minDelay, 0, 600_000, 0, "minDelay"), intIn(body.maxDelay, 0, 600_000, 0, "maxDelay"), !!body.viaRelay);
    const res: JobCreated = { jobId: job.id };
    return json(res);
  }
  const to = requireAddresses(body.to, "to");
  const amounts = body.amounts ? Object.fromEntries(Object.entries(body.amounts).map(([a, v]) => [requireAddress(a, "amounts key"), lamportsOf(v, `amounts[${a.slice(0, 6)}]`)])) : undefined;
  if (body.createDeposit && body.from) throw new HttpError(400, "Give either `from` or `createDeposit: true`, not both.");
  const r = disperseV2({
    from: body.from ? requireAddress(body.from, "from") : undefined,
    createDeposit: !!body.createDeposit,
    to,
    totalLam: body.totalSol !== undefined && body.totalSol !== "" ? lamportsOf(body.totalSol, "totalSol") : undefined,
    amountLam: body.amountSol !== undefined && body.amountSol !== "" ? lamportsOf(body.amountSol, "amountSol") : undefined,
    amounts,
    variationPct: numIn(body.variationPct, 0, 100, 0, "variationPct"),
    delay: delayRangeOf(body),
    shuffle: shuffleOf(body.shuffle),
    waitMs: Math.round(numIn(body.waitMinutes, 0, 1440, body.createDeposit ? 120 : 0, "waitMinutes") * 60_000),
    viaRelay: !!body.viaRelay,
    presetName: body.presetName ? String(body.presetName).slice(0, 48) : undefined,
  });
  const res: FundDisperseResponse = { jobId: r.job.id, from: r.from, plan: r.plan.map((p) => ({ address: p.address, label: p.label, sol: solString(p.lamports), delayMs: p.delayMs })), needSol: solString(r.needLam), totalSol: solString(r.totalLam), etaMs: r.etaMs };
  return json(res);
});
