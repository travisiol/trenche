import { json, readBody, route } from "@/server/api";
import { prepareLaunchMeta } from "@/server/launch";
import type { LaunchPrepareRequest } from "@/lib/types";

import { ensureStaticLookupTable } from "@/server/alt";
import { readConn } from "@/server/engine";
import { isDevnet, store } from "@/server/store";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<LaunchPrepareRequest>(req);
  warmStaticTable();
  return json(await prepareLaunchMeta(body));
});

/** the static pump.fun lookup table (≈0.008 SOL, once) is built now, in the background, by the richest vault wallet —
 *  so the launch that follows does not wait for it (it never builds it itself: same-slot tables collide) */
function warmStaticTable(): void {
  const st = store();
  if (!st.sol.unlocked || isDevnet(st.settings)) return;
  const bal = st.balances?.map ?? {};
  const best = st.sol.wallets.map((w) => [w.address, Number(bal[w.address] ?? 0)] as const).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0.02) ensureStaticLookupTable(readConn(), st.sol.keypair(best[0]));
}
