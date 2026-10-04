import { HttpError, json, requireAddress, route } from "@/server/api";
import { tokenCandles } from "@/server/token";
import type { CandleTf } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  const tf = (new URL(req.url).searchParams.get("tf") ?? "15s") as CandleTf;
  if (!["1s", "15s", "1m"].includes(tf)) throw new HttpError(400, "tf must be 1s, 15s or 1m.");
  return json(await tokenCandles(requireAddress(mint, "mint"), tf));
});
