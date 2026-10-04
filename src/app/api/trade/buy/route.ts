import { json, readBody, requireAddress, route } from "@/server/api";
import { tradeBuy } from "@/server/trade";
import type { TradeBuyRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST TradeBuyRequest → TradeCreated: explicit SOL, preset amount (P1–P3 × 4), preset % of balance or explicit %,
 *  with the preset's slippage/tip and "Multi wallet trading" spread/delay */
export const POST = route(async (req: Request) => {
  const body = await readBody<TradeBuyRequest>(req);
  requireAddress(body.mint, "mint");
  return json(await tradeBuy(body));
});
