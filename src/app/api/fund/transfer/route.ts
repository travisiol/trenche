import { json, lamportsOf, readBody, requireAddress, route } from "@/server/api";
import { sendSol } from "@/server/funds";
import type { FundTransferRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<FundTransferRequest>(req);
  const job = sendSol("transfer", requireAddress(body.from, "from"), requireAddress(body.to, "to"), lamportsOf(body.sol, "sol"), !!(body as { viaRelay?: boolean }).viaRelay);
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
