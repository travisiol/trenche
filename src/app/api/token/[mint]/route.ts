import { json, requireAddress, route } from "@/server/api";
import { tokenInfo } from "@/server/token";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  return json(await tokenInfo(requireAddress(mint, "mint")));
});
