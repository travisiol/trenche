import { json, route } from "@/server/api";
import { husherRefresh } from "@/server/husher";
export const dynamic = "force-dynamic";
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => json(await husherRefresh((await ctx.params).id)));
