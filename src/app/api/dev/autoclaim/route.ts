import { HttpError, json, readBody, requireAddress, route } from "@/server/api";
import { armAutoclaim, autoclaimStatus, disarmAutoclaim, resumeAutoclaim, tickAutoclaim } from "@/server/autoclaim";
import { requireUnlocked } from "@/server/engine";
import type { AutoClaimActionRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET ?mint= → AutoClaimStatus (enabled:false when never armed) */
export const GET = route(async (req: Request) => {
  const mint = requireAddress(new URL(req.url).searchParams.get("mint"), "mint");
  return json(autoclaimStatus(mint));
});

/** POST ?mint= {action: "arm" | "disarm" | "resume" | "tick", minSol?, intervalSec?} — any mint whose creator is a vault
 *  wallet (a launch made here, a CTO, a tracked mint). arm/resume need an unlocked vault (the claims must sign);
 *  "tick" forces one vault read now (status refresh) without waiting for the interval. */
export const POST = route(async (req: Request) => {
  const body = await readBody<AutoClaimActionRequest & { action: "arm" | "disarm" | "resume" | "tick" }>(req);
  const mint = requireAddress(new URL(req.url).searchParams.get("mint") ?? body.mint, "mint");
  if (body.action === "disarm") return json(disarmAutoclaim(mint));
  if (body.action === "tick") return json(await tickAutoclaim(mint));
  if (body.action === "resume") {
    requireUnlocked();
    return json(resumeAutoclaim(mint));
  }
  if (body.action !== "arm") throw new HttpError(400, "action must be arm, disarm, resume or tick.");
  requireUnlocked();
  return json(armAutoclaim(mint, { minSol: body.minSol, intervalSec: body.intervalSec }));
});
