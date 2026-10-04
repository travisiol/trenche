import { json, readBody, requireAddress, route } from "@/server/api";
import { addRecent, clearRecent, listRecent } from "@/server/recent";
import type { RecentAddRequest, RecentResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET: recently viewed tokens, newest first (20 max) */
export const GET = route(async () => {
  const res: RecentResponse = { recent: listRecent() };
  return json(res);
});

/** POST {mint}: upsert to the front (called on every trading-page visit) */
export const POST = route(async (req: Request) => {
  const body = await readBody<RecentAddRequest>(req);
  const res: RecentResponse = { recent: await addRecent(requireAddress(body.mint, "mint")) };
  return json(res);
});

/** DELETE: clear the list */
export const DELETE = route(async () => {
  clearRecent();
  const res: RecentResponse = { recent: [] };
  return json(res);
});
