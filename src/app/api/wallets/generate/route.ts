import { intIn, json, readBody, route } from "@/server/api";
import { balances, generateWallets, walletsResponse } from "@/server/wallets";
import type { WalletsGenerateRequest, WalletsGenerateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<WalletsGenerateRequest>(req);
  const count = intIn(body.count, 1, 50, 1, "count");
  const addresses = generateWallets(count, body.label ? String(body.label) : undefined, body.group ? String(body.group) : undefined);
  await balances(true).catch(() => null);
  const res: WalletsGenerateResponse = { ...walletsResponse(), addresses };
  return json(res);
});
