import { intIn, json, lamportsOf, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { disperse } from "@/server/funds";
import type { FundDisperseRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<FundDisperseRequest>(req);
  const job = disperse(
    requireAddress(body.from, "from"),
    requireAddresses(body.to, "to"),
    lamportsOf(body.minSol, "minSol"),
    lamportsOf(body.maxSol ?? body.minSol, "maxSol"),
    intIn(body.minDelay, 0, 600_000, 0, "minDelay"),
    intIn(body.maxDelay, 0, 600_000, 0, "maxDelay"),
  );
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
