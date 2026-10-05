import { json, route } from "@/server/api";
import { pumpStatus } from "@/server/pumpapi";
import { hotHealth } from "@/server/hot";
import { isPublicRpcUrl, maskRpcUrl, probeRpc, rpcHealth, rpcMethodCounts } from "@/server/rpcqueue";
import { senderHealth } from "@/server/sender";
import { sigsubHealth } from "@/server/sigsub";
import { effectiveRpcUrl, store } from "@/server/store";
import type { RpcHealthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET: RPC queue health for the bottom-bar pill — provider kind, median latency, 429s in the last minute, queue depth,
 *  plus the pump.fun data API status (ok / in back-off), the send path (Helius Sender: sends, 429s, skipped
 *  untipped transactions), the confirmation socket and the hot state. Numbers are from this server process only.
 *  The read RPC's 429 counter no longer includes Sender's (they are separate hosts with separate limits).
 *  ?methods=1 → cumulative upstream calls / cache answers per JSON-RPC method (measurement), no probe. */
export const GET = route(async (req: Request) => {
  if (new URL(req.url).searchParams.get("methods") === "1") return json({ ...rpcMethodCounts(), sender: senderHealth(), sockets: sigsubHealth(), hot: hotHealth() });
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
  return json({ ...res, sender: senderHealth(), sockets: sigsubHealth(), hot: hotHealth() });
});
