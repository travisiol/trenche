import { json, lamportsOf, readBody, requireAddress, route } from "@/server/api";
import { bridgeExecute } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Solana → Robinhood Chain: deposit SOL to Relay from a vault wallet, ETH arrives on the Robinhood wallet */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ from?: string; sol?: string; seenOutWei?: string }>(req);
  const seen = typeof b.seenOutWei === "string" && /^\d+$/.test(b.seenOutWei) ? BigInt(b.seenOutWei) : null;
  return json(await bridgeExecute(requireAddress(b.from, "from"), lamportsOf(b.sol, "amount"), seen));
});
