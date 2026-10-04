import { HttpError, json, route } from "@/server/api";
import { launchGet, launchStateOf } from "@/server/launch";

export const dynamic = "force-dynamic";

/** GET /api/launch/[id] → LaunchState (in-memory; 404 after a server restart) */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const run = launchGet(id);
  if (!run) throw new HttpError(404, "Unknown launch (launches live in memory; the server may have restarted).");
  return json(launchStateOf(run));
});
