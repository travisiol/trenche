import { json, route } from "@/server/api";
import { autoclaimStatusOrNull } from "@/server/autoclaim";
import { launchRecordStatus, reconcileLaunches } from "@/server/reconcile";
import { store } from "@/server/store";
import type { LaunchesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** every launch made here, each row with its auto-claim watcher summary (`autoClaim`, null when never armed) */
export const GET = route(async () => {
  // unconfirmed creates with a signature are re-checked on chain (every 30 s at most) before the list is answered
  await reconcileLaunches().catch(() => 0);
  const res: LaunchesResponse = { launches: store().launches.map((l) => ({ ...l, status: launchRecordStatus(l), autoClaim: autoclaimStatusOrNull(l.mint) })) };
  return json(res);
});
