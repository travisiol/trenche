import { intIn, json, route } from "@/server/api";
import { search } from "@/server/search";
import type { SearchSort } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/search?q=&sort=mc|age|volume&limit= → SearchResponse */
export const GET = route(async (req: Request) => {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").slice(0, 100);
  const s = u.searchParams.get("sort");
  const sort: SearchSort = s === "age" || s === "volume" ? s : "mc";
  return json(await search(q, sort, intIn(u.searchParams.get("limit"), 1, 100, 30, "limit")));
});
