import { json, readBody, requireAddress, route } from "@/server/api";
import { bridgeBackBatchExecute, type BatchLegIn } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Robinhood → Solana, several Robinhood wallets at once to one vault wallet; one result per leg */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ legs?: BatchLegIn[]; to?: string }>(req);
  return json(await bridgeBackBatchExecute(b.legs ?? [], requireAddress(b.to, "to")));
});
