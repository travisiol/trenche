import { json, requireAddress, route, sse } from "@/server/api";
import { touchHot } from "@/server/hot";
import { liveHealth, liveStatus, liveTrades, watchMint } from "@/server/livefeed";
import { solPrice, solPriceCached } from "@/server/price";
import type { LiveHello } from "@/lib/liveTypes";

export const dynamic = "force-dynamic";

/** SSE: `hello` (recent trades + feed state), then `trade` (LiveTrade[] of one transaction, the moment it is
 *  confirmed), `status` (socket state) and `sol` (SOL/USD, every 10 s when it moved). `?stats=1` → feed health JSON. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  requireAddress(mint, "mint");
  if (new URL(req.url).searchParams.get("stats")) return json(liveHealth(mint));
  touchHot(mint);
  return sse((send) => {
    let usd = solPriceCached();
    const stop = watchMint(mint, { trades: (t) => send("trade", t), status: (s) => send("status", s) });
    send("hello", { mint, status: liveStatus(), trades: liveTrades(mint).slice(0, 100), solUsd: usd } satisfies LiveHello);
    // the PnL's USD figure follows SOL (price.ts caches 10 s: N streams = 1 upstream call); touchHot keeps the
    // blockhash / balances snapshot warm while the workspace is open, as the polled routes did
    const t = setInterval(() => {
      touchHot(mint);
      void solPrice()
        .then((p) => {
          if (p && p.usd !== usd) {
            usd = p.usd;
            send("sol", p.usd);
          }
        })
        .catch(() => null);
    }, 10_000);
    return () => {
      clearInterval(t);
      stop();
    };
  }, req.signal);
});
