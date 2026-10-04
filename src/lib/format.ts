/** Number/address/time formatting shared by every page. Null in → "—" out, never a fake value. */

export const DASH = "—";

export function num(v: number | string | null | undefined, digits = 2): string {
  if (v === null || v === undefined || v === "") return DASH;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return DASH;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Compact USD: $1.2K · $4.7M */
export function usd(v: number | string | null | undefined, digits = 1): string {
  if (v === null || v === undefined || v === "") return DASH;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(digits)}K`;
  return `${sign}$${abs.toFixed(abs > 0 && abs < 1 ? 4 : 2)}`;
}

/** SOL with sensible precision: 0.0123 · 1.25 · 1,240 */
export function sol(v: number | string | null | undefined, digits?: number): string {
  if (v === null || v === undefined || v === "") return DASH;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  const d = digits ?? (abs >= 100 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6);
  return n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function signedSol(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return DASH;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return DASH;
  return `${n > 0 ? "+" : ""}${sol(n)}`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v.toFixed(digits)} %`;
}

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/** `pump…9Dfn` */
export function short(addr: string | null | undefined, head = 4, tail = 4): string {
  if (!addr) return DASH;
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Age from epoch ms: 37s · 4m · 1h 12m · 3d */
export function age(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return DASH;
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function time(ms: number | null | undefined): string {
  if (!ms) return DASH;
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateTime(ms: number | null | undefined): string {
  if (!ms) return DASH;
  return new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function solscanTx(sig: string) {
  return `https://solscan.io/tx/${sig}`;
}
export function solscanAccount(addr: string) {
  return `https://solscan.io/account/${addr}`;
}
export function pumpfunUrl(mint: string) {
  return `https://pump.fun/coin/${mint}`;
}

export function toNum(v: string | number | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : (v ?? NaN);
  return Number.isFinite(n) ? n : 0;
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function isMint(s: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}
