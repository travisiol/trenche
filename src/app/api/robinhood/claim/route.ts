import { json, route } from "@/server/api";
import { rhClaim } from "@/server/robinhood/pons";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = route(async () => json(await rhClaim()));
