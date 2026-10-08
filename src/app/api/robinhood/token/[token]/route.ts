import { json, route } from "@/server/api";
import { rhTokenView } from "@/server/robinhood/market";

export const dynamic = "force-dynamic";

/** a Pons V2 token: curve state, trades (CurveBuy / CurveSell events), your wallets on it, PnL */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  return json(await rhTokenView(token));
});
