import { json, route } from "@/server/api";
import { startCto } from "@/server/cto";
import type { CtoResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST: run every task now (the mint must be known) */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const res: CtoResponse = { cto: await startCto(id) };
  return json(res);
});
