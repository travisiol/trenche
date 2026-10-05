/* Priority fee and compute-unit limits for the trade transactions.
 *
 * CU limits are MEASURED (scripts/probe-cu.mjs: buy/sell built by the engine, simulated on live mainnet curves with
 * sigVerify:false, 2026-10-05): buy with a fresh ATA (idempotent create + first user-volume touch) 85.7k–105.1k CU,
 * buy on an existing ATA ~75.8k, sell ~60.8k (compute-budget + tip instructions included in the buy numbers).
 * The limits below keep ≥ 33 % headroom over the largest sample (a transaction that runs out of CU fails AND pays
 * its fee; the existing-ATA buy and the sell have one sample each, the cashback sell none). A smaller limit
 * means a smaller priority fee for the same µLamports/CU price (fee = price × limit) and an easier fit in a block.
 *
 * Priority fee: Helius getPriorityFeeEstimate (account keys = pump program + the mint's bonding curve, level
 * "High") when the read RPC is Helius, else getRecentPrioritizationFees on the same keys (75th percentile of the
 * non-zero fees), cached 5 s per mint, CAPPED at the Settings value (cuPrice is the ceiling, no longer a fixed
 * price) and floored at 10 000 µLamports so Sender always sees a priority fee. Any failure → the cap. */
import { PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM, bondingCurvePda } from "@/engine/solana/pump/pdas.js";
import { queuedFetch } from "./rpcqueue";
import { store } from "./store";

export const CU_LIMITS = {
  /** buy that creates the ATA (idempotent create, first trade of this wallet on the mint) — max measured 105.1k */
  buyNewAta: 140_000,
  /** buy on an ATA that exists — measured ~75.8k (one composite sample: generous headroom) */
  buyAtaExists: 110_000,
  /** measured ~60.8k (one composite sample: generous headroom) */
  sell: 100_000,
  /** cashback coins pass one more writable account (user volume accumulator) — not measured */
  sellCashback: 115_000,
} as const;

export const PRIORITY_FLOOR = 10_000;
const TTL = 5000;

export type PriorityFee = { microLamports: number; source: "helius" | "recent" | "cap"; estimate: number | null; cap: number; at: number };

type Raw = { value: number; source: "helius" | "recent" } | null;
type Entry = { at: number; raw: Raw };
type PrioGlobal = { cache: Map<string, Entry>; inflight: Map<string, Promise<Raw>> };
declare global {
  var __trenchPrio: PrioGlobal | undefined;
}
function g(): PrioGlobal {
  if (!globalThis.__trenchPrio) globalThis.__trenchPrio = { cache: new Map(), inflight: new Map() };
  return globalThis.__trenchPrio;
}

const isHelius = (url: string) => /helius-rpc\.com/i.test(url);

async function estimate(keys: string[]): Promise<Raw> {
  const url = store().sol.config.rpcUrl;
  if (isHelius(url)) {
    const res = await queuedFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getPriorityFeeEstimate", params: [{ accountKeys: keys, options: { priorityLevel: "High" } }] }),
    });
    const j = (await res.json().catch(() => null)) as { result?: { priorityFeeEstimate?: number } } | null;
    const v = j?.result?.priorityFeeEstimate;
    if (typeof v === "number" && Number.isFinite(v)) return { value: Math.round(v), source: "helius" };
  }
  const rows = await store().sol.connection().getRecentPrioritizationFees({ lockedWritableAccounts: keys.map((k) => new PublicKey(k)) });
  const fees = rows.map((r) => r.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
  if (!fees.length) return { value: 0, source: "recent" };
  return { value: fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))], source: "recent" };
}

function shape(raw: Raw, cap: number, at: number): PriorityFee {
  if (!raw) return { microLamports: cap, source: "cap", estimate: null, cap, at };
  return { microLamports: Math.min(cap, Math.max(Math.min(PRIORITY_FLOOR, cap), raw.value)), source: raw.source, estimate: raw.value, cap, at };
}

/** priority fee (µLamports / CU) for a trade on `mint`, capped at `cap`; cached 5 s, never throws */
export async function priorityFee(mint: string, cap: number): Promise<PriorityFee> {
  const s = g();
  const hit = s.cache.get(mint);
  if (hit && Date.now() - hit.at < TTL) return shape(hit.raw, cap, hit.at);
  let p = s.inflight.get(mint);
  if (!p) {
    const keys = [PUMP_PROGRAM, bondingCurvePda(new PublicKey(mint)).toBase58()];
    p = estimate(keys)
      .catch(() => null)
      .then((raw) => {
        // a failed estimate is cached too (5 s): a dead endpoint is not hammered on every click
        s.cache.set(mint, { at: Date.now(), raw });
        if (s.cache.size > 300) s.cache.delete(s.cache.keys().next().value!);
        return raw;
      })
      .finally(() => s.inflight.delete(mint));
    s.inflight.set(mint, p);
  }
  return shape(await p, cap, Date.now());
}

/** the cached estimate only (no RPC), up to 10 s old: the hot path uses it when the ticker refreshed it */
export function priorityFeeCached(mint: string, cap: number): PriorityFee | null {
  const hit = g().cache.get(mint);
  if (!hit || Date.now() - hit.at > TTL * 2) return null;
  return shape(hit.raw, cap, hit.at);
}
