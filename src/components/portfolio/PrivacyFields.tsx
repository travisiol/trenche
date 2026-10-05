"use client";
/** Shared Privacy funding fields: random delay range (min–max, seconds or minutes), the relay switch with its honest
 *  one-liner, and the plan summary line used by Disperse / Reverse Disperse / Private send. */
import { MAX_DELAY_SEC, fmtDuration, type DelayRange } from "@/lib/privacy";
import { BxSwitch, cx } from "@/components/bx/ui";

export type DelayUnit = "s" | "min";
export type DelayDraft = { min: string; max: string; unit: DelayUnit };
export const DEFAULT_DELAY: DelayDraft = { min: "20", max: "90", unit: "s" };

/** draft → seconds + range (ms) + a readable error (min > max, beyond 24 h) */
export function readDelay(d: DelayDraft): { minSec: number; maxSec: number; range: DelayRange; error: string | null } {
  const k = d.unit === "min" ? 60 : 1;
  const lo = (Number(d.min) || 0) * k;
  const hi = d.max.trim() === "" ? lo : (Number(d.max) || 0) * k;
  const error = lo > hi ? "Delay: min must be ≤ max." : hi > MAX_DELAY_SEC ? "Delay: 24 h max." : null;
  return { minSec: lo, maxSec: hi, range: { minMs: lo * 1000, maxMs: hi * 1000 }, error };
}

/** "20–90 s", "2–5 min", "none" */
export function delayText(d: DelayDraft): string {
  const r = readDelay(d);
  if (r.maxSec <= 0) return "no delay";
  const a = d.min || "0";
  const b = d.max || a;
  return a === b ? `${a} ${d.unit}` : `${a}–${b} ${d.unit}`;
}

/** presets / server values (seconds) → draft, in minutes when both ends are whole minutes ≥ 1 */
export function draftFromSec(minSec: number, maxSec: number): DelayDraft {
  if (maxSec >= 60 && minSec % 60 === 0 && maxSec % 60 === 0) return { min: String(minSec / 60), max: String(maxSec / 60), unit: "min" };
  return { min: String(minSec), max: String(maxSec), unit: "s" };
}

const input = "h-8 w-full min-w-0 border border-line-100 bg-bg-50 px-2 text-right font-mono text-xs text-text-100 outline-none focus:border-accent";

export function DelayRangeField({ value, onChange, label = "Random delay before each payment", hint }: { value: DelayDraft; onChange: (v: DelayDraft) => void; label?: string; hint?: string }) {
  const r = readDelay(value);
  const clean = (s: string) => s.replace(/[^0-9.]/g, "");
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-text-300">{label}</span>
        <div className="flex h-6 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
          {(["s", "min"] as const).map((u) => (
            <button key={u} type="button" onClick={() => onChange({ ...value, unit: u })} className={cx("h-full rounded px-2 text-[10px] font-medium transition-colors", value.unit === u ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
              {u === "s" ? "seconds" : "minutes"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input value={value.min} onChange={(e) => onChange({ ...value, min: clean(e.target.value) })} inputMode="decimal" className={input} aria-label="Minimum delay" placeholder="min" />
        <span className="text-xs text-text-300">to</span>
        <input value={value.max} onChange={(e) => onChange({ ...value, max: clean(e.target.value) })} inputMode="decimal" className={input} aria-label="Maximum delay" placeholder="max" />
        <span className="w-8 shrink-0 text-xs text-text-300">{value.unit}</span>
      </div>
      <p className={cx("mt-1 text-[11px]", r.error ? "text-decrease" : "text-text-300")}>{r.error ?? hint ?? (r.maxSec > 0 ? `After the first, each one waits a random ${fmtDuration(r.range.minMs)}–${fmtDuration(r.range.maxMs)}.` : "0 = one payment right after the other.")}</p>
    </div>
  );
}

export function PrivacyRelaySwitch({ checked, onChange, what = "payment" }: { checked: boolean; onChange: (v: boolean) => void; what?: string }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-xs">
      <span>
        <span className="font-medium text-text-100">Privacy: each {what} goes through its own fresh relay wallet</span>
        <span className="block text-[11px] text-text-300">Breaks the direct link only — the relay addresses stay visible on-chain.</span>
      </span>
      <BxSwitch checked={checked} onChange={onChange} />
    </label>
  );
}

/** the one-line plan summary + an optional Available / needed row (red when short) */
export function PlanSummary({ line, available, needed, problem }: { line: string; available?: string | null; needed?: string | null; problem?: string | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-xs">
      <p className="leading-relaxed text-text-100">{line}</p>
      {available !== undefined || needed !== undefined ? (
        <p className={cx("font-mono tabular-nums", problem ? "text-decrease" : "text-text-300")}>
          {available !== undefined ? `Available ${available ?? "—"} SOL` : ""}
          {available !== undefined && needed !== undefined ? " · " : ""}
          {needed !== undefined ? `needed ${needed ?? "—"} SOL` : ""}
        </p>
      ) : null}
      {problem ? <p className="text-decrease">{problem}</p> : null}
    </div>
  );
}

/** drawn plan table: execution order, amount, wait before */
export function PlanTable({ rows, title }: { rows: { label: string; address?: string; sol: string; delayMs?: number }[]; title?: string }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-line-100">
      {title ? <div className="border-b border-line-50 px-3 py-1.5 text-[11px] text-text-300">{title}</div> : null}
      <div className="max-h-56 overflow-y-auto">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 border-b border-line-50 px-3 py-1 text-xs last:border-0">
            <span className="w-5 shrink-0 font-mono text-[10px] text-text-300">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-text-100">{r.label}</span>
            {r.delayMs !== undefined ? <span className="shrink-0 font-mono text-[11px] text-text-300">{i === 0 ? "now" : `+${fmtDuration(r.delayMs)}`}</span> : null}
            <span className="w-28 shrink-0 text-right font-mono text-[11px] text-text-100">{r.sol} SOL</span>
          </div>
        ))}
      </div>
    </div>
  );
}
