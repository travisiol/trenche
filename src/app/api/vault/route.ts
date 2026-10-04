import { json, route } from "@/server/api";
import { vaultStatus } from "@/server/wallets";

export const dynamic = "force-dynamic";

export const GET = route(async () => json(vaultStatus()));
