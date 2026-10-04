import { HttpError, json, route } from "@/server/api";
import { jobGet, jobView } from "@/server/jobs";
import { saveJobsSoon } from "@/server/store";
import type { JobStopResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** cooperative stop: waiting jobs (deposit wait, delays between wallets, wash slices) end at their next check;
 *  a transaction already in flight is never cancelled */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const job = jobGet(id);
  if (!job) throw new HttpError(404, "Unknown job.");
  if (job.status !== "running") throw new HttpError(409, `Job already ${job.status}.`);
  job.stop = true;
  job.steps.push({ ok: true, at: Date.now(), note: "Stop requested — the job ends at its next check; nothing already sent is cancelled." });
  saveJobsSoon();
  const res: JobStopResponse = jobView(job);
  return json(res);
});
