import { json, readBody, route } from "@/server/api";
import { rhSettings, saveRhSettings, type RhSettings } from "@/server/robinhood/settings";

export const dynamic = "force-dynamic";

export const GET = route(async () => json(rhSettings()));
export const POST = route(async (req: Request) => json(saveRhSettings(await readBody<Partial<RhSettings>>(req))));
