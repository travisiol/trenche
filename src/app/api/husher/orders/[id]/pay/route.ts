import { json, readBody, requireAddress, route } from "@/server/api";
import { sendSol } from "@/server/funds";
import { jobGet } from "@/server/jobs";
import { husherPay } from "@/server/husher";
export const dynamic = "force-dynamic";
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const body = await readBody<{ from?: unknown }>(req);
  const from = requireAddress(body.from, "from");
  return json(await husherPay((await ctx.params).id, from, (f, to, lam) => sendSol("withdraw", f, to, lam), (jobId) => jobGet(jobId)?.status === "error"));
});
