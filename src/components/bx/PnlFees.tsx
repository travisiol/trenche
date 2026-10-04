"use client";
/** "Fees −x SOL · Rewards +y SOL" line under a Net PnL figure, with the full breakdown on hover (title) and on click. */
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FeeBreakdown, PnlWindow } from "@/lib/types";
import { cx } from "./ui";

const ROWS: [keyof FeeBreakdown, string][] = [
  ["networkSol", "Network (signature) fees"],
  ["priorityTipSol", "Priority fees"],
  ["jitoTipSol", "Jito tips"],
  ["pumpTradeFeeSol", "pump.fun trade fees"],
  ["rentSol", "Token-account rent (net of refunds)"],
  ["launchSol", "Launch creation (mint, curve, metadata rent)"],
  ["transferFeeSol", "Transfers, relays, disperse fees"],
];

export function fmtSigned(sol: number, solUsd: number | null, unit: "USD" | "SOL", digits = 4): string {
  const sign = sol > 0 ? "+" : sol < 0 ? "-" : "";
  const abs = Math.abs(sol);
  if (unit === "USD" && solUsd) return `${sign}$${(abs * solUsd).toFixed(abs * solUsd < 10 ? 2 : 2)}`;
  return `${sign}${abs.toFixed(digits)} SOL`;
}

export function PnlFees({ pnl, solUsd, unit, className, compact }: { pnl: PnlWindow | undefined; solUsd: number | null; unit: "USD" | "SOL"; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!pnl) return null;
  const f = pnl.fees;
  const cost = Number(f.totalCostSol);
  const rewards = Number(f.creatorFeesClaimedSol);
  const pending = f.creatorFeesPendingSol === null ? null : Number(f.creatorFeesPendingSol);
  const other = Number(pnl.otherSol);
  const title = [...ROWS.map(([k, l]) => `${l}: ${fmtSigned(-Number(f[k]), null, "SOL")}`), `Creator fees claimed: ${fmtSigned(rewards, null, "SOL")}`, pending !== null ? `Creator fees pending (not counted): ${pending.toFixed(4)} SOL` : "", other ? `Other SOL movements: ${fmtSigned(other, null, "SOL")}` : ""].filter(Boolean).join("\n");
  return (
    <div className={cx("min-w-0", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} title={title} className={cx("inline-flex max-w-full items-center gap-1 rounded text-text-300 transition-colors hover:text-text-100", compact ? "text-[12px]" : "text-[13px]")}>
        <span className="truncate">
          Fees <span className="tabular-nums text-decrease">{fmtSigned(-cost, solUsd, unit)}</span>
          {rewards > 0 ? (
            <>
              {" · "}Rewards <span className="tabular-nums text-increase">{fmtSigned(rewards, solUsd, unit)}</span>
            </>
          ) : null}
          {pending !== null && pending > 0 ? <span className="text-text-300"> · {pending.toFixed(4)} SOL pending</span> : null}
          {pnl.estimated ? <span className="text-yellow-100"> · syncing</span> : null}
        </span>
        {open ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
      </button>
      {open ? (
        <dl className={cx("mt-1.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 rounded-md border border-line-100 bg-bg-100 px-3 py-2 tabular-nums", compact ? "text-[11px]" : "text-[12px]")}>
          {ROWS.map(([k, l]) => (
            <Row key={k} label={l} value={-Number(f[k])} solUsd={solUsd} unit={unit} />
          ))}
          <Row label="Total costs" value={-cost} solUsd={solUsd} unit={unit} strong />
          <Row label="Creator fees claimed" value={rewards} solUsd={solUsd} unit={unit} />
          {pending !== null ? <Row label="Creator fees pending (not counted)" value={pending} solUsd={solUsd} unit={unit} muted /> : null}
          {other ? <Row label="Other SOL movements (rent refunds…)" value={other} solUsd={solUsd} unit={unit} /> : null}
          <Row label="Gross trading (sells − buys)" value={Number(pnl.realisedSol)} solUsd={solUsd} unit={unit} />
          <Row label="Net PnL" value={Number(pnl.netSol)} solUsd={solUsd} unit={unit} strong />
        </dl>
      ) : null}
    </div>
  );
}

function Row({ label, value, solUsd, unit, strong, muted }: { label: string; value: number; solUsd: number | null; unit: "USD" | "SOL"; strong?: boolean; muted?: boolean }) {
  return (
    <>
      <dt className={cx("truncate", strong ? "font-medium text-text-100" : "text-text-300")}>{label}</dt>
      <dd className={cx("text-right", muted ? "text-text-300" : value > 0 ? "text-increase" : value < 0 ? "text-decrease" : "text-text-200", strong && "font-medium")}>{fmtSigned(value, solUsd, unit)}</dd>
    </>
  );
}
