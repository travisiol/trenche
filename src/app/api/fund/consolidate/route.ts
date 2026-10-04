import { json, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { consolidate } from "@/server/funds";
import type { FundConsolidateRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<FundConsolidateRequest>(req);
  const job = consolidate(requireAddresses(body.from, "from"), requireAddress(body.to, "to"), body.viaRelay === true);
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
