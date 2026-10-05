import { bad, json, route } from "@/server/api";
import { pnlShare } from "@/server/dashboard";
import type { PnlSharePeriod } from "@/lib/types";

export const dynamic = "force-dynamic";

const PERIODS: PnlSharePeriod[] = ["1d", "7d", "30d", "all"];

/** ?period=1d|7d|30d|all (default 1d) → PnlShareResponse · ?day=YYYY-MM-DD → that calendar day */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const day = q.get("day");
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) bad("day must be YYYY-MM-DD (UTC)");
  const p = (q.get("period") ?? "1d").toLowerCase() as PnlSharePeriod;
  if (!PERIODS.includes(p)) bad(`period must be one of ${PERIODS.join(", ")}`);
  return json(await pnlShare(p, day ?? undefined));
});
