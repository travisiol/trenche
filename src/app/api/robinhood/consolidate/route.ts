import { bad, json, readBody, route } from "@/server/api";
import { rhConsolidate } from "@/server/robinhood/pons";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** { from: [...], to, percent? } — every source sends its ETH (minus the gas) to one wallet */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ from?: string[]; to?: string; percent?: number }>(req);
  if (!Array.isArray(b.from)) bad("from: a list of wallets.");
  return json({ results: await rhConsolidate(b.from!.map(String), String(b.to ?? ""), Number(b.percent ?? 100)) });
});
