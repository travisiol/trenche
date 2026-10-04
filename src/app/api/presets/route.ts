import { HttpError, json, readBody, route } from "@/server/api";
import { savePresets, store } from "@/server/store";
import type { LaunchPreset, PresetsResponse, PresetsUpdateRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const res: PresetsResponse = { presets: store().presets };
  return json(res);
});

function validPreset(p: unknown): LaunchPreset {
  const o = (p ?? {}) as Partial<LaunchPreset>;
  const id = String(o.id ?? "").trim() || "p_" + Date.now().toString(36);
  const name = String(o.name ?? "").trim().slice(0, 48);
  if (!name) throw new HttpError(400, "preset.name required.");
  const data = o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : {};
  return { id, name, createdAt: Number(o.createdAt) || Date.now(), data };
}

export const POST = route(async (req: Request) => {
  const body = await readBody<PresetsUpdateRequest>(req);
  const st = store();
  if ("preset" in body) {
    const p = validPreset(body.preset);
    const i = st.presets.findIndex((x) => x.id === p.id);
    if (i >= 0) st.presets[i] = { ...p, createdAt: st.presets[i].createdAt };
    else st.presets.push(p);
  } else if ("remove" in body) {
    st.presets = st.presets.filter((x) => x.id !== String(body.remove));
  } else if ("presets" in body) {
    if (!Array.isArray(body.presets)) throw new HttpError(400, "presets: array expected.");
    st.presets = body.presets.map(validPreset);
  } else throw new HttpError(400, "Body must contain preset, remove or presets.");
  if (st.presets.length > 100) throw new HttpError(400, "Too many presets (100 max).");
  savePresets(st);
  const res: PresetsResponse = { presets: st.presets };
  return json(res);
});
