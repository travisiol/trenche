import { json, lamportsOf, readBody, requireAddress, route } from "@/server/api";
import { bridgeQuote } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const b = await readBody<{ from?: string; sol?: string; to?: string }>(req);
  return json(await bridgeQuote(requireAddress(b.from, "from"), lamportsOf(b.sol, "amount"), b.to || null));
});
