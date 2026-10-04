import { json, readBody, requireAddress, route } from "@/server/api";
import { setActive, walletsResponse } from "@/server/wallets";
import type { WalletsActiveRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<WalletsActiveRequest>(req);
  setActive(requireAddress(body.address));
  return json(walletsResponse());
});
