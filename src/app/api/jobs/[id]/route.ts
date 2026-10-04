import { HttpError, json, route } from "@/server/api";
import { jobGet, jobView } from "@/server/jobs";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const job = jobGet(id);
  if (!job) throw new HttpError(404, "Unknown job (the last 200 jobs are kept in jobs.json; older ones are gone).");
  return json(jobView(job));
});
