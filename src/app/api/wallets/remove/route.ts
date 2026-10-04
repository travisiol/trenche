import { json, readBody, requireAddresses, route } from "@/server/api";
import { removeWallets, walletsResponse } from "@/server/wallets";
import type { WalletsRemoveRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<WalletsRemoveRequest>(req);
  const removed = removeWallets(requireAddresses(body.addresses, "addresses"));
  return json({ ...walletsResponse(), removed });
});
