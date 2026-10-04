import { intIn, json, lamportsOf, readBody, route, solString } from "@/server/api";
import { publicSettings, saveSettings, store } from "@/server/store";
import { syncPumpCluster } from "@/server/pumpcluster";
import { normalizeSolanaRpc, isHeliusSender } from "@/engine/solana/config.js";
import type { SettingsUpdateRequest } from "@/lib/types";
import { HttpError } from "@/server/api";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await syncPumpCluster().catch(() => null);
  return json(publicSettings(store().settings));
});

export const POST = route(async (req: Request) => {
  const body = await readBody<SettingsUpdateRequest>(req);
  const st = store();
  const s = st.settings;
  if (body.cluster !== undefined) {
    if (body.cluster !== "mainnet" && body.cluster !== "devnet") throw new HttpError(400, "cluster must be \"mainnet\" or \"devnet\".");
    s.cluster = body.cluster;
  }
  if (body.rpcUrl !== undefined) {
    const u = normalizeSolanaRpc(String(body.rpcUrl));
    if (u && isHeliusSender(u)) throw new HttpError(400, "The read RPC cannot be a Sender endpoint (…/fast): put it in the send RPC field.");
    if (u && !/^https?:\/\//.test(u)) throw new HttpError(400, "rpcUrl must be an http(s) URL or a Helius api key.");
    s.rpcUrl = u;
  }
  if (body.sendRpcUrl !== undefined) {
    const u = String(body.sendRpcUrl).trim();
    if (u && !/^https?:\/\//.test(u)) throw new HttpError(400, "sendRpcUrl must be an http(s) URL.");
    s.sendRpcUrl = u;
  }
  if (body.pumpportalKey !== undefined) s.pumpportalKey = String(body.pumpportalKey).trim();
  if (body.heliusKey !== undefined) s.heliusKey = String(body.heliusKey).trim();
  if (body.jitoEnabled !== undefined) s.jitoEnabled = !!body.jitoEnabled;
  if (body.slippageBps !== undefined) s.slippageBps = intIn(body.slippageBps, 0, 9000, 1000, "slippageBps");
  if (body.cuPrice !== undefined) s.cuPrice = intIn(body.cuPrice, 0, 50_000_000, 2_000_000, "cuPrice");
  if (body.tipSol !== undefined) s.tipSol = solString(lamportsOf(body.tipSol, "tipSol", true));
  if (body.presets !== undefined) {
    if (!Array.isArray(body.presets) || body.presets.length !== 3) throw new HttpError(400, "presets: exactly 3 SOL amounts.");
    s.presets = body.presets.map((p, i) => solString(lamportsOf(p, `presets[${i}]`))) as [string, string, string];
  }
  if (body.keybinds !== undefined) {
    const k = body.keybinds;
    if (!k || !Array.isArray(k.quickBuy) || k.quickBuy.length !== 3) throw new HttpError(400, "keybinds.quickBuy: 3 keys.");
    s.keybinds = { quickBuy: k.quickBuy.map((x) => String(x).slice(0, 16)) as [string, string, string], close: String(k.close || "Escape").slice(0, 16) };
  }
  saveSettings(st);
  return json(publicSettings(s));
});
