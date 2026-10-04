import { json, route } from "@/server/api";
import { feedStart, snapshot } from "@/server/feed";

export const dynamic = "force-dynamic";

/** GET /api/feed → the same FeedSnapshot the stream sends first (polling fallback) */
export const GET = route(async () => {
  feedStart();
  return json(snapshot());
});
