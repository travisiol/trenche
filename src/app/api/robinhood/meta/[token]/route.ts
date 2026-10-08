import { json, route } from "@/server/api";
import { rhTokenMeta } from "@/server/robinhood/market";

export const dynamic = "force-dynamic";

/** name, ticker, logo, description and socials stored on a Pons V2 token (Vamp) */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  return json(await rhTokenMeta(token));
});
