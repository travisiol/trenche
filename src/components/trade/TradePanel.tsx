"use client";
/** Block X trading right panel: Buy / Sell toggle · Market tab · wallet selector · presets · amount · submit · Bought/Sold/Holding/PnL row. */
import { useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import type { JobCreated, PositionRow } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { DEFAULT_PRESETS, readLocalPresets, useBalances, useSettings, useSolPrice, useVault, useWallets } from "@/lib/store";
import { short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { WalletPicker } from "@/components/bx/WalletPicker";
import { BxJob } from "@/components/bx/Job";

export function usePresets(): [string, string, string] {
  const settings = useSettings();
  return settings.data?.presets ?? readLocalPresetsSafe() ?? DEFAULT_PRESETS;
}
function readLocalPresetsSafe() {
  if (typeof window === "undefined") return null;
  return readLocalPresets();
}

export function TradePanel({ mint, symbol, rows }: { mint: string; symbol: string | null; rows: PositionRow[] }) {
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const settings = useSettings();
  const price = useSolPrice();
  const presets = usePresets();
  const canSign = vault.data?.unlocked ?? false;
  const live = (wallets.data?.wallets ?? []).filter((w) => !w.archived);
  const groups = wallets.data?.groups ?? [];
  const active = wallets.data?.active ?? null;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sel, setSel] = useState<string[]>(active ? [active] : []);
  const [pickOpen, setPickOpen] = useState(false);
  const [amount, setAmount] = useState(presets[0]);
  const [percent, setPercent] = useState(100);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<string[]>([]);
  const [unit, setUnit] = useState<"USD" | "SOL">("USD");
  const targets = sel.length ? sel : active ? [active] : [];
  const balOf = (a: string) => Number(balances.data?.[a] ?? live.find((w) => w.address === a)?.sol ?? 0) || 0;
  const total = targets.reduce((n, a) => n + balOf(a), 0);
  const solUsd = price.data?.usd ?? null;
  const money = (s: number) => (unit === "USD" && solUsd ? usd(s * solUsd, 2) : `${sol(s)} SOL`);
  const bought = rows.reduce((n, r) => n + Number(r.costSol), 0);
  const sold = rows.reduce((n, r) => n + Number(r.realisedSol), 0);
  const holding = rows.reduce((n, r) => n + Number(r.valueSol), 0);
  const pnl = rows.reduce((n, r) => n + Number(r.pnlSol), 0);
  const pnlPct = bought > 0 ? (pnl / bought) * 100 : null;

  const send = async () => {
    if (!targets.length) return toast("Pick a wallet first", "err");
    setBusy(true);
    try {
      const body = side === "buy" ? { mint, wallets: targets, sol: amount, slippageBps: settings.data?.slippageBps ?? 2000 } : { mint, wallets: targets, percent, slippageBps: settings.data?.slippageBps ?? 2000 };
      const r = await post<JobCreated>(`/api/trade/${side}`, body);
      setJobs((j) => [r.jobId, ...j].slice(0, 3));
      toast(side === "buy" ? `Buying ${amount} SOL on ${targets.length} wallet${targets.length !== 1 ? "s" : ""}` : `Selling ${percent}% on ${targets.length} wallet${targets.length !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="flex min-w-0 flex-col overflow-hidden border-y border-line-100 bg-bg-100" aria-label="Managed wallet order rail">
        <div className="flex h-16 min-w-0 items-center justify-center gap-2 px-3 py-3">
          <div className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-line-100/70 p-1">
            <button type="button" onClick={() => setSide("buy")} className={cx("h-8 min-w-0 flex-1 rounded text-[12px] font-semibold capitalize transition-colors", side === "buy" ? "bg-tx-buy text-bg-100" : "text-text-300 hover:bg-white/[0.04] hover:text-text-100")}>
              buy
            </button>
            <button type="button" onClick={() => setSide("sell")} className={cx("h-8 min-w-0 flex-1 rounded text-[12px] font-semibold capitalize transition-colors", side === "sell" ? "bg-decrease text-bg-100" : "text-text-300 hover:bg-white/[0.04] hover:text-text-100")}>
              sell
            </button>
          </div>
        </div>
        <div className="flex h-8 min-w-0 items-center gap-1 border-y border-line-100 px-2">
          <button type="button" className="flex h-8 items-center border-b-2 border-text-100 px-2 text-[11px] font-medium text-text-100">
            Market
          </button>
          <div className="relative ml-auto">
            <button type="button" onClick={() => setPickOpen((o) => !o)} className="flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-line-100 px-2 text-[10px] font-medium text-text-200 hover:bg-white/[0.04]" aria-label={`${targets.length} wallets selected, ${sol(total)} SOL`}>
              <Wallet className="h-3 w-3 shrink-0 text-text-300" />
              {targets.length}
              <span className="h-3 w-px bg-line-100" />
              {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
              <img src="/solana.svg" alt="" className="h-2.5 w-2.5 shrink-0 object-contain" />
              <span className="truncate font-mono">{sol(total, 3)}</span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
            {pickOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPickOpen(false)} />
                <div className="absolute right-0 top-7 z-20 w-80 rounded-md border border-line-100 bg-bg-50 p-2 shadow-xl">
                  <WalletPicker wallets={live} groups={groups} value={targets} onChange={setSel} balances={balances.data} />
                </div>
              </>
            ) : null}
          </div>
        </div>
        {!live.length ? (
          <p className="px-3 py-5 text-center text-[11px] text-text-300">Create a managed wallet in Portfolio to trade.</p>
        ) : (
          <div className="flex flex-col gap-2 px-3 py-3">
            {side === "buy" ? (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {presets.map((p, i) => (
                    <button key={i} type="button" onClick={() => setAmount(p)} className={cx("h-8 rounded border text-[12px] font-medium transition-colors", amount === p ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200 hover:border-line-200 hover:text-text-100")}>
                      {p} SOL
                    </button>
                  ))}
                </div>
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                  <img src="/solana.svg" alt="" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 object-contain" />
                  <input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-full rounded-md border border-line-100 bg-bg-50 pl-7 pr-10 font-mono text-xs text-text-100 outline-none [appearance:textfield] focus:border-accent" aria-label="Amount per wallet" />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-300">SOL</span>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {[25, 50, 75, 100].map((n) => (
                  <button key={n} type="button" onClick={() => setPercent(n)} className={cx("h-8 rounded border text-[12px] font-medium transition-colors", percent === n ? "border-decrease/40 bg-decrease/15 text-decrease" : "border-line-100 bg-bg-50 text-text-200 hover:border-line-200 hover:text-text-100")}>
                    {n}%
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-[11px] text-text-300">
              <span>
                {targets.length} wallet{targets.length !== 1 ? "s" : ""} · slippage {(settings.data?.slippageBps ?? 2000) / 100}%
              </span>
              <span className="font-mono">{side === "buy" ? `${sol(targets.length * (Number(amount) || 0))} SOL total` : `≈ ${sol((holding * percent) / 100)} SOL`}</span>
            </div>
            <button type="button" onClick={send} disabled={busy || !canSign || !targets.length || (side === "buy" && !(Number(amount) > 0))} className={cx("h-9 w-full rounded-md text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40", side === "buy" ? "bg-tx-buy text-bg-100 hover:brightness-110" : "bg-decrease text-bg-100 hover:brightness-110")} title={!canSign ? "Unlock the vault first" : undefined}>
              {side === "buy" ? `Buy ${symbol ?? ""}` : `Sell ${percent}% ${symbol ?? ""}`}
            </button>
            {jobs.map((j) => (
              <BxJob key={j} jobId={j} compact />
            ))}
          </div>
        )}
        <div className="flex h-16 items-stretch border-t border-line-100">
          {[
            ["Bought", money(bought), "text-increase"],
            ["Sold", money(sold), "text-decrease"],
            ["Holding", money(holding), "text-text-100"],
          ].map(([k, v, tone], i) => (
            <div key={k} className={cx("my-2 flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1", i ? "border-l border-line-100" : "")}>
              <div className="flex h-4 items-center justify-center">
                <span className="text-[12px] leading-4 text-text-300">{k}</span>
              </div>
              <div className="flex min-w-0 items-center justify-center gap-1">
                <span className={cx("min-w-0 truncate whitespace-nowrap font-mono text-[12px] font-medium leading-4 tabular-nums", tone)}>{v}</span>
              </div>
            </div>
          ))}
          <div className="my-2 flex h-12 min-w-[116px] flex-col items-center justify-center gap-1 border-l border-line-100 px-1">
            <div className="flex h-4 items-center justify-center">
              <button type="button" onClick={() => setUnit((u) => (u === "USD" ? "SOL" : "USD"))} className="group/pnl-unit inline-flex h-4 flex-row items-center justify-center gap-1 rounded px-1.5 pl-2 transition-colors duration-150 hover:cursor-pointer hover:bg-white/[0.04]" title={unit === "USD" ? "Show SOL" : "Show USD"}>
                <span className="text-xs font-normal leading-4 text-text-300 group-hover/pnl-unit:text-text-200">PnL</span>
                <span className="text-[10px] text-text-300">{unit}</span>
              </button>
            </div>
            <div className="flex min-w-0 items-center justify-center gap-1">
              <span className={cx("min-w-0 truncate whitespace-nowrap font-mono text-[12px] font-medium leading-4 tabular-nums", pnl > 0 ? "text-increase" : pnl < 0 ? "text-decrease" : "text-text-100")}>
                {money(pnl)} ({pnlPct === null ? "—" : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`})
              </span>
            </div>
          </div>
        </div>
      </section>
      <span className="hidden">{short(mint)}</span>
    </>
  );
}
