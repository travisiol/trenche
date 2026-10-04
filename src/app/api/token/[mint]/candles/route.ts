import { HttpError, json, requireAddress, route } from "@/server/api";
import { tokenCandles } from "@/server/token";
import { CANDLE_TFS, type CandleTf } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  const tf = (new URL(req.url).searchParams.get("tf") ?? "15s") as CandleTf;
  if (!CANDLE_TFS.includes(tf)) throw new HttpError(400, `tf must be one of ${CANDLE_TFS.join(", ")}.`);
  return json(await tokenCandles(requireAddress(mint, "mint"), tf));
});
