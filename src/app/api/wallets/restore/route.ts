import { json, readBody, requireAddresses, route } from "@/server/api";
import { restoreWallets, walletsResponse } from "@/server/wallets";

export const dynamic = "force-dynamic";

/** POST { addresses } → back from the trash into the wallet list */
export const POST = route(async (req: Request) => {
  const body = await readBody<{ addresses?: unknown }>(req);
  const restored = restoreWallets(requireAddresses(body.addresses, "addresses"));
  return json({ ...walletsResponse(), restored });
});
