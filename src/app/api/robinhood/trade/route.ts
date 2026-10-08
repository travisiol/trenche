import { bad, json, readBody, route } from "@/server/api";
import { rhBuyMany, rhSellMany } from "@/server/robinhood/market";
import { evmWallets } from "@/server/robinhood/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** { token, side: "buy", wallets, eth } · { token, side: "sell", wallets | "all", percent } — one transaction per wallet,
 *  all sent together */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ token?: string; side?: string; eth?: string; percent?: number; wallet?: string; wallets?: string[] | "all" }>(req);
  const token = String(b.token ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) bad("token: an 0x address.");
  const wallets = b.wallets === "all" ? evmWallets().map((w) => w.address) : Array.isArray(b.wallets) ? b.wallets.map(String) : b.wallet ? [String(b.wallet)] : [];
  if (b.side === "buy") return json({ results: await rhBuyMany(token, wallets, String(b.eth ?? "")) });
  if (b.side === "sell") return json({ results: await rhSellMany(token, wallets, Number(b.percent)) });
  return bad("side: buy or sell.");
});
