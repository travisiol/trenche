import { json, readBody, requireAddress, route } from "@/server/api";
import { weiOf } from "@/server/robinhood/amount";
import { bridgeBackQuote } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const b = await readBody<{ from?: string; eth?: string; to?: string }>(req);
  return json(await bridgeBackQuote(b.from || null, weiOf(b.eth), requireAddress(b.to, "to")));
});
