import { json, route } from "@/server/api";
import { marketHistory } from "@/server/marketplace";
export const dynamic = "force-dynamic";
export const GET = route(() => json(marketHistory()));
