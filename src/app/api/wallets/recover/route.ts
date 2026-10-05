import { json, route } from "@/server/api";
import { recoverFromBackups } from "@/server/wallets";

export const dynamic = "force-dynamic";

/** POST → keys found in the vault backups but missing from the vault go to the trash */
export const POST = route(async () => json(recoverFromBackups()));
