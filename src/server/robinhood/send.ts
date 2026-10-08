/* Signed-transaction plumbing for Robinhood Chain (Arbitrum Orbit, FCFS sequencer, ~100 ms blocks):
 *  · sendRaw: eth_sendRawTransaction to the sequencer, the public RPC on a network error;
 *  · sendConditional: eth_sendRawTransactionConditional — the sequencer refuses the transaction ("Storage slot value
 *    condition not met") until the storage we name holds what we expect. A bundle buy is guarded with
 *    {curve: {slot 0: token}}: it can never land before its curve exists (a plain transfer to the not-yet-created curve
 *    address would lose the ETH). Proven on mainnet 2026-10-08: both endpoints answer -32003 for an unmet condition;
 *  · fees: maxFee = 3 × base fee (≥ 0.05 gwei), no tip — the sequencer orders by arrival, not by price. */
import { keccak256, type Hex } from "viem";
import { SEND_URLS, rhPublic } from "./chain";

type RpcAnswer = { result?: unknown; error?: { code?: number; message?: string }; status: number; network?: string };

async function rpc(url: string, method: string, params: unknown[], timeout = 6000): Promise<RpcAnswer> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { result?: unknown; error?: { code?: number; message?: string } };
      return { ...j, status: res.status };
    } catch {
      return { status: res.status, network: `HTTP ${res.status}: ${text.slice(0, 80)}` };
    }
  } catch (e) {
    return { status: 0, network: e instanceof Error ? e.message : String(e) };
  }
}

const KNOWN = /already known|already exists|known transaction|nonce too low/i;

/** send a signed transaction; resolves with its hash once a node accepted it (an "already known" counts as accepted) */
export async function sendRaw(tx: Hex): Promise<Hex> {
  const hash = keccak256(tx);
  let last = "";
  for (const url of SEND_URLS) {
    const r = await rpc(url, "eth_sendRawTransaction", [tx]);
    if (typeof r.result === "string") return r.result as Hex;
    const msg = r.error?.message ?? r.network ?? `HTTP ${r.status}`;
    if (r.error && KNOWN.test(msg)) return hash;
    last = msg;
    // a refusal of the transaction itself (funds, gas, fee): the next node would say the same
    if (/insufficient funds|intrinsic gas|underpriced|less than block base fee|gas limit|execution reverted|invalid sender|chain ?id/i.test(msg)) break;
  }
  throw new Error(last || "No Robinhood node accepted the transaction.");
}

export type ConditionalResult = { ok: true; hash: Hex } | { ok: false; reason: "not-ready" | "unsupported" | "rate-limited" | "network" | "fatal"; message: string };

export async function sendConditional(tx: Hex, knownAccounts: Record<string, Record<string, Hex>>): Promise<ConditionalResult> {
  const r = await rpc(SEND_URLS[0], "eth_sendRawTransactionConditional", [tx, { knownAccounts }]);
  if (typeof r.result === "string") return { ok: true, hash: r.result as Hex };
  if (r.status === 429) return { ok: false, reason: "rate-limited", message: "HTTP 429" };
  if (r.network) return { ok: false, reason: "network", message: r.network };
  const msg = String(r.error?.message ?? "");
  if (KNOWN.test(msg)) return { ok: true, hash: keccak256(tx) };
  if (/condition not met|conditions check failed/i.test(msg)) return { ok: false, reason: "not-ready", message: msg };
  if (r.error?.code === -32601 || /does not exist|not available|not supported|unknown method|unsupported/i.test(msg)) return { ok: false, reason: "unsupported", message: msg };
  if (/too many requests|rate ?limit/i.test(msg)) return { ok: false, reason: "rate-limited", message: msg };
  return { ok: false, reason: "fatal", message: msg.slice(0, 200) };
}

/** {curve: {slot 0: token}} — a Pons V2 curve keeps its token in storage slot 0 (read on mainnet 2026-10-08) */
export function curveGuard(curve: string, token: string): Record<string, Record<string, Hex>> {
  return { [curve.toLowerCase()]: { [`0x${"0".repeat(64)}`]: `0x${"0".repeat(24)}${token.replace(/^0x/i, "").toLowerCase()}` as Hex } };
}

export async function feeCaps(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const b = await rhPublic().getBlock({ blockTag: "latest" });
  const base = b.baseFeePerGas ?? BigInt(20_000_000);
  const floor = BigInt(50_000_000); // 0.05 gwei
  const max = base * BigInt(3) > floor ? base * BigInt(3) : floor;
  return { maxFeePerGas: max, maxPriorityFeePerGas: BigInt(0) };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
