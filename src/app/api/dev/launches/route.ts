import { json, route } from "@/server/api";
import { autoclaimStatusOrNull } from "@/server/autoclaim";
import { store } from "@/server/store";
import type { LaunchesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** every launch made here, each row with its auto-claim watcher summary (`autoClaim`, null when never armed) */
export const GET = route(async () => {
  const res: LaunchesResponse = { launches: store().launches.map((l) => ({ ...l, autoClaim: autoclaimStatusOrNull(l.mint) })) };
  return json(res);
});
