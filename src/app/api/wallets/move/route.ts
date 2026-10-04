import { HttpError, json, route } from "@/server/api";
import { moveWallets, walletsResponse } from "@/server/wallets";

export const dynamic = "force-dynamic";

/** POST /api/wallets/move {addresses, group: id | null} → WalletsResponse */
export const POST = route(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { addresses?: string[]; group?: string | null };
  const addresses = Array.isArray(body.addresses) ? body.addresses.map(String) : [];
  if (!addresses.length) throw new HttpError(400, "addresses required.");
  moveWallets(addresses, body.group ? String(body.group) : null);
  return json(walletsResponse());
});
