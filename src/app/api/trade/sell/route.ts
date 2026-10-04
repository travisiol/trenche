import { json, readBody, requireAddress, route } from "@/server/api";
import { tradeSell } from "@/server/trade";
import type { TradeSellRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST TradeSellRequest → TradeCreated: explicit percent or preset sellPercents[i], preset slippage/tip */
export const POST = route(async (req: Request) => {
  const body = await readBody<TradeSellRequest>(req);
  requireAddress(body.mint, "mint");
  return json(await tradeSell(body));
});
