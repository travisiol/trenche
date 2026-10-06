import { json, readBody, route } from "@/server/api";
import { rhLaunch, type RhLaunchRequest } from "@/server/robinhood/pons";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const POST = route(async (req: Request) => json(await rhLaunch(await readBody<RhLaunchRequest>(req))));
