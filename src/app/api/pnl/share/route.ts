import { bad, json, route } from "@/server/api";
import { pnlShare } from "@/server/dashboard";
import type { PnlSharePeriod } from "@/lib/types";

export const dynamic = "force-dynamic";

const PERIODS: PnlSharePeriod[] = ["1d", "7d", "30d", "all"];

/** ?period=1d|7d|30d|all (default 1d) → PnlShareResponse */
export const GET = route(async (req: Request) => {
  const p = (new URL(req.url).searchParams.get("period") ?? "1d").toLowerCase() as PnlSharePeriod;
  if (!PERIODS.includes(p)) bad(`period must be one of ${PERIODS.join(", ")}`);
  return json(await pnlShare(p));
});
