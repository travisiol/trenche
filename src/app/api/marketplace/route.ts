import { json, route, readBody } from "@/server/api";
import { marketCatalog, marketHistory, reserveMarket } from "@/server/marketplace";
export const dynamic = "force-dynamic";
export const GET = route(async () => json({ wallets: await marketCatalog(), orders: marketHistory() }));
export const POST = route(async (req: Request) => json(await reserveMarket(await readBody(req))));
