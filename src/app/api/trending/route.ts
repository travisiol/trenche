import { HttpError, intIn, json, route } from "@/server/api";
import { trending } from "@/server/feed";
import type { TrendingResponse, TrendingWindow } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const window = (q.get("window") ?? "5m") as TrendingWindow;
  if (!["1m", "5m", "1h", "6h", "24h"].includes(window)) throw new HttpError(400, "window must be 1m, 5m, 1h, 6h or 24h.");
  const res: TrendingResponse = { window, at: Date.now(), entries: trending(window, intIn(q.get("limit"), 1, 100, 50, "limit")) };
  return json(res);
});
