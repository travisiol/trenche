import { bad, json, readBody, requireAddress, route } from "@/server/api";
import { exportKeys } from "@/server/wallets";
import type { WalletsExportRequest, WalletsExportResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<WalletsExportRequest>(req);
  const list = Array.isArray(body.addresses) ? body.addresses : body.address ? [body.address] : [];
  if (list.length === 0) bad("address or addresses required.");
  const addresses = list.map((a) => requireAddress(a));
  if (typeof body.passphrase !== "string" || !body.passphrase) bad("passphrase required to export keys.");
  const res: WalletsExportResponse = { keys: exportKeys(addresses, body.passphrase) };
  return json(res);
});
