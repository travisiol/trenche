import { HttpError, json, readBody, route } from "@/server/api";
import { refreshMarket, importMarket, cancelMarket, settleMarket } from "@/server/marketplace";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = route(async (_req: Request, ctx: Context) => json(await refreshMarket((await ctx.params).id)));
export const POST = route(async (req: Request, ctx: Context) => { const { id } = await ctx.params; const body = await readBody(req); if (body.action === "settle") return json(await settleMarket(id)); if (body.action === "import") return json(await importMarket(id)); if (body.action === "cancel") return json(await cancelMarket(id)); throw new HttpError(400, "Unknown marketplace action."); });
