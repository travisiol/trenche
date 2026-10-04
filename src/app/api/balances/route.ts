import { json, route } from "@/server/api";
import { balances } from "@/server/wallets";
import type { BalancesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const res: BalancesResponse = await balances(force);
  return json(res);
});
