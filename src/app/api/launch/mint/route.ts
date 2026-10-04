import { json, readBody, route } from "@/server/api";
import { requireUnlocked } from "@/server/engine";
import { reserveMint, reservedMints } from "@/server/vanity";
import type { JobCreated, MintReserveRequest, ReservedMintsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET: reserved mints + grinds in progress */
export const GET = route(async () => {
  const res: ReservedMintsResponse = reservedMints();
  return json(res);
});

/** POST {suffix?: "pump", caseSensitive?, timeoutMs?} → { jobId }; job.extra.mint once found (poll /api/jobs/[id]) */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<MintReserveRequest>(req);
  const res: JobCreated = reserveMint(String(body.suffix ?? "pump"), { caseSensitive: !!body.caseSensitive, timeoutMs: body.timeoutMs });
  return json(res);
});
