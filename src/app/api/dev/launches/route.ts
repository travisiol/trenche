import { json, route } from "@/server/api";
import { store } from "@/server/store";
import type { LaunchesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const res: LaunchesResponse = { launches: store().launches };
  return json(res);
});
