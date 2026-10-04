import { json, readBody, route } from "@/server/api";
import { listDrafts, saveDraft } from "@/server/drafts";
import type { LaunchDraftResponse, LaunchDraftSaveRequest, LaunchDraftsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET: every draft, newest first (launched ones carry launchedMint → "Launched" tab) */
export const GET = route(async () => {
  const res: LaunchDraftsResponse = { drafts: listDrafts() };
  return json(res);
});

/** POST {id?, form} → { draft } — autosave on every modal close (upsert) */
export const POST = route(async (req: Request) => {
  const body = await readBody<LaunchDraftSaveRequest>(req);
  const res: LaunchDraftResponse = { draft: saveDraft(body.id ? String(body.id) : undefined, body.form) };
  return json(res);
});
