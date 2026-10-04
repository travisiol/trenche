"use client";
/** Block X trading right column (design/blockx/trading-buy-panel.html, BEHAVIOUR.md §10): window stats, managed wallet
 *  order rail (Buy / Sell, Market · Limit · Adv. disabled, wallet drawer with the First Wallet / With Balance rule,
 *  P1–P3 amounts and sell % from the Trading Presets, slippage · tip), Bought / Sold / Holding / PnL footer, and the
 *  floating Instant Trade panel. Orders go to POST /api/trade/buy|sell with `preset` + index (contract TradeBuyRequest). */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, GripHorizontal, Pencil, Settings2, Wallet, X, Zap } from "lucide-react";
import type { PositionRow, StatsWindow, TokenStatsResponse, TradeBuyRequest, TradeCreated, TradeSellRequest, WalletInfo } from "@/lib/types";
import { failureMessage, post, useGet } from "@/lib/api";
import { useBalances, useSettings, useSolPrice, useVault, useWallets } from "@/lib/store";
import { usePresetIndex, useTradingPresets, type PresetIndex } from "@/lib/presets";
import { short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";
import { TradingPresetsDialog } from "@/components/launch/TradingPresetsDialog";

/** Legacy helper kept for the trade page: P1..P3 first buy amount. */
export function usePresets(): [string, string, string] {
  const { presets } = useTradingPresets();
  return [presets[0].buyAmounts[0], presets[1].buyAmounts[0], presets[2].buyAmounts[0]];
}

type Rule = "first" | "balance";
const RULE_KEY = "donchain.trade.walletRule";
const ruleListeners = new Set<() => void>();
let ruleCache: Rule | null = null;
function readRule(): Rule {
  if (ruleCache) return ruleCache;
  try {
    ruleCache = localStorage.getItem(RULE_KEY) === "balance" ? "balance" : "first";
  } catch {
    ruleCache = "first";
  }
  return ruleCache;
}
function writeRule(r: Rule) {
  ruleCache = r;
  try {
    localStorage.setItem(RULE_KEY, r);
  } catch {
    /* ignore */
  }
  ruleListeners.forEach((l) => l());
}
function useWalletRule(): [Rule, (r: Rule) => void] {
  const rule = useSyncExternalStore(
    (l) => {
      ruleListeners.add(l);
      return () => {
        ruleListeners.delete(l);
      };
    },
    readRule,
    () => "first" as Rule,
  );
  return [rule, writeRule];
}

/** Wallets an order goes to: explicit selection, else the rule ("First Wallet" = the first managed wallet, "With Balance" = every wallet holding SOL / the token). */
function useOrderWallets(mint: string, rows: PositionRow[], side: "buy" | "sell") {
  const wallets = useWallets();
  const balances = useBalances();
  const [rule, setRule] = useWalletRule();
  const [sel, setSel] = useState<string[]>([]);
  const live = (wallets.data?.wallets ?? []).filter((w) => !w.archived);
  const balOf = (a: string) => Number(balances.data?.[a] ?? live.find((w) => w.address === a)?.sol ?? 0) || 0;
  const holds = (a: string) => Number(rows.find((r) => r.wallet === a && r.mint === mint)?.amount ?? 0) > 0;
  const auto = rule === "first" ? (live[0] ? [live[0].address] : []) : live.filter((w) => (side === "buy" ? balOf(w.address) > 0.001 : holds(w.address))).map((w) => w.address);
  const targets = sel.length ? sel.filter((a) => live.some((w) => w.address === a)) : auto;
  return { live, balOf, holds, rule, setRule, sel, setSel, targets };
}

export function WindowStats({ mint }: { mint: string }) {
  const stats = useGet<TokenStatsResponse>(`/api/token/${mint}/stats`, 5000);
  const price = useSolPrice();
  const [win, setWin] = useState<StatsWindow>("5m");
  const solUsd = price.data?.usd ?? null;
  const w = stats.data?.windows?.[win] ?? null;
  const money = (s: number) => (solUsd ? usd(s * solUsd) : `${sol(s)} SOL`);
  const chg = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
  const buyShare = w && w.volumeSol > 0 ? (w.buysSol / w.volumeSol) * 100 : 50;
  if (stats.error) return <section className="flex min-h-[64px] items-center justify-center border-b border-line-100 px-3 text-[11px] text-text-300">{failureMessage(stats.error)}</section>;
  return (
    <section className="group relative flex min-h-[64px] flex-col border-b border-line-100">
      <div className="pointer-events-none absolute inset-0 z-10 grid h-16 grid-cols-4 bg-bg-100/95 opacity-0 backdrop-blur-[4px] transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        {(["5m", "1h", "6h", "24h"] as StatsWindow[]).map((k) => {
          const x = stats.data?.windows?.[k];
          return (
            <button key={k} type="button" aria-pressed={win === k} onClick={() => setWin(k)} className={cx("flex h-full min-w-0 flex-col items-center justify-center gap-1 border-b border-line-100 opacity-90 transition-colors", win === k ? "bg-[#2F3038]/45" : "bg-transparent hover:bg-[#2F3038]/15 active:bg-[#2F3038]/35")}>
              <span className={cx("text-[12px] font-medium leading-4", win === k ? "text-text-100" : "text-text-300")}>{k}</span>
              <span className={cx("truncate text-[13px] font-medium leading-[17px]", (x?.priceChangePct ?? 0) >= 0 ? "text-increase" : "text-decrease")}>{chg(x?.priceChangePct ?? null)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex h-16 w-full flex-col justify-center gap-2 px-3 py-2 transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0">
        <div className="grid w-full grid-cols-4 gap-2 whitespace-nowrap">
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="text-[12px] font-medium leading-4 text-text-300">{win} Vol</span>
            <span className="truncate text-[12px] font-medium leading-4 text-text-300">{w ? money(w.volumeSol) : "—"}</span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1">
            <span className="text-[12px] leading-4 text-text-300">Buys</span>
            <span className="flex max-w-full items-center gap-px text-[12px] font-medium leading-4 text-increase">
              {w?.buys ?? "—"}
              <span className="font-normal text-text-300">/</span>
              <span className="truncate">{w ? money(w.buysSol) : "—"}</span>
            </span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1">
            <span className="text-[12px] leading-4 text-text-300">Sells</span>
            <span className="flex max-w-full items-center gap-px text-[12px] font-medium leading-4 text-decrease">
              {w?.sells ?? "—"}
              <span className="font-normal text-text-300">/</span>
              <span className="truncate">{w ? money(w.sellsSol) : "—"}</span>
            </span>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-1">
            <span className="text-[12px] leading-4 text-text-300">Net Vol.</span>
            <span className={cx("truncate text-[12px] font-medium leading-4", (w?.netSol ?? 0) >= 0 ? "text-increase" : "text-decrease")}>{w ? `${w.netSol >= 0 ? "+" : "-"}${money(Math.abs(w.netSol))}` : "—"}</span>
          </div>
        </div>
        <div className="flex h-0.5 w-full gap-1">
          <div className="h-0.5 rounded-l-full bg-increase" style={{ width: `${buyShare}%` }} />
          <div className="h-0.5 flex-1 rounded-r-full bg-decrease" />
        </div>
      </div>
      {w?.partial ? <span className="sr-only">Window stats are a lower bound (history truncated)</span> : null}
    </section>
  );
}

export function TradePanel({ mint, symbol, rows }: { mint: string; symbol: string | null; rows: PositionRow[] }) {
  const vault = useVault();
  const price = useSolPrice();
  const settings = useSettings();
  const { presets } = useTradingPresets();
  const [presetIndex, setPresetIndex] = usePresetIndex();
  const canSign = vault.data?.unlocked ?? false;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [open, setOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<string[]>([]);
  const [unit, setUnit] = useState<"USD" | "SOL">("USD");
  const [presetsOpen, setPresetsOpen] = useState(false);
  const { live, balOf, holds, rule, setRule, sel, setSel, targets } = useOrderWallets(mint, rows, side);
  const tp = presets[presetIndex];
  const total = targets.reduce((n, a) => n + balOf(a), 0);
  const solUsd = price.data?.usd ?? null;
  const money = (s: number) => (unit === "USD" && solUsd ? usd(s * solUsd, 2) : `${sol(s)} SOL`);
  const bought = rows.reduce((n, r) => n + Number(r.costSol), 0);
  const sold = rows.reduce((n, r) => n + Number(r.realisedSol), 0);
  const holding = rows.reduce((n, r) => n + Number(r.valueSol), 0);
  const pnl = rows.reduce((n, r) => n + Number(r.pnlSol), 0);
  const pnlPct = bought > 0 ? (pnl / bought) * 100 : null;
  const tokensHeld = rows.filter((r) => targets.includes(r.wallet)).reduce((n, r) => n + Number(r.amount), 0);

  const send = async (body: Omit<TradeBuyRequest, "mint" | "wallets"> | Omit<TradeSellRequest, "mint" | "wallets">, label: string) => {
    if (!targets.length) return toast("Create a managed wallet in Portfolio to trade.", "err");
    if (!canSign) return toast("Unlock the vault first", "err");
    setBusy(true);
    try {
      const r = await post<TradeCreated>(`/api/trade/${side}`, { mint, wallets: targets, preset: (presetIndex + 1) as 1 | 2 | 3, ...body });
      setJobs((j) => [r.jobId, ...j].slice(0, 3));
      toast(`${label} on ${targets.length} wallet${targets.length !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const noWallets = !live.length;

  return (
    <>
      <WindowStats mint={mint} />
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
          <button type="button" aria-expanded={open} aria-label={open ? "Minimize order rail" : "Expand order rail"} onClick={() => setOpen((o) => !o)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-100 text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
        {open ? (
          <>
            <div className="flex h-8 min-w-0 items-center gap-1 border-y border-line-100 px-2">
              <button type="button" className="flex h-8 items-center border-b-2 border-text-100 px-2 text-[11px] font-medium text-text-100">
                Market
              </button>
              <button type="button" disabled title="Limit orders coming soon" className="flex h-8 items-center px-2 text-[11px] font-medium text-text-300 opacity-60 disabled:cursor-not-allowed">
                Limit
              </button>
              <button type="button" disabled title="Adv. orders coming soon" className="flex h-8 items-center px-2 text-[11px] font-medium text-text-300 opacity-60 disabled:cursor-not-allowed">
                Adv.
              </button>
              <button type="button" onClick={() => setDrawer((d) => !d)} className="ml-auto flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-line-100 px-2 text-[10px] font-medium text-text-200 hover:bg-white/[0.04]" aria-expanded={drawer} aria-controls="order-rail-wallet-drawer" aria-label={`${targets.length} wallets selected, ${sol(total, 3)} SOL`}>
                <Wallet className="h-3 w-3 shrink-0 text-text-300" />
                {targets.length}
                <span className="h-3 w-px bg-line-100" />
                {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                <img src="/solana.svg" alt="" className="h-2.5 w-2.5 shrink-0 object-contain" />
                <span className="truncate font-mono">{sol(total, 3)}</span>
                <ChevronDown className={cx("h-3 w-3 shrink-0 transition-transform", drawer ? "rotate-180" : "")} />
              </button>
            </div>
            {drawer ? (
              <div id="order-rail-wallet-drawer" className="flex flex-col gap-2 border-b border-line-100 bg-bg-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-text-300">Wallet rule</span>
                  <div className="flex h-6 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
                    {(["first", "balance"] as Rule[]).map((r) => (
                      <button key={r} type="button" onClick={() => { setRule(r); setSel([]); }} className={cx("h-full rounded px-2 text-[10px] font-medium transition-colors", rule === r && !sel.length ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")} title={r === "first" ? "Trade with the first managed wallet" : side === "buy" ? "Trade with every wallet holding SOL" : "Sell from every wallet holding the token"}>
                        {r === "first" ? "First Wallet" : "With Balance"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                  {live.map((w) => {
                    const on = targets.includes(w.address);
                    return (
                      <label key={w.address} className={cx("flex h-7 cursor-pointer items-center gap-2 rounded px-1.5 text-[11px]", on ? "bg-accent-muted" : "hover:bg-hover-100")}>
                        <input type="checkbox" className="pi-checkbox" checked={on} onChange={() => setSel(on ? targets.filter((a) => a !== w.address) : [...targets, w.address])} />
                        <span className="min-w-0 flex-1 truncate text-text-100">{w.label || short(w.address)}</span>
                        <span className="font-mono text-text-300">{sol(balOf(w.address), 3)} SOL</span>
                        {holds(w.address) ? <span className="rounded bg-accent-muted px-1 text-[9px] text-accent">{symbol ?? "token"}</span> : null}
                      </label>
                    );
                  })}
                  {!live.length ? <p className="py-2 text-[11px] text-text-300">No managed wallets available.</p> : null}
                </div>
              </div>
            ) : null}
            {noWallets ? (
              <p className="px-3 py-5 text-center text-[11px] text-text-300">Create a managed wallet in Portfolio to trade.</p>
            ) : (
              <div className="flex flex-col gap-2 px-3 py-3">
                <div className="flex items-center gap-1">
                  {([0, 1, 2] as PresetIndex[]).map((i) => (
                    <button key={i} type="button" onClick={() => setPresetIndex(i)} className={cx("h-6 rounded px-2 text-[11px] font-medium transition-colors", presetIndex === i ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100")}>
                      P{i + 1}
                    </button>
                  ))}
                  <button type="button" onClick={() => setPresetsOpen(true)} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-white/[0.04] hover:text-text-100" aria-label="Trading preset settings" title="Trading preset settings">
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {side === "buy" ? (
                  <>
                    <div className="grid grid-cols-4 gap-1.5">
                      {tp.buyAmounts.map((a, i) => (
                        <button key={i} type="button" disabled={busy || !canSign} onClick={() => send({ amountIndex: i as 0 | 1 | 2 | 3 }, `Buying ${a} SOL`)} className="h-8 rounded border border-line-100 bg-bg-50 text-[12px] font-medium text-text-200 transition-colors hover:border-tx-buy/40 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40" title={`Buy ${a} SOL per wallet`}>
                          {a}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {tp.buyPercents.map((p, i) => (
                        <button key={i} type="button" disabled={busy || !canSign} onClick={() => send({ percentIndex: i as 0 | 1 | 2 | 3 }, `Buying ${p}% of balance`)} className="h-8 rounded border border-line-100 bg-bg-50 text-[12px] font-medium text-text-300 transition-colors hover:border-tx-buy/40 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40" title={`Buy with ${p}% of each wallet's SOL balance`}>
                          {p}%
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <div className="relative min-w-0 flex-1">
                        {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                        <img src="/solana.svg" alt="" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 object-contain" />
                        <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="h-9 w-full rounded-md border border-line-100 bg-bg-50 pl-7 pr-10 font-mono text-xs text-text-100 outline-none focus:border-accent" aria-label="Amount per wallet" />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-300">SOL</span>
                      </div>
                      <button type="button" disabled={busy || !canSign || !(Number(custom) > 0)} onClick={() => send({ sol: custom }, `Buying ${custom} SOL`)} className="h-9 rounded-md bg-tx-buy px-4 text-[12px] font-semibold text-bg-100 transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                        Buy {symbol ?? ""}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {tp.sellPercents.map((p, i) => (
                      <button key={i} type="button" disabled={busy || !canSign || !(tokensHeld > 0)} onClick={() => send({ percentIndex: i as 0 | 1 | 2 | 3 }, `Selling ${p}%`)} className="h-8 rounded border border-line-100 bg-bg-50 text-[12px] font-medium text-text-200 transition-colors hover:border-decrease/40 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40" title={`Sell ${p}% of the token on each wallet`}>
                        {p}%
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between text-[11px] text-text-300">
                  <span>
                    {targets.length} wallet{targets.length !== 1 ? "s" : ""} · {side === "sell" ? `${sol(tokensHeld, 0)} ${symbol ?? ""}` : `${sol(total, 3)} SOL`}
                  </span>
                  <span className="font-mono">
                    {tp.slippagePercent}% · {tp.tipSol}
                  </span>
                </div>
                {jobs.map((j) => (
                  <BxJob key={j} jobId={j} compact />
                ))}
              </div>
            )}
          </>
        ) : null}
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
              <button type="button" onClick={() => setUnit((u) => (u === "USD" ? "SOL" : "USD"))} className="group/pnl-unit inline-flex h-4 flex-row items-center justify-center gap-1 rounded px-1.5 pl-2 transition-colors duration-150 hover:cursor-pointer hover:bg-white/[0.04]" title={unit === "USD" ? "Show SOL" : "Show USD"} aria-label={unit === "USD" ? "Display position in SOL" : "Display position in USD"}>
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
      <TradingPresetsDialog open={presetsOpen} onClose={() => setPresetsOpen(false)} />
      <span className="hidden">{settings.data?.cluster}</span>
    </>
  );
}

/** Floating "Instant Trade" panel: draggable, P1–P3, wallet count, round buy / sell buttons from the preset, slippage · tip, PnL strip, wallet rule. */
export function InstantTrade({ mint, symbol, rows, open, onClose }: { mint: string; symbol: string | null; rows: PositionRow[]; open: boolean; onClose: () => void }) {
  const vault = useVault();
  const price = useSolPrice();
  const { presets } = useTradingPresets();
  const [presetIndex, setPresetIndex] = usePresetIndex();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unit, setUnit] = useState<"USD" | "SOL">("USD");
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { live, balOf, rule, setRule, setSel, targets } = useOrderWallets(mint, rows, "buy");
  const sellTargets = useOrderWallets(mint, rows, "sell").targets;
  const canSign = vault.data?.unlocked ?? false;
  const tp = presets[presetIndex];
  const solUsd = price.data?.usd ?? null;
  const money = (s: number) => (unit === "USD" && solUsd ? usd(s * solUsd, 2) : `${sol(s)} SOL`);
  const bought = rows.reduce((n, r) => n + Number(r.costSol), 0);
  const sold = rows.reduce((n, r) => n + Number(r.realisedSol), 0);
  const holding = rows.reduce((n, r) => n + Number(r.valueSol), 0);
  const pnl = rows.reduce((n, r) => n + Number(r.pnlSol), 0);
  const tokens = rows.reduce((n, r) => n + Number(r.amount), 0);
  const total = targets.reduce((n, a) => n + balOf(a), 0);
  useEffect(() => {
    if (!open) return;
    const move = (e: MouseEvent) => drag.current && setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    const up = () => (drag.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [open]);
  if (!open) return null;
  const fire = async (side: "buy" | "sell", body: Record<string, unknown>, label: string) => {
    const ws = side === "buy" ? targets : sellTargets;
    if (!ws.length) return toast(side === "buy" ? "No managed wallet to buy with." : "No wallet holds this token.", "err");
    if (!canSign) return toast("Unlock the vault first", "err");
    setBusy(true);
    try {
      await post<TradeCreated>(`/api/trade/${side}`, { mint, wallets: ws, preset: (presetIndex + 1) as 1 | 2 | 3, ...body });
      toast(`${label} on ${ws.length} wallet${ws.length !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const round = (tone: "buy" | "sell") => cx("flex h-9 items-center justify-center rounded-full border text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40", tone === "buy" ? "border-accent/50 text-accent hover:bg-accent/15" : "border-decrease/50 text-decrease hover:bg-decrease/15");
  const style = pos ? { left: pos.x, top: pos.y } : { left: "calc(50% - 110px)", bottom: 96 };
  return (
    <div className="fixed z-[150] w-[248px] overflow-hidden rounded-lg border border-line-100 bg-bg-50 shadow-[0_16px_48px_rgba(0,0,0,0.5)]" style={style} role="dialog" aria-label="Instant Trade">
      <div
        className="flex h-8 cursor-grab items-center gap-1 border-b border-line-100 px-2 active:cursor-grabbing"
        onMouseDown={(e) => {
          const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
          setPos({ x: r.left, y: r.top });
        }}
        aria-label="Move Instant Trade"
      >
        {([0, 1, 2] as PresetIndex[]).map((i) => (
          <button key={i} type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setPresetIndex(i)} className={cx("h-5 rounded px-1.5 text-[10px] font-medium", presetIndex === i ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100")}>
            P{i + 1}
          </button>
        ))}
        <GripHorizontal className="ml-auto h-3.5 w-3.5 text-text-300" />
        <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setPresetsOpen(true)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-text-100" aria-label="Instant Trade settings" title="Instant Trade settings">
          <Settings2 className="h-3 w-3" />
        </button>
        <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setEditing((v) => !v)} className={cx("flex h-5 w-5 items-center justify-center rounded hover:text-text-100", editing ? "text-accent" : "text-text-300")} aria-label="Quick edit trading buttons" title="Quick edit trading buttons">
          <Pencil className="h-3 w-3" />
        </button>
        <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-text-100" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-2 p-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-text-100">Buy</span>
          <span className="flex items-center gap-1 font-mono text-text-300">
            <Wallet className="h-3 w-3" /> {targets.length} · {sol(total, 3)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {tp.buyAmounts.map((a, i) => (
            <button key={i} type="button" disabled={busy || !canSign} onClick={() => fire("buy", { amountIndex: i }, `Buying ${a} SOL`)} className={round("buy")} title={`Buy ${a} SOL per wallet`}>
              {a}
            </button>
          ))}
          {tp.buyPercents.map((p, i) => (
            <button key={`p${i}`} type="button" disabled={busy || !canSign} onClick={() => fire("buy", { percentIndex: i }, `Buying ${p}% of balance`)} className={round("buy")} title={`Buy with ${p}% of each wallet's SOL balance`}>
              {p}%
            </button>
          ))}
        </div>
        <div className="font-mono text-[10px] text-text-300">
          {tp.slippagePercent}% · {tp.tipSol}
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-text-100">Sell</span>
          <span className="font-mono text-text-300">
            {sol(tokens, 0)} {symbol ?? ""}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {tp.sellPercents.map((p, i) => (
            <button key={i} type="button" disabled={busy || !canSign || !(tokens > 0)} onClick={() => fire("sell", { percentIndex: i }, `Selling ${p}%`)} className={round("sell")} title={`Sell ${p}% on every wallet holding the token`}>
              {p}%
            </button>
          ))}
        </div>
        <div className="font-mono text-[10px] text-text-300">
          {tp.slippagePercent}% · {tp.tipSol}
        </div>
        {editing ? <p className="text-[10px] text-text-300">Edit the buttons in Trading Presets (gear) — they are the P{presetIndex + 1} amounts.</p> : null}
      </div>
      <div className="grid grid-cols-4 border-t border-line-100 text-center font-mono text-[10px] tabular-nums">
        {[money(bought), money(sold), money(holding), money(pnl)].map((v, i) => (
          <button key={i} type="button" onClick={() => setUnit((u) => (u === "USD" ? "SOL" : "USD"))} className={cx("truncate border-l border-line-100 px-1 py-2 first:border-l-0", i === 0 ? "text-increase" : i === 1 ? "text-decrease" : i === 3 ? (pnl > 0 ? "text-increase" : pnl < 0 ? "text-decrease" : "text-text-100") : "text-text-100")} title={["Bought", "Sold", "Holding", "PnL"][i] + " — click to switch SOL/USD"}>
            {v}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-line-100 px-2 py-1.5">
        <div className="flex h-6 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
          {(["first", "balance"] as Rule[]).map((r) => (
            <button key={r} type="button" onClick={() => { setRule(r); setSel([]); }} className={cx("h-full whitespace-nowrap rounded px-2 text-[10px] font-medium transition-colors", rule === r ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
              {r === "first" ? "First Wallet" : "With Balance"}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-text-300" title="Wallet trading settings">{live.length} managed</span>
      </div>
      <TradingPresetsDialog open={presetsOpen} onClose={() => setPresetsOpen(false)} />
    </div>
  );
}

export function InstantTradeButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx("ml-auto flex items-center gap-1 rounded-full border border-accent/50 py-1 pl-2 pr-3 text-[12px] font-medium leading-4 transition-colors", open ? "bg-accent text-white" : "bg-transparent text-accent hover:bg-accent-muted")}>
      <Zap className="h-4 w-4" />
      <span>Instant Trade</span>
    </button>
  );
}
