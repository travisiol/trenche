import { HttpError, json, route } from "@/server/api";
import { solPrice } from "@/server/price";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const p = await solPrice();
  if (!p) throw new HttpError(503, "SOL price unavailable (Jupiter and coingecko both failed).");
  return json(p);
});
