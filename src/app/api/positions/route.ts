import { json, requireAddress, route } from "@/server/api";
import { positions } from "@/server/positions";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";

/** ?wallets=a,b (default: every vault wallet) · ?mints=m1,m2 (default: launched + tracked mints) */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const st = store();
  const wallets = (q.get("wallets") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => requireAddress(a, "wallets"));
  const mints = (q.get("mints") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => requireAddress(a, "mints"));
  return json(await positions(wallets.length ? wallets : st.sol.wallets.map((w) => w.address), mints.length ? mints : [...new Set([...st.launches.map((l) => l.mint), ...st.tracked])]));
});
