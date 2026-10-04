import { json, route } from "@/server/api";
import { stopCto } from "@/server/cto";
import type { CtoResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST: stop every loop / sniper / wash of the CTO and disarm its activity watches */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const res: CtoResponse = { cto: stopCto(id) };
  return json(res);
});
