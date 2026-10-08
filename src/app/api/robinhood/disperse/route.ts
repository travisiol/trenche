import { bad, json, readBody, route } from "@/server/api";
import { rhDisperse } from "@/server/robinhood/pons";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** { from, plan: [{ to, eth }] } — one wallet pays many, one nonce sequence */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ from?: string; plan?: { to: string; eth: string }[] }>(req);
  if (!Array.isArray(b.plan)) bad("plan: a list of { to, eth }.");
  return json({ results: await rhDisperse(String(b.from ?? ""), b.plan!) });
});
