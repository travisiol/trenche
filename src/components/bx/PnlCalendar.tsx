"use client";
/** Block X "PNL Calendar": one month grid, per-day realised PnL from this app's activity journal (sells − buys). */
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ActivityItem } from "@/lib/types";
import { cx } from "./ui";

export type DayPnl = { date: string; sol: number; trades: number };

/** Realised SOL per UTC day from journaled buy/sell entries (`data.side`, `data.solTotal`). */
export function dailyPnl(items: ActivityItem[]): Map<string, DayPnl> {
  const out = new Map<string, DayPnl>();
  for (const a of items) {
    const side = a.data?.side;
    const sol = Number(a.data?.solTotal);
    if ((side !== "buy" && side !== "sell") || !Number.isFinite(sol)) continue;
    const date = new Date(a.at).toISOString().slice(0, 10);
    const d = out.get(date) ?? { date, sol: 0, trades: 0 };
    d.sol += side === "sell" ? sol : -sol;
    d.trades++;
    out.set(date, d);
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PnlCalendar({ days, solUsd, unit, className }: { days: Map<string, DayPnl>; solUsd: number | null; unit: "USD" | "SOL"; className?: string }) {
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getUTCFullYear(), now.getUTCMonth()]);
  const [y, m] = ym;
  const first = new Date(Date.UTC(y, m, 1));
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const isCurrent = y === now.getUTCFullYear() && m === now.getUTCMonth();
  const fmt = (sol: number) => (unit === "USD" && solUsd ? `${sol < 0 ? "-" : ""}$${Math.abs(sol * solUsd).toFixed(Math.abs(sol * solUsd) < 10 ? 2 : 0)}` : `${sol < 0 ? "-" : ""}${Math.abs(sol).toFixed(Math.abs(sol) < 1 ? 3 : 2)}${unit === "SOL" || !solUsd ? " SOL" : ""}`);
  const cells: (DayPnl | null)[] = [];
  let total = 0, wins = 0, winSol = 0, losses = 0, lossSol = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const v = days.get(key) ?? { date: key, sol: 0, trades: 0 };
    cells.push(v);
    total += v.sol;
    if (v.sol > 0) { wins++; winSol += v.sol; }
    if (v.sol < 0) { losses++; lossSol += v.sol; }
  }
  // streaks
  let best = 0, run = 0;
  for (const c of cells) { run = c && c.sol > 0 ? run + 1 : 0; best = Math.max(best, run); }
  let current = 0;
  if (isCurrent) {
    for (let d = now.getUTCDate() - 1; d >= 0; d--) { if (cells[d] && cells[d]!.sol > 0) current++; else break; }
  }
  const share = wins + losses ? (wins / (wins + losses)) * 100 : 0;
  const prev = () => setYm(([yy, mm]) => (mm === 0 ? [yy - 1, 11] : [yy, mm - 1]));
  const next = () => !isCurrent && setYm(([yy, mm]) => (mm === 11 ? [yy + 1, 0] : [yy, mm + 1]));
  const rows = Math.ceil((lead + daysInMonth) / 7) * 7;

  return (
    <div className={cx("relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent font-bold text-text-100", className)}>
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="shrink-0 text-[14px] font-bold text-text-100">PNL Calendar</h2>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="flex w-[148px] items-center justify-between gap-1">
              <button type="button" onClick={prev} className="rounded p-1 text-text-300 transition-colors hover:bg-hover-100 hover:text-text-100" aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-0 truncate text-center text-[11px] font-bold text-text-100">
                {MONTHS[m]} {y} UTC+0
              </span>
              <button type="button" onClick={next} className={cx("rounded p-1 transition-colors", isCurrent ? "cursor-not-allowed text-text-300/40" : "text-text-300 hover:bg-hover-100 hover:text-text-100")} aria-label="Next month" disabled={isCurrent}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="shrink-0 px-2 py-1.5 sm:px-4">
          <div className={cx("mb-1.5 flex items-center gap-1.5 text-start text-[16px] leading-5 tabular-nums", total < 0 ? "text-decrease" : "text-increase")}>{fmt(total)}</div>
          <div className="relative mb-1.5 h-1 overflow-hidden rounded-full bg-line-50">
            <div className="absolute inset-y-0 left-0 bg-increase" style={{ width: `${share}%` }} />
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <div className="flex items-center tabular-nums text-increase">
              <span>{wins}</span>
              <span className="text-text-300">&nbsp;/&nbsp;</span>
              <span>{fmt(winSol)}</span>
            </div>
            <div className="flex items-center tabular-nums text-decrease">
              <span>{losses}</span>
              <span className="text-text-300">&nbsp;/&nbsp;</span>
              <span>{fmt(lossSol)}</span>
            </div>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-7 gap-0.5 px-2 text-center text-[9px] leading-[12px] text-text-300 sm:px-4">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="mb-2 h-px bg-line-50" />
        <div className="grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] grid-cols-7 gap-0.5 px-2 pb-1 sm:px-4">
          {Array.from({ length: rows }).map((_, i) => {
            const d = i - lead;
            const c = d >= 0 && d < daysInMonth ? cells[d] : null;
            if (!c) return <div key={i} className="min-h-0" />;
            const tone = c.sol > 0 ? "increase" : c.sol < 0 ? "decrease" : "flat";
            return (
              <button
                key={i}
                type="button"
                className="relative flex min-h-0 cursor-default flex-col items-center justify-center rounded border border-transparent p-0.5 pt-3 transition-colors duration-200 sm:p-1"
                style={{ backgroundColor: tone === "increase" ? "color-mix(in srgb, var(--increase) 22%, transparent)" : tone === "decrease" ? "color-mix(in srgb, var(--decrease) 22%, transparent)" : "color-mix(in srgb, var(--text-100) 6%, transparent)" }}
                title={`${c.date}: ${fmt(c.sol)}${c.trades ? ` · ${c.trades} trades` : ""} — net SOL that moved this day: trades, launch costs and creator fees counted the day they were claimed`}
              >
                <div className="absolute left-0.5 top-0.5 text-[9px] font-medium leading-[12px] text-text-300 sm:left-1 sm:text-[10px] sm:leading-[14px]">{d + 1}</div>
                <div className={cx("flex min-w-0 max-w-full items-center justify-center gap-0.5 overflow-hidden text-[10px] leading-3 tabular-nums sm:text-[14px] sm:leading-4", tone === "increase" ? "text-increase" : tone === "decrease" ? "text-decrease" : "text-text-200")}>
                  <span className="sm:hidden">{c.sol ? fmt(c.sol) : "0"}</span>
                  <span className="hidden sm:inline">{c.sol ? fmt(c.sol) : unit === "USD" && solUsd ? "$0" : "0"}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-auto flex shrink-0 items-center justify-between gap-3 px-2 pb-2 pt-1 text-[11px] leading-4 sm:px-4">
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-text-300">
            <span>
              Current Positive Streak: <span className="text-text-100">{current}d</span>
            </span>
            <span>
              Best Positive Streak in {MONTHS[m]}: <span className="text-text-100">{best}d</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
