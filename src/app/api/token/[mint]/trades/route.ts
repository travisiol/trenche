import { intIn, json, requireAddress, route } from "@/server/api";
import { touchHot } from "@/server/hot";
import { tokenTrades } from "@/server/token";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  touchHot(requireAddress(mint, "mint"));
  const limit = intIn(new URL(req.url).searchParams.get("limit"), 1, 500, 100, "limit");
  return json(await tokenTrades(requireAddress(mint, "mint"), limit));
});
