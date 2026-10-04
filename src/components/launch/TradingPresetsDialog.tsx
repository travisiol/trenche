"use client";
/** Block X "Trading Presets" dialog (design/blockx/launch-trading-presets.html, BEHAVIOUR.md §4.5): Buy Settings / Sell
 *  Settings tabs, "Buttons Presets" (P1–P3 × 4 amounts, 4 % of balance, 4 sell %), Trading Presets table (slippage +
 *  tip per preset), Multi wallet trading (Buys value spread, Buys delay). Saved in settings (POST /api/settings). */
import { useState } from "react";
import { ChevronDown, CircleHelp, X } from "lucide-react";
import { TRADING_PRESET_LIMITS, type TradingPreset, type TradingPresets } from "@/lib/types";
import { failureMessage } from "@/lib/api";
import { saveTradingPresets, useTradingPresets } from "@/lib/presets";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";

export function TradingPresetsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { presets } = useTradingPresets();
  if (!open) return null;
  return <Body initial={presets} onClose={onClose} />;
}

function Body({ initial, onClose }: { initial: TradingPresets; onClose: () => void }) {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [buttonsOpen, setButtonsOpen] = useState(true);
  const [multiOpen, setMultiOpen] = useState(true);
  const [p, setP] = useState<TradingPresets>(() => JSON.parse(JSON.stringify(initial)) as TradingPresets);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);
  const edit = (i: number, patch: Partial<TradingPreset>) => setP((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)) as TradingPresets);
  const editFour = <K extends "buyAmounts" | "buyPercents" | "sellPercents">(i: number, k: K, j: number, v: string) =>
    setP((s) =>
      s.map((x, idx) => {
        if (idx !== i) return x;
        const arr = [...(x[k] as (string | number)[])];
        arr[j] = k === "buyAmounts" ? v.replace(/[^0-9.]/g, "") : Math.max(0, Math.min(100, Number(v) || 0));
        return { ...x, [k]: arr };
      }) as TradingPresets,
    );
  const save = async () => {
    setBusy(true);
    try {
      await saveTradingPresets(p);
      toast("Trading presets saved", "ok");
      onClose();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const cell = "relative flex h-8 items-center rounded-md bg-input-200 px-2";
  const cellInput = "w-full bg-transparent text-center text-xs text-text-100 outline-none";
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4" style={{ background: "var(--modal-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="trading-preset-settings-title" className="relative z-[211] flex max-h-[min(670px,90vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-line-100 bg-bg-100 shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-line-100 px-4 py-3">
          <h2 id="trading-preset-settings-title" className="text-base font-medium text-text-100">
            Trading Presets
          </h2>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-text-300 transition-colors hover:bg-white/[0.06] hover:text-text-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
          <div className="flex h-8 w-full gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
            <button type="button" onClick={() => setTab("buy")} className={cx("flex-1 rounded border px-2 text-[13px] font-medium transition-colors", tab === "buy" ? "border-tx-buy/30 bg-tx-buy/10 text-tx-buy" : "border-transparent text-text-300 hover:bg-tx-buy/5 hover:text-tx-buy")}>
              Buy Settings
            </button>
            <button type="button" onClick={() => setTab("sell")} className={cx("flex-1 rounded border px-2 text-[13px] font-medium transition-colors", tab === "sell" ? "border-decrease/30 bg-decrease/10 text-decrease" : "border-transparent text-text-300 hover:bg-decrease/5 hover:text-decrease")}>
              Sell Settings
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setButtonsOpen((o) => !o)} className="flex h-6 items-center justify-between text-[13px] text-text-100">
              <span>Buttons Presets</span>
              <ChevronDown className={cx("h-3.5 w-3.5 text-text-300 transition-transform duration-300", buttonsOpen ? "rotate-180" : "")} />
            </button>
            {buttonsOpen ? (
              <div className="flex flex-col gap-4 rounded-lg border border-input-200 p-3.5">
                {tab === "buy" ? (
                  <>
                    <Group title="Native amounts" unit="SOL" presets={p} field="buyAmounts" onEdit={editFour} />
                    <Group title="Percent of native balance" unit="%" presets={p} field="buyPercents" onEdit={editFour} />
                  </>
                ) : (
                  <Group title="Sell percent" unit="%" presets={p} field="sellPercents" onEdit={editFour} />
                )}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-text-100">Trading Presets</span>
            <div className="no-scrollbar w-full overflow-auto">
              <table className="w-full border-collapse overflow-hidden rounded-lg border border-input-200">
                <thead>
                  <tr>
                    <th className="h-10 w-12 border-b border-r border-input-200 px-3 text-center text-[11px] font-normal text-text-300" />
                    <th className="h-10 border-b border-r border-input-200 px-3 text-center text-[11px] font-normal text-text-300">
                      <span className="text-xs text-text-200">Slippage</span>
                    </th>
                    <th className="h-10 border-b border-input-200 px-3 text-center text-[11px] font-normal text-text-300">
                      <span className="text-xs text-text-200">Tip (SOL)</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.map((x, i) => (
                    <tr key={i}>
                      <td className={cx("border-r border-input-200 p-3 align-middle text-text-100", i < 2 ? "border-b" : "")}>
                        <span className="text-xs">P{i + 1}</span>
                      </td>
                      <td className={cx("border-r border-input-200 p-3 align-middle", i < 2 ? "border-b" : "")}>
                        <div className={cell}>
                          <input inputMode="decimal" value={x.slippagePercent} onChange={(e) => edit(i, { slippagePercent: Math.max(0, Math.min(TRADING_PRESET_LIMITS.maxSlippagePercent, Number(e.target.value) || 0)) })} className={cx(cellInput, "pr-5")} type="text" />
                          <span className="pointer-events-none absolute right-2 shrink-0 text-[11px] text-text-300">%</span>
                        </div>
                      </td>
                      <td className={cx("p-3 align-middle", i < 2 ? "border-b border-input-200" : "")}>
                        <div className={cell}>
                          <input inputMode="decimal" value={x.tipSol} onChange={(e) => edit(i, { tipSol: e.target.value.replace(/[^0-9.]/g, "") })} className={cx(cellInput, "pr-9")} type="text" />
                          <span className="pointer-events-none absolute right-2 shrink-0 text-[11px] text-text-300">SOL</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setMultiOpen((o) => !o)} className="flex h-6 items-center justify-between text-[13px] text-text-100">
              <span>Multi wallet trading</span>
              <ChevronDown className={cx("h-3.5 w-3.5 text-text-300 transition-transform duration-300", multiOpen ? "rotate-180" : "")} />
            </button>
            {multiOpen ? (
              <div className="flex flex-col gap-4 rounded-lg border border-input-200 p-3.5">
                {p.map((x, i) => (
                  <div key={i} className="flex flex-col gap-4 py-1">
                    {p.length > 1 ? <span className="text-[11px] font-medium text-text-300">P{i + 1}</span> : null}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1 text-xs text-text-100">
                        <span>Buys value spread</span>
                        <span title="Randomizes each wallet buy around the average. Total still matches your input amount." className="text-text-300 transition-colors hover:text-text-100">
                          <CircleHelp className="h-3 w-3" />
                        </span>
                      </div>
                      <div className="flex w-1/2 min-w-0 items-center gap-2">
                        <input min={0} max={TRADING_PRESET_LIMITS.maxSpreadPct} step={1} className="consolidate-slider min-w-0 flex-1" aria-label="Buys value spread" type="range" value={x.buysValueSpreadPct} onChange={(e) => edit(i, { buysValueSpreadPct: Number(e.target.value) })} />
                        <span className="w-9 shrink-0 text-right text-xs text-text-200">{x.buysValueSpreadPct}%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1 text-xs text-text-100">
                        <span>Buys delay</span>
                        <span title="Seconds to wait between each wallet buy when using multi-wallet buy." className="text-text-300 transition-colors hover:text-text-100">
                          <CircleHelp className="h-3 w-3" />
                        </span>
                      </div>
                      <div className="flex w-1/2 min-w-0 items-center gap-2">
                        <input min={0} max={TRADING_PRESET_LIMITS.maxDelaySec} step={0.1} className="consolidate-slider min-w-0 flex-1" aria-label="Buys delay" type="range" value={x.buysDelaySec} onChange={(e) => edit(i, { buysDelaySec: Number(e.target.value) })} />
                        <span className="w-9 shrink-0 text-right text-xs text-text-200">{x.buysDelaySec.toFixed(1)}s</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line-100 px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-md border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-200 transition-colors hover:bg-white/[0.04]">
            {dirty ? "Cancel" : "Close"}
          </button>
          <button type="button" onClick={save} disabled={!dirty || busy} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Group<K extends "buyAmounts" | "buyPercents" | "sellPercents">({ title, unit, presets, field, onEdit }: { title: string; unit: string; presets: TradingPresets; field: K; onEdit: (i: number, k: K, j: number, v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-text-200">{title}</span>
      {presets.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 shrink-0 text-xs text-text-100">P{i + 1}</span>
          <div className="grid flex-1 grid-cols-4 gap-2">
            {(p[field] as (string | number)[]).map((v, j) => (
              <div key={j} className="relative flex h-8 items-center rounded-md bg-input-200 px-2">
                <input inputMode="decimal" value={v} onChange={(e) => onEdit(i, field, j, e.target.value)} className={cx("w-full bg-transparent text-center text-xs text-text-100 outline-none", unit === "SOL" ? "pr-7" : "pr-4")} type="text" aria-label={`${title} P${i + 1} ${j + 1}`} />
                <span className="pointer-events-none absolute right-2 shrink-0 text-[10px] text-text-300">{unit}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
