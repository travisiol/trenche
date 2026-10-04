import { intIn, json, route } from "@/server/api";
import { store } from "@/server/store";
import type { ActivityResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const limit = intIn(new URL(req.url).searchParams.get("limit"), 1, 2000, 200, "limit");
  const res: ActivityResponse = { items: store().activity.slice(0, limit) };
  return json(res);
});
