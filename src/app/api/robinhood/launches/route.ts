import { json, route } from "@/server/api";
import { ethUsd } from "@/server/robinhood/chain";
import { rhLaunchRows } from "@/server/robinhood/market";

export const dynamic = "force-dynamic";

/** every Robinhood launch with its market cap and PnL */
export const GET = route(async () => {
  const [rows, usd] = await Promise.all([rhLaunchRows(), ethUsd()]);
  return json({ launches: rows, ethUsd: usd });
});
