import { json, route } from "@/server/api";
import { ethUsd, rhLogs } from "@/server/robinhood/chain";

export const dynamic = "force-dynamic";

/** bottom bar: chain head latency and ETH price */
export const GET = route(async () => {
  const t0 = Date.now();
  const [head, usd] = await Promise.all([rhLogs().getBlockNumber().catch(() => null), ethUsd()]);
  return json({ ok: head !== null, head: head?.toString() ?? null, latencyMs: head !== null ? Date.now() - t0 : null, ethUsd: usd });
});
