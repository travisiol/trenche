import { json, route } from "@/server/api";
import { deleteGroup, walletsResponse } from "@/server/wallets";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  deleteGroup(id);
  return json(walletsResponse());
});
