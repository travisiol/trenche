/* Launch drafts (Block X sidebar Draft / Launched tabs): drafts.json next to launches.json. The form is UI-owned;
 * the server indexes name/symbol/image for the sidebar row and marks a draft launched when its create confirms. */
import type { LaunchDraft } from "@/lib/types";
import { DRAFT_LIMITS } from "@/lib/types";
import { HttpError } from "./api";
import { dataPath, readJson, store, writeJson } from "./store";

function all(): LaunchDraft[] {
  const st = store();
  const rt = st.runtime;
  if (!rt.drafts) rt.drafts = readJson<LaunchDraft[]>(dataPath("drafts"), []).filter((d) => d && typeof d.id === "string");
  return rt.drafts as LaunchDraft[];
}

function save(): void {
  writeJson(dataPath("drafts"), all());
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function listDrafts(): LaunchDraft[] {
  return [...all()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDraft(id: string): LaunchDraft {
  const d = all().find((x) => x.id === id);
  if (!d) throw new HttpError(404, "Unknown draft.");
  return d;
}

export function saveDraft(id: string | undefined, form: unknown): LaunchDraft {
  if (!form || typeof form !== "object" || Array.isArray(form)) throw new HttpError(400, "form: an object is required.");
  const f = form as Record<string, unknown>;
  const size = JSON.stringify(f).length;
  if (size > DRAFT_LIMITS.maxFormBytes) throw new HttpError(400, `Draft too large (${Math.round(size / 1e6)} MB, ${DRAFT_LIMITS.maxFormBytes / 1e6} MB max — the image is the usual culprit).`);
  const list = all();
  const now = Date.now();
  const image = typeof f.imageDataUrl === "string" && /^data:image\//.test(f.imageDataUrl) ? f.imageDataUrl : str(f.image);
  const have = id ? list.find((x) => x.id === id) : undefined;
  if (id && !have && list.length >= DRAFT_LIMITS.max) throw new HttpError(400, `Too many drafts (${DRAFT_LIMITS.max} max) — delete some.`);
  const draft: LaunchDraft = {
    id: have?.id ?? (id && /^[\w-]{1,40}$/.test(id) ? id : "d_" + now.toString(36) + Math.random().toString(36).slice(2, 6)),
    name: str(f.name),
    symbol: str(f.symbol),
    image,
    form: f,
    createdAt: have?.createdAt ?? now,
    updatedAt: now,
    launchedMint: have?.launchedMint ?? null,
  };
  if (have) Object.assign(have, draft);
  else {
    if (list.length >= DRAFT_LIMITS.max) throw new HttpError(400, `Too many drafts (${DRAFT_LIMITS.max} max) — delete some.`);
    list.push(draft);
  }
  save();
  return draft;
}

export function deleteDraft(id: string): void {
  const list = all();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new HttpError(404, "Unknown draft.");
  list.splice(i, 1);
  save();
}

/** called by launch.ts once the create confirmed: the row moves to the Launched tab */
export function markDraftLaunched(id: string | null, mint: string): void {
  if (!id) return;
  const d = all().find((x) => x.id === id);
  if (!d) return;
  d.launchedMint = mint;
  d.updatedAt = Date.now();
  save();
}
