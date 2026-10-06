import { parseEther } from "viem";
import { bad } from "../api";

/** a positive ETH amount ("0.01", "0,01") in wei */
export function weiOf(v: unknown): bigint {
  const s = String(v ?? "").replace(",", ".").trim();
  if (!/^\d*\.?\d+$/.test(s)) bad("amount: an ETH amount.");
  const w = parseEther(s);
  if (w <= BigInt(0)) bad("amount: must be > 0.");
  return w;
}
