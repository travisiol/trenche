import { json, readBody, route } from "@/server/api";
import { bridgeBatchExecute, type BatchLegIn } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Solana → Robinhood, several vault wallets at once to one Robinhood wallet; one result per leg */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ legs?: BatchLegIn[]; to?: string }>(req);
  return json(await bridgeBatchExecute(b.legs ?? [], b.to || null));
});
