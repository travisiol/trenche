import { Keypair } from "@solana/web3.js";
import { FRESH_CURVE, planBuys, type BuyRow } from "@/engine/solana/pump/math.js";
import { TOTAL_FEE_BPS } from "@/engine/solana/pump/pdas.js";
import { HttpError, json, lamportsOf, route, solString } from "@/server/api";
import { PUMP_SUPPLY_TOKENS } from "@/server/engine";
import { solPrice } from "@/server/price";
import { syncPumpCluster } from "@/server/pumpcluster";
import { store } from "@/server/store";
import type { LaunchCalcResponse, LaunchCalcRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/launch/calc?devBuySol=1&buys=0.5,0.5 — Block X "Bundle calculator — Pump.fun curve": each row buys on the
 *  curve the previous rows left (engine planBuys on FRESH_CURVE of the active cluster, after the pump.fun fee). */
export const GET = route(async (req: Request) => {
  const u = new URL(req.url);
  const dev = u.searchParams.get("devBuySol") ?? "0";
  const buysRaw = (u.searchParams.get("buys") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (buysRaw.length > 4) throw new HttpError(400, "buys: at most 4 bundle wallets.");
  const amounts = [lamportsOf(dev, "devBuySol", true), ...buysRaw.map((b, i) => lamportsOf(b, `buys[${i}]`))];
  // the engine's FRESH_CURVE follows the active cluster (devnet has a 1 SOL virtual reserve); unreachable RPC → mainnet values
  const info = await syncPumpCluster().catch(() => null);
  const curve = { ...FRESH_CURVE };
  const feeBps = TOTAL_FEE_BPS;
  const rows: BuyRow[] = amounts.map((solIn, i) => ({ label: i === 0 ? "Dev buy" : `Buy ${i}`, signer: Keypair.generate(), solIn, cuPrice: 0 }));
  const plans = planBuys(rows.filter((r) => r.solIn > BigInt(0)), curve, 0, feeBps);
  const supply = BigInt(PUMP_SUPPLY_TOKENS) * BigInt(1_000_000);
  const pct = (tokens: bigint) => Number((tokens * BigInt(1_000_000)) / supply) / 10_000;
  let cumTokens = BigInt(0);
  let cumSol = BigInt(0);
  let vSol = curve.virtualSolReserves;
  let vTok = curve.virtualTokenReserves;
  let k = 0;
  const out: LaunchCalcRow[] = rows.map((r, i) => {
    if (r.solIn <= BigInt(0)) return { index: i, label: r.label, solIn: "0", tokens: "0", supplyPct: 0, cumulativeSupplyPct: pct(cumTokens), cumulativeSol: solString(cumSol), solToCurve: "0" };
    const p = plans[k++];
    const toCurve = r.solIn <= BigInt(1) ? BigInt(0) : ((r.solIn - BigInt(1)) * BigInt(10000)) / (feeBps + BigInt(10000));
    cumTokens += p.expectedTokens;
    cumSol += r.solIn;
    vSol += toCurve;
    vTok -= p.expectedTokens;
    return { index: i, label: r.label, solIn: solString(r.solIn), tokens: (Number(p.expectedTokens) / 1e6).toString(), supplyPct: pct(p.expectedTokens), cumulativeSupplyPct: pct(cumTokens), cumulativeSol: solString(cumSol), solToCurve: solString(toCurve) };
  });
  const priceSol = Number(vSol) / 1e9 / (Number(vTok) / 1e6);
  const marketCapSol = priceSol * PUMP_SUPPLY_TOKENS;
  const usd = (await solPrice().catch(() => null))?.usd ?? null;
  const res: LaunchCalcResponse = {
    cluster: info?.cluster ?? store().settings.cluster,
    rows: out,
    total: { solIn: solString(cumSol), tokens: (Number(cumTokens) / 1e6).toString(), supplyPct: pct(cumTokens) },
    marketCapSol,
    marketCapUsd: usd ? marketCapSol * usd : null,
    curve: { virtualSol: solString(curve.virtualSolReserves), virtualTokens: (Number(curve.virtualTokenReserves) / 1e6).toString(), realTokens: (Number(curve.realTokenReserves) / 1e6).toString(), totalSupply: String(PUMP_SUPPLY_TOKENS), feeBps: Number(feeBps) },
  };
  return json(res);
});
