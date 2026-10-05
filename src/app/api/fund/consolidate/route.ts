import { HttpError, json, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { groupWallets } from "@/server/engine";
import { consolidate, delayRangeOf, shuffleOf } from "@/server/funds";
import type { FundConsolidateRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST {from[] | sources[] | groupId, to | targets: [to], viaRelay?, delayMinutes? | delayMinSec?+delayMaxSec?, shuffle?} → { jobId } — Consolidate / Reverse Disperse */
export const POST = route(async (req: Request) => {
  const body = await readBody<FundConsolidateRequest>(req);
  const to = requireAddress(body.to ?? body.targets?.[0], "to");
  if (body.targets && body.targets.length > 1) throw new HttpError(400, "Consolidate takes exactly one target wallet (use Transfer for pairs).");
  let from: string[];
  if (body.groupId) {
    from = groupWallets(String(body.groupId));
    if (from.length === 0) throw new HttpError(400, "The group has no active wallet.");
  } else from = requireAddresses(body.from ?? body.sources, "sources");
  const job = consolidate(from, to, body.viaRelay === true, delayRangeOf(body), body.kind === "reverse" ? "Reverse Disperse" : "Consolidate", shuffleOf(body.shuffle));
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
