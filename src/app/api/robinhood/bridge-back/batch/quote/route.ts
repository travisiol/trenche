import { json, readBody, requireAddress, route } from "@/server/api";
import { bridgeBackBatchQuote, type BatchLegIn } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ legs?: BatchLegIn[]; to?: string }>(req);
  return json(await bridgeBackBatchQuote(b.legs ?? [], requireAddress(b.to, "to")));
});
