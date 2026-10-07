import { json, readBody, route } from "@/server/api";
import { store } from "@/server/store";
import { husherConfigured, husherHistory, husherCreate } from "@/server/husher";
export const dynamic = "force-dynamic";
export const GET = route(() => json({ configured: husherConfigured(), mainnet: store().settings.cluster === "mainnet", orders: husherHistory() }));
export const POST = route(async (req: Request) => {
  const body = await readBody<{ quoteId: string; consent: boolean; picks?: unknown }>(req);
  return json(await husherCreate(body.quoteId, body.consent, body.picks));
});
