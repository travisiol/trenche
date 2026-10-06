import { bad, json, readBody, route } from "@/server/api";
import { rhBuy, rhSell } from "@/server/robinhood/pons";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ token?: string; side?: string; eth?: string; percent?: number; wallet?: string }>(req);
  const token = String(b.token ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) bad("token: an 0x address.");
  if (b.side === "buy") return json(await rhBuy(token, String(b.eth ?? ""), b.wallet || null));
  if (b.side === "sell") return json(await rhSell(token, Number(b.percent), b.wallet || null));
  return bad("side: buy or sell.");
});
