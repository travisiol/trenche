import { readFileSync, readdirSync } from "node:fs";
import { HttpError, json, route } from "@/server/api";
import { requireUnlocked } from "@/server/engine";
import { store } from "@/server/store";
import { backupsDir } from "@/server/wallets";

export const dynamic = "force-dynamic";

/** GET → the encrypted vault file as a download (the passphrase is still needed to open it) · ?info=1 → where the
 *  automatic dated copies are and how many there are */
export const GET = route(async (req: Request) => {
  requireUnlocked();
  const st = store();
  if (new URL(req.url).searchParams.get("info") === "1") {
    let count = 0;
    let latest: string | null = null;
    try {
      const all = readdirSync(backupsDir(st)).filter((f) => f.startsWith("keystore-")).sort();
      count = all.length;
      latest = all[all.length - 1] ?? null;
    } catch {
      /* no copy yet */
    }
    return json({ dir: backupsDir(st), count, latest, vault: st.paths.keystore });
  }
  let body: string;
  try {
    body = readFileSync(st.paths.keystore, "utf8");
  } catch {
    throw new HttpError(404, "No vault file.");
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="donchain-vault-${stamp}.enc.json"`, "cache-control": "no-store" } });
});
