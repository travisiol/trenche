import { json, requireAddress, route } from "@/server/api";
import { positions } from "@/server/positions";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";

/** ?wallets=a,b (default: every vault wallet + the wallets of the asked mints' launches, so a dev deleted after its
 *  launch still counts) · ?mints=m1,m2 (default: launched + tracked mints) */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const st = store();
  const wallets = (q.get("wallets") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => requireAddress(a, "wallets"));
  const mints = (q.get("mints") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => requireAddress(a, "mints"));
  const asked = new Set(mints);
  const launchWallets = st.launches.filter((l) => asked.has(l.mint)).flatMap((l) => [l.dev, ...(l.wallets ?? [])]);
  const defaults = [...new Set([...st.sol.wallets.map((w) => w.address), ...launchWallets])];
  return json(await positions(wallets.length ? wallets : defaults, mints.length ? mints : [...new Set([...st.launches.map((l) => l.mint), ...st.tracked])]));
});
