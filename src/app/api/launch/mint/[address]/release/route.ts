import { json, requireAddress, route } from "@/server/api";
import { releaseReserved } from "@/server/vanity";

export const dynamic = "force-dynamic";

/** POST: drop an unused reserved mint */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ address: string }> }) => {
  const { address } = await ctx.params;
  releaseReserved(requireAddress(address, "mint"));
  return json({ ok: true });
});
