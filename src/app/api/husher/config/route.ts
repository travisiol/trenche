import { HttpError, json, readBody, route } from "@/server/api";
import { requireUnlocked } from "@/server/engine";
import { saveSettings, store } from "@/server/store";
import { husherConfigured } from "@/server/husher";
export const dynamic = "force-dynamic";
export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<{ key?: unknown }>(req);
  if (typeof body.key !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(body.key.trim())) throw new HttpError(400, "Enter a valid Husher API key.");
  const st = store(); st.settings.husherKey = body.key.trim(); saveSettings(st);
  return json({ configured: husherConfigured() });
});
