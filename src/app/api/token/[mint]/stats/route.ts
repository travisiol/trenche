import { json, requireAddress, route } from "@/server/api";
import { tokenStats } from "@/server/token";

export const dynamic = "force-dynamic";

/** GET: window stats 5m / 1h / 6h / 24h (volume, buys/sells, net, price change) from curveTradeHistory */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  return json(await tokenStats(requireAddress(mint, "mint")));
});
