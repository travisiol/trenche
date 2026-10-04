import { json, readBody, route } from "@/server/api";
import { executeLaunchRequest } from "@/server/launch";
import type { LaunchExecuteRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<LaunchExecuteRequest>(req);
  return json(await executeLaunchRequest(body));
});
