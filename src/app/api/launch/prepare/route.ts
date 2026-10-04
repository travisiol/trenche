import { json, readBody, route } from "@/server/api";
import { prepareLaunchMeta } from "@/server/launch";
import type { LaunchPrepareRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<LaunchPrepareRequest>(req);
  return json(await prepareLaunchMeta(body));
});
