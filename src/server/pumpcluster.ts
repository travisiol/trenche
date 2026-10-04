/* pump.fun constants per cluster. The engine hardcodes MAINNET values (fee recipients, fresh-curve reserves);
 * the devnet deployment of the same program (6EF8…) uses OTHER fee recipients and a 1 SOL virtual reserve
 * (read on 2026-10-04 from the Global PDA 4wTV…xnjf: mainnet 1087 B, devnet 1088 B). The engine exports those
 * constants as mutable arrays/objects, so we swap their CONTENTS here instead of editing the engine.
 * Global layout (IDL): disc 8 · initialized u8 · authority · fee_recipient · ivt u64 · ivs u64 · irt u64 ·
 * supply u64 · fee_bps u64 · withdraw_authority · enable_migrate u8 · pool_migration_fee u64 ·
 * creator_fee_bps u64 · fee_recipients[7] · … ; the second recipient list (buy/sell account 17) sits at
 * offset 741 (8 keys) and is identical on both clusters. */
import { PublicKey } from "@solana/web3.js";
import { FRESH_CURVE } from "@/engine/solana/pump/math.js";
import { PUMP_BUYBACK_FEE_RECIPIENTS, PUMP_FEE_RECIPIENTS, globalPda } from "@/engine/solana/pump/pdas.js";
import { HttpError } from "./api";
import { readConn } from "./engine";
import { store } from "./store";

/** engine defaults = mainnet (verified identical to the mainnet Global on 2026-10-04) */
const MAINNET_RECIPIENTS_1 = [...PUMP_BUYBACK_FEE_RECIPIENTS]; // buy/sell account 1 (`fee_recipient`)
const MAINNET_RECIPIENTS_2 = [...PUMP_FEE_RECIPIENTS]; // buy/sell account 17
const MAINNET_FRESH = { ...FRESH_CURVE };

export type PumpClusterInfo = {
  cluster: "mainnet" | "devnet";
  rpcUrl: string;
  feeRecipients: string[];
  secondRecipients: string[];
  initialVirtualSol: string;
  initialVirtualTokens: string;
  initialRealTokens: string;
  at: number;
};

function apply(info: Omit<PumpClusterInfo, "at" | "cluster" | "rpcUrl">): void {
  PUMP_BUYBACK_FEE_RECIPIENTS.splice(0, PUMP_BUYBACK_FEE_RECIPIENTS.length, ...info.feeRecipients);
  PUMP_FEE_RECIPIENTS.splice(0, PUMP_FEE_RECIPIENTS.length, ...info.secondRecipients);
  FRESH_CURVE.virtualSolReserves = BigInt(info.initialVirtualSol);
  FRESH_CURVE.virtualTokenReserves = BigInt(info.initialVirtualTokens);
  FRESH_CURVE.realTokenReserves = BigInt(info.initialRealTokens);
}

/** make the engine's pump.fun constants match the active cluster (cached until cluster/RPC changes) */
export async function syncPumpCluster(): Promise<PumpClusterInfo> {
  const st = store();
  const cluster = st.settings.cluster;
  const rpcUrl = st.sol.config.rpcUrl;
  const cached = st.runtime.pumpCluster as PumpClusterInfo | undefined;
  if (cached && cached.cluster === cluster && cached.rpcUrl === rpcUrl) return cached;
  let info: PumpClusterInfo;
  if (cluster === "mainnet") {
    info = { cluster, rpcUrl, feeRecipients: MAINNET_RECIPIENTS_1, secondRecipients: MAINNET_RECIPIENTS_2, initialVirtualSol: MAINNET_FRESH.virtualSolReserves.toString(), initialVirtualTokens: MAINNET_FRESH.virtualTokenReserves.toString(), initialRealTokens: MAINNET_FRESH.realTokenReserves.toString(), at: Date.now() };
  } else {
    const acc = await readConn().getAccountInfo(globalPda(), "confirmed");
    if (!acc) throw new HttpError(503, `pump.fun Global account not found on ${cluster} (${rpcUrl}): the program is not initialized there.`);
    const b = Buffer.from(acc.data);
    if (b.length < 1000) throw new HttpError(503, `pump.fun Global on ${cluster} is ${b.length} bytes: unexpected layout.`);
    const pk = (o: number) => new PublicKey(b.subarray(o, o + 32)).toBase58();
    const feeRecipients = [pk(41), ...Array.from({ length: 7 }, (_, i) => pk(162 + 32 * i))];
    const secondRecipients = Array.from({ length: 8 }, (_, i) => pk(741 + 32 * i));
    info = { cluster, rpcUrl, feeRecipients, secondRecipients, initialVirtualTokens: b.readBigUInt64LE(73).toString(), initialVirtualSol: b.readBigUInt64LE(81).toString(), initialRealTokens: b.readBigUInt64LE(89).toString(), at: Date.now() };
  }
  apply(info);
  st.runtime.pumpCluster = info;
  return info;
}
