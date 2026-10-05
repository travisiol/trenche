import { json, requireAddress, route } from "@/server/api";
import { touchHot } from "@/server/hot";
import { tokenInfo } from "@/server/token";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  // a token page is open: keep this mint's trade inputs warm (blockhash, curve, vault balances, fee, Sender, socket)
  touchHot(requireAddress(mint, "mint"));
  return json(await tokenInfo(requireAddress(mint, "mint")));
});
