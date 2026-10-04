import { route, sse } from "@/server/api";
import { subscribeLaunch } from "@/server/launch";

export const dynamic = "force-dynamic";

/** SSE: `state` first, then `step` / `task_status` / `done` / `error` */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return sse((send) => subscribeLaunch(id, (ev) => send(ev.type, ev.data)), req.signal);
});
