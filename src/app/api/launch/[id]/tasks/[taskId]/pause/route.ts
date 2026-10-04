import { json, route } from "@/server/api";
import { taskAction } from "@/server/launch";
import type { TaskActionResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) => {
  const { id, taskId } = await ctx.params;
  const res: TaskActionResponse = { ok: true, task: await taskAction(id, taskId, "pause") };
  return json(res);
});
