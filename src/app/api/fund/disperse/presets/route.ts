import { HttpError, json, lamportsOf, numIn, readBody, route, solString } from "@/server/api";
import { dataPath, readJson, writeJson } from "@/server/store";
import type { DispersePreset, DispersePresetsResponse, DispersePresetsUpdateRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const load = (): DispersePreset[] => readJson<DispersePreset[]>(dataPath("dispersePresets"), []).filter((p) => p && typeof p.id === "string");

export const GET = route(async () => {
  const res: DispersePresetsResponse = { presets: load() };
  return json(res);
});

/** POST { preset: {id?, name, totalSol, variationPct, delayMinutes, viaRelay} } (upsert) | { remove: id } */
export const POST = route(async (req: Request) => {
  const body = await readBody<DispersePresetsUpdateRequest>(req);
  let list = load();
  if ("remove" in body) list = list.filter((p) => p.id !== String(body.remove));
  else if ("preset" in body && body.preset) {
    const p = body.preset;
    const name = String(p.name ?? "").trim().slice(0, 48);
    if (!name) throw new HttpError(400, "preset.name required.");
    const id = p.id ? String(p.id) : "dp_" + Date.now().toString(36);
    const rec: DispersePreset = { id, name, totalSol: solString(lamportsOf(p.totalSol, "preset.totalSol", true)), variationPct: numIn(p.variationPct, 0, 100, 0, "preset.variationPct"), delayMinutes: numIn(p.delayMinutes, 0, 1440, 0, "preset.delayMinutes"), viaRelay: !!p.viaRelay, createdAt: list.find((x) => x.id === id)?.createdAt ?? Date.now() };
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = rec;
    else list.push(rec);
    if (list.length > 50) throw new HttpError(400, "50 disperse presets max.");
  } else throw new HttpError(400, "Body must contain preset or remove.");
  writeJson(dataPath("dispersePresets"), list);
  const res: DispersePresetsResponse = { presets: list };
  return json(res);
});
