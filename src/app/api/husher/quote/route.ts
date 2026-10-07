import { json, readBody, route } from "@/server/api";
import { husherQuote, husherLimits } from "@/server/husher";
import type { HusherPlan } from "@/lib/husher";
export const dynamic = "force-dynamic";
export const GET = route(async () => json(await husherLimits()));
export const POST = route(async (req: Request) => json(await husherQuote(await readBody<HusherPlan>(req))));
