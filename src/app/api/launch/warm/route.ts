import { json, readBody, route } from "@/server/api";
import { warmLaunch } from "@/server/launch";
import type { LaunchWarmRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST: build the lookup table of a coming launch now (draft with a known mint, dev and bundle wallets) — a table is
 *  only usable once rooted, ~13 s after its creation, so it must exist before the Launch click */
export const POST = route(async (req: Request) => {
  const body = await readBody<LaunchWarmRequest>(req);
  return json(warmLaunch(body));
});
