import { HttpError, route, sse } from "@/server/api";
import { jobGet, jobOnChange, jobView } from "@/server/jobs";

export const dynamic = "force-dynamic";

/** SSE: `job` event with the full JobView the moment it changes (pushed by jobPush / jobNote — a "sent" step reaches
 *  the browser within milliseconds, no poll interval), then `done` and the stream closes. A 1 s safety tick re-checks
 *  for changes made outside the job helpers (extra, nextAt). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const job = jobGet(id);
  if (!job) throw new HttpError(404, "Unknown job.");
  return sse((send) => {
    let last = "";
    let queued = false;
    let finished = false;
    const flush = () => {
      queued = false;
      if (finished) return;
      const v = jobView(job);
      const key = JSON.stringify([v.status, v.completed, v.nextAt, v.steps.length, v.error, v.extra]);
      if (key !== last) {
        last = key;
        send("job", v);
      }
      if (v.done) {
        finished = true;
        send("done", v);
        stop();
      }
    };
    // several steps written in the same tick (10 wallets "sent" together) go out as one event
    const kick = () => {
      if (queued) return;
      queued = true;
      setImmediate(flush);
    };
    const unsub = jobOnChange(id, kick);
    const t = setInterval(kick, 1000);
    const stop = () => {
      clearInterval(t);
      unsub();
    };
    flush();
    return stop;
  }, req.signal);
});
