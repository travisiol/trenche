import { HttpError, json, readBody, route } from "@/server/api";
import { balances, generateWallets, walletsResponse } from "@/server/wallets";
import type { WalletsGenerateRequest, WalletsGenerateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST {count 1..50, label? (prefix → "Sniper 1", "Sniper 2"…), group?} → wallets + addresses */
export const POST = route(async (req: Request) => {
  const body = await readBody<WalletsGenerateRequest>(req);
  const count = Number(body.count ?? 1);
  if (!Number.isInteger(count)) throw new HttpError(400, "count: an integer is required.");
  const addresses = generateWallets(count, body.label ? String(body.label) : undefined, body.group ? String(body.group) : undefined);
  await balances(true).catch(() => null);
  const res: WalletsGenerateResponse = { ...walletsResponse(), addresses };
  return json(res);
});
