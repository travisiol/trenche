import { HttpError, route, sse } from "@/server/api";
import { jobGet, jobView } from "@/server/jobs";

export const dynamic = "force-dynamic";

/** SSE: `job` event with the full JobView whenever it changes (500 ms poll), then closes once done. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const job = jobGet(id);
  if (!job) throw new HttpError(404, "Unknown job.");
  return sse((send) => {
    let last = "";
    const tick = () => {
      const v = jobView(job);
      const key = JSON.stringify([v.status, v.completed, v.nextAt, v.steps.length, v.error, v.extra]);
      if (key !== last) {
        last = key;
        send("job", v);
      }
      if (v.done) {
        clearInterval(t);
        send("done", v);
      }
    };
    const t = setInterval(tick, 500);
    tick();
    return () => clearInterval(t);
  }, req.signal);
});
