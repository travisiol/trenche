import { json, route } from "@/server/api";
import { balances, walletsResponse } from "@/server/wallets";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await balances().catch(() => null);
  return json(walletsResponse());
});
