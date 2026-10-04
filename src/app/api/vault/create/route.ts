import { json, readBody, route } from "@/server/api";
import { vaultCreate } from "@/server/wallets";
import type { VaultCreateRequest, VaultResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<VaultCreateRequest>(req);
  const status = vaultCreate(String(body.passphrase ?? ""));
  const res: VaultResponse = { ok: true, ...status };
  return json(res);
});
