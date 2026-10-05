import { json, route } from "@/server/api";
import { deleteGroup, numberGroupWallets, renameGroup, walletsResponse } from "@/server/wallets";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  deleteGroup(id);
  return json(walletsResponse());
});

/** POST /api/groups/[id] {action:"number"} → label its wallets "<group> 1, 2, 3…" */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "number") return json({ error: 'action must be "number"' }, { status: 400 });
  const renamed = numberGroupWallets(id);
  return json({ ...walletsResponse(), renamed });
});

/** PATCH /api/groups/[id] {name} → rename */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const group = renameGroup(id, String(body.name ?? ""));
  return json({ ...walletsResponse(), group });
});
