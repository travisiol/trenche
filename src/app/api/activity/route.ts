import { intIn, json, route } from "@/server/api";
import { store } from "@/server/store";
import type { ActivityResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** a Robinhood Chain entry (tagged chain: robinhood, or written by the Robinhood module) */
const isRh = (a: { message?: string; data?: Record<string, unknown> }) => a.data?.chain === "robinhood" || /^Robinhood/.test(a.message ?? "");

/** ?chain=robinhood → only the Robinhood entries; default → the Solana ones (the two modes never mix) */
export const GET = route(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const limit = intIn(sp.get("limit"), 1, 2000, 200, "limit");
  const rh = sp.get("chain") === "robinhood";
  const res: ActivityResponse = { items: store().activity.filter((a) => isRh(a as never) === rh).slice(0, limit) };
  return json(res);
});
