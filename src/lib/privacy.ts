/* Privacy funding plan math, shared by the server (funds.ts) and the Portfolio drawers so the preview and the job
 * use the same rules:
 *  - amounts: equal share ×(1 ± variation) at random, then rescaled in integer lamports so Σ = total EXACTLY;
 *  - order: Fisher–Yates shuffle;
 *  - delays: one uniform random draw in [min, max] before every payment after the first. */

export const LAMPORTS_PER_SOL = 1_000_000_000;
/** per-transfer reserve the server checks against (5 000 base fee + priority-fee headroom) */
export const TX_FEE_MARGIN_LAM = 12_000;
/** the relay's own transfer fee (hop 2 is sent without priority fee) */
export const RELAY_FEE_LAM = 5_000;
/** a fresh relay account must receive at least the rent-exempt minimum or hop 1 is refused by the runtime */
export const RENT_MIN_LAM = 890_880;
/** longest random delay accepted between two payments */
export const MAX_DELAY_SEC = 86_400;
export const MAX_PARTS = 5;

export type Rng = () => number;

/** deterministic PRNG (preview re-rolls); the server uses Math.random */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** split `total` lamports into `n` amounts: ±variationPct around the equal share, rescaled so the sum is exact */
export function splitLamports(total: bigint, n: number, variationPct: number, rnd: Rng = Math.random): bigint[] {
  if (n <= 0) return [];
  const v = Math.max(0, Math.min(100, variationPct)) / 100;
  // integer weights (1e6 = the equal share) so the rescale is pure bigint arithmetic
  const w = Array.from({ length: n }, () => BigInt(Math.round(1_000_000 * (v > 0 ? Math.max(0.02, 1 + v * (rnd() * 2 - 1)) : 1))));
  const sum = w.reduce((s, x) => s + x, BigInt(0));
  const out = w.map((x) => (total * x) / sum);
  // hand the flooring remainder (< n lamports) out one lamport at a time
  let left = total - out.reduce((s, x) => s + x, BigInt(0));
  for (let i = 0; left > BigInt(0); i = (i + 1) % n, left -= BigInt(1)) out[i] += BigInt(1);
  return out;
}

export function shuffled<T>(arr: readonly T[], rnd: Rng = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type DelayRange = { minMs: number; maxMs: number };

/** one random delay per payment; the first payment leaves at once (0), every next one waits a draw in [min, max] */
export function randomDelays(n: number, r: DelayRange, rnd: Rng = Math.random): number[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 0 : Math.round(r.minMs + rnd() * Math.max(0, r.maxMs - r.minMs))));
}

export const lamToSol = (l: bigint): string => {
  const whole = l / BigInt(LAMPORTS_PER_SOL);
  const frac = (l % BigInt(LAMPORTS_PER_SOL)).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""}`;
};

/** decimal SOL string → lamports, null when not a positive decimal */
export function solToLam(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d*\.?\d*$/.test(t) || !/\d/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole || "0") * BigInt(LAMPORTS_PER_SOL) + BigInt((frac + "000000000").slice(0, 9));
}

/** "45 s", "3 min 20 s", "2 h 05 min" */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "20–90 s" / "2–5 min" / "none" */
export function fmtRange(r: DelayRange): string {
  if (r.maxMs <= 0) return "none";
  const minute = r.minMs % 60_000 === 0 && r.maxMs % 60_000 === 0 && r.maxMs >= 60_000;
  const f = (ms: number) => (minute ? String(ms / 60_000) : String(Math.round(ms / 1000)));
  return r.minMs === r.maxMs ? `${f(r.maxMs)} ${minute ? "min" : "s"}` : `${f(r.minMs)}–${f(r.maxMs)} ${minute ? "min" : "s"}`;
}
