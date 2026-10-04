import { json, route } from "@/server/api";
import { deleteGroup, renameGroup, walletsResponse } from "@/server/wallets";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  deleteGroup(id);
  return json(walletsResponse());
});

/** PATCH /api/groups/[id] {name} → rename */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const group = renameGroup(id, String(body.name ?? ""));
  return json({ ...walletsResponse(), group });
});
