import { json, readBody, requireAddress, route } from "@/server/api";
import { weiOf } from "@/server/robinhood/amount";
import { bridgeBackExecute } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Robinhood Chain → Solana: ETH from a Robinhood wallet arrives as SOL on a vault wallet (Relay, direct) */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ from?: string; eth?: string; to?: string; seenOutLamports?: string }>(req);
  const seen = typeof b.seenOutLamports === "string" && /^\d+$/.test(b.seenOutLamports) ? BigInt(b.seenOutLamports) : null;
  return json(await bridgeBackExecute(b.from || null, weiOf(b.eth), requireAddress(b.to, "to"), seen));
});
