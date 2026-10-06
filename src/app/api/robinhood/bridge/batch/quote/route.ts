import { json, readBody, route } from "@/server/api";
import { bridgeBatchQuote, type BatchLegIn } from "@/server/robinhood/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ legs?: BatchLegIn[]; to?: string }>(req);
  return json(await bridgeBatchQuote(b.legs ?? [], b.to || null));
});
