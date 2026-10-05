import { readFileSync } from "node:fs";
import { join } from "node:path";
import { json, route } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET → { build }: the BUILD_ID of the running server (next start), "dev" under next dev. The UI compares it with the
 *  one it loaded with and offers a reload after an update — an open tab otherwise keeps running the old code. */
export const GET = route(async () => {
  let build = "dev";
  try {
    build = readFileSync(join(process.cwd(), process.env.TRENCH_DIST_DIR?.trim() || ".next", "BUILD_ID"), "utf8").trim() || "dev";
  } catch {
    /* next dev: no BUILD_ID */
  }
  return json({ build });
});
