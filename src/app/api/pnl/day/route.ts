import { HttpError, json, route } from "@/server/api";
import { refreshCreatorRevenue } from "@/server/creatorRevenue";
import { ledgerDay, refreshLedger } from "@/server/ledger";

export const dynamic = "force-dynamic";

/** GET ?date=YYYY-MM-DD → that calendar day coin by coin (trades, launch costs, creator fees earned that day, net) */
export const GET = route(async (req: Request) => {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD (UTC).");
  void refreshLedger({ minIntervalMs: 15_000 }).catch(() => null);
  void refreshCreatorRevenue({ minIntervalMs: 15_000 }).catch(() => null);
  return json(ledgerDay(date));
});
