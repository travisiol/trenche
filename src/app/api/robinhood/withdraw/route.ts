import { json, readBody, route } from "@/server/api";
import { rhWithdraw } from "@/server/robinhood/pons";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ to?: string; amount?: string; from?: string }>(req);
  return json(await rhWithdraw(String(b.to ?? "").trim(), String(b.amount ?? ""), b.from || null));
});
