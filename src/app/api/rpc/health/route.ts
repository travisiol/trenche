import { json, route } from "@/server/api";
import { pumpStatus } from "@/server/pumpapi";
import { isPublicRpcUrl, maskRpcUrl, probeRpc, rpcHealth } from "@/server/rpcqueue";
import { effectiveRpcUrl, store } from "@/server/store";
import type { RpcHealthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET: RPC queue health for the bottom-bar pill — provider kind, median latency, 429s in the last minute, queue depth,
 *  plus the pump.fun data API status (ok / in back-off). Numbers are from this server process only. */
export const GET = route(async () => {
  const url = effectiveRpcUrl(store().settings);
  // one getSlot through the queue per call (the pill polls every 10 s): the pill shows the p50 of the last 10
  await probeRpc(url);
  const h = rpcHealth();
  const res: RpcHealthResponse = {
    ...h,
    // before the first upstream call the health has no URL yet: describe the configured one
    url: h.url || maskRpcUrl(url),
    provider: h.url ? h.provider : isPublicRpcUrl(url) ? "public" : "private",
    pump: pumpStatus(),
  };
  return json(res);
});
