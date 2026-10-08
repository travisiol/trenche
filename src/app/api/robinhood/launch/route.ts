import { json, readBody, route } from "@/server/api";
import { rhLaunch, type RhLaunchRequest } from "@/server/robinhood/launch";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** launch on Pons V2: dev buy in the launch transaction, each bundle wallet in its own guarded transaction */
export const POST = route(async (req: Request) => json(await rhLaunch(await readBody<RhLaunchRequest>(req))));
