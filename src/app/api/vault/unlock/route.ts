import { json, readBody, route } from "@/server/api";
import { vaultUnlock } from "@/server/wallets";
import type { VaultResponse, VaultUnlockRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<VaultUnlockRequest>(req);
  const status = vaultUnlock(String(body.passphrase ?? ""));
  const res: VaultResponse = { ok: true, ...status };
  return json(res);
});
