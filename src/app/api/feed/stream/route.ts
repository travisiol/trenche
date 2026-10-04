import { route, sse } from "@/server/api";
import { feedSubscribe } from "@/server/feed";

export const dynamic = "force-dynamic";

/** SSE: `snapshot` first, then `create` · `trade` · `migrate` · `update` · `solPrice` · `status` */
export const GET = route(async (req: Request) => sse((send) => feedSubscribe((ev) => send(ev.type, ev.data)), req.signal));
