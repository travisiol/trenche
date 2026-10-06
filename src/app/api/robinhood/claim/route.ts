import { json, readBody, route } from "@/server/api";
import { rhClaim } from "@/server/robinhood/pons";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = route(async (req: Request) => json(await rhClaim((await readBody<{ wallet?: string }>(req)).wallet || null)));
