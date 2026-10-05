import { json, route } from "@/server/api";
import { removedWallets } from "@/server/wallets";

export const dynamic = "force-dynamic";

/** GET → the wallets in the trash (removed from the list, keys still in the encrypted vault) */
export const GET = route(async () => json({ wallets: removedWallets() }));
