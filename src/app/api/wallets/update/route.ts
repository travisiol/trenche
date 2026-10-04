import { json, readBody, requireAddress, route } from "@/server/api";
import { updateWallet, walletsResponse } from "@/server/wallets";
import type { WalletsUpdateRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<WalletsUpdateRequest>(req);
  const address = requireAddress(body.address);
  updateWallet(address, { label: body.label, group: body.group, archived: body.archived, order: body.order });
  return json(walletsResponse());
});
