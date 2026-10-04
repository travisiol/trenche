import { intIn, json, lamportsOf, readBody, route, solString } from "@/server/api";
import { publicSettings, saveSettings, store } from "@/server/store";
import { syncPumpCluster } from "@/server/pumpcluster";
import { normalizeSolanaRpc, isHeliusSender } from "@/engine/solana/config.js";
import type { SettingsUpdateRequest, TradingPreset, TradingPresets } from "@/lib/types";
import { TRADING_PRESET_DEFAULTS, TRADING_PRESET_LIMITS } from "@/lib/types";
import { HttpError } from "@/server/api";

export const dynamic = "force-dynamic";

/** Block X Trading Presets dialog: every field optional, validated with a readable 400 */
function validTradingPreset(raw: unknown, base: TradingPreset, n: number): TradingPreset {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<TradingPreset>;
  const what = `tradingPresets[P${n}]`;
  const four = <T,>(v: unknown, d: [T, T, T, T], map: (x: unknown, i: number) => T, name: string): [T, T, T, T] => {
    if (v === undefined) return d;
    if (!Array.isArray(v) || v.length !== 4) throw new HttpError(400, `${what}.${name}: exactly 4 values.`);
    return v.map(map) as [T, T, T, T];
  };
  const pct = (name: string) => (x: unknown, i: number) => {
    const v = Number(x);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new HttpError(400, `${what}.${name}[${i}]: 0..100 expected.`);
    return v;
  };
  const out: TradingPreset = {
    buyAmounts: four(p.buyAmounts, base.buyAmounts, (x, i) => solString(lamportsOf(x, `${what}.buyAmounts[${i}]`)), "buyAmounts"),
    buyPercents: four(p.buyPercents, base.buyPercents, pct("buyPercents"), "buyPercents"),
    sellPercents: four(p.sellPercents, base.sellPercents, pct("sellPercents"), "sellPercents"),
    slippagePercent: p.slippagePercent === undefined ? base.slippagePercent : pct("slippagePercent")(p.slippagePercent, 0),
    tipSol: p.tipSol === undefined ? base.tipSol : solString(lamportsOf(p.tipSol, `${what}.tipSol`, true)),
    buysValueSpreadPct: p.buysValueSpreadPct === undefined ? base.buysValueSpreadPct : pct("buysValueSpreadPct")(p.buysValueSpreadPct, 0),
    buysDelaySec: p.buysDelaySec === undefined ? base.buysDelaySec : Number(p.buysDelaySec),
  };
  if (out.slippagePercent > TRADING_PRESET_LIMITS.maxSlippagePercent) throw new HttpError(400, `${what}.slippagePercent: 0..${TRADING_PRESET_LIMITS.maxSlippagePercent}.`);
  if (!Number.isFinite(out.buysDelaySec) || out.buysDelaySec < 0 || out.buysDelaySec > TRADING_PRESET_LIMITS.maxDelaySec) throw new HttpError(400, `${what}.buysDelaySec: 0..${TRADING_PRESET_LIMITS.maxDelaySec} s.`);
  return out;
}

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
  if (body.tradingPresets !== undefined) {
    if (!Array.isArray(body.tradingPresets) || body.tradingPresets.length !== 3) throw new HttpError(400, "tradingPresets: exactly 3 presets (P1, P2, P3), each a partial TradingPreset.");
    const base = s.tradingPresets ?? TRADING_PRESET_DEFAULTS;
    s.tradingPresets = body.tradingPresets.map((p, i) => validTradingPreset(p, base[i], i + 1)) as TradingPresets;
    // legacy quick-buy amounts follow the presets' first amount
    s.presets = s.tradingPresets.map((p) => p.buyAmounts[0]) as [string, string, string];
  }
  if (body.keybinds !== undefined) {
    const k = body.keybinds;
    if (!k || !Array.isArray(k.quickBuy) || k.quickBuy.length !== 3) throw new HttpError(400, "keybinds.quickBuy: 3 keys.");
    s.keybinds = { quickBuy: k.quickBuy.map((x) => String(x).slice(0, 16)) as [string, string, string], close: String(k.close || "Escape").slice(0, 16) };
  }
  saveSettings(st);
  return json(publicSettings(s));
});
