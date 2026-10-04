import { json, route } from "@/server/api";
import { deleteDraft, getDraft } from "@/server/drafts";
import type { LaunchDraftResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const res: LaunchDraftResponse = { draft: getDraft(id) };
  return json(res);
});

/** DELETE → { ok: true } ("Delete draft" trash icon) */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  deleteDraft(id);
  return json({ ok: true });
});
