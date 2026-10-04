import { json, route } from "@/server/api";
import { vaultLock } from "@/server/wallets";
import type { VaultResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  const res: VaultResponse = { ok: true, ...vaultLock() };
  return json(res);
});
