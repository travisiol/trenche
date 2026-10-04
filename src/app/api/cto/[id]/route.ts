import { json, readBody, route } from "@/server/api";
import { ctoView, deleteCto, getCto, updateCto } from "@/server/cto";
import type { CtoResponse, CtoUpdateRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const res: CtoResponse = { cto: ctoView(getCto(id)) };
  return json(res);
});

/** PATCH { address?, addressIs?, name?, tasks? } — "add the address later" */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await readBody<CtoUpdateRequest>(req);
  const res: CtoResponse = { cto: await updateCto(id, body) };
  return json(res);
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  deleteCto(id);
  return json({ ok: true });
});
