"use client";
/** Block X task sections: round collapse chevron header + a wallet table (Wallet · SOL · Balance · %) with per-row
 *  trade buttons — dev row = custom Buy / Sell inputs + sell %, task rows = preset buy amounts + sell %. */
import { useState } from "react";
import { ChevronUp, Info } from "lucide-react";
import type { JobCreated, PositionRow, TradeBuyRequest, TradeSellRequest, TradingPreset, WalletInfo } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { trackTradeJob } from "@/lib/pendingTrades";
import type { PresetIndex } from "@/lib/presets";
import { compact, short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";

export type TradeCtx = {
  /** null before launch: rows show, trade buttons are disabled */
  mint: string | null;
  wallets: WalletInfo[];
  balances: Record<string, string | null> | null;
  positions: Map<string, PositionRow>;
  tp: TradingPreset;
  presetIndex: PresetIndex;
  /** header SOL / % toggle: task buy buttons show SOL amounts or % of the wallet's SOL balance */
  unit: "SOL" | "%";
  /** header Balance / % toggle: rows ordered by token balance or by supply % */
  sortBy: "balance" | "pct";
  /** re-read positions after a trade lands */
  onTraded: () => void;
};

const NOT_LAUNCHED = "Available once the token is launched";
const buyBtn = "h-7 min-w-[38px] rounded border border-line-100 bg-bg-50 px-1.5 font-mono text-[11px] font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40";
const sellBtn = "h-7 min-w-[44px] rounded border border-line-100 bg-bg-50 px-1.5 font-mono text-[11px] font-medium text-decrease transition-colors hover:border-decrease/50 hover:bg-decrease/10 disabled:cursor-not-allowed disabled:opacity-40";
/** one grid for the head + every row so the columns line up; rows are `display: contents` */
const GRID = "grid grid-cols-[96px_80px_80px_64px_1fr] items-center gap-x-3 gap-y-2 px-3 pb-3";
const ROW = "contents";

/** Collapsible section header of the Tasks panel (Dev, Bundle, Buy 1, …). */
export function TaskSection({ title, info, open, onToggle, right, status, children, className }: { title: string; info?: string; open: boolean; onToggle: () => void; right?: React.ReactNode; status?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <section className={cx("border-b border-line-100", className)}>
      <div className="flex min-h-12 items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-100 bg-bg-50 text-text-300 transition-colors hover:text-text-100" aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
          <ChevronUp className={cx("h-3.5 w-3.5 transition-transform", open ? "" : "rotate-180")} />
        </button>
        <span className="text-sm font-semibold text-text-100">{title}</span>
        {info ? (
          <span className="text-text-300" title={info}>
            <Info className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {status ? <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-300">{status}</div> : null}
        {right ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div> : null}
      </div>
      {open ? children : null}
    </section>
  );
}

/** Red outlined header action (Dump All, Sell All). */
export const sectionDanger = "inline-flex h-7 items-center gap-1.5 rounded border border-line-100 bg-bg-50 px-2.5 text-xs font-medium text-decrease transition-colors hover:border-decrease/50 hover:bg-decrease/10 disabled:cursor-not-allowed disabled:opacity-40";

function TableHead() {
  return (
    <div className={cx(ROW, "text-xs text-text-300")}>
      <span className="text-xs text-text-300">Wallet</span>
      <span className="text-xs text-text-300">SOL</span>
      <span className="text-xs text-text-300">Balance</span>
      <span className="text-xs text-text-300">%</span>
      <span />
    </div>
  );
}

function sorted(addrs: string[], ctx: TradeCtx) {
  if (!ctx.mint) return addrs;
  const key = (a: string) => {
    const p = ctx.positions.get(a);
    return ctx.sortBy === "pct" ? (p?.supplyPct ?? 0) : Number(p?.amount ?? 0);
  };
  return [...addrs].sort((a, b) => key(b) - key(a));
}

function useTrade(ctx: TradeCtx) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, label: string, side: "buy" | "sell", send: () => Promise<JobCreated>) => {
    if (!ctx.mint) return toast(NOT_LAUNCHED, "err");
    setBusy(id);
    try {
      const r = await send();
      trackTradeJob(r.jobId, { mint: ctx.mint, side, label });
      setTimeout(ctx.onTraded, 2500);
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  const common = { slippageBps: ctx.tp.slippagePercent * 100, tipSol: ctx.tp.tipSol };
  const buy = (wallet: string, label: string, body: Partial<TradeBuyRequest>, id: string) => run(id, label, "buy", () => post<JobCreated>("/api/trade/buy", { mint: ctx.mint!, wallets: [wallet], ...common, ...body } satisfies TradeBuyRequest));
  const sell = (wallets: string[], percent: number, label: string, id: string) => run(id, label, "sell", () => post<JobCreated>("/api/trade/sell", { mint: ctx.mint!, wallets, percent, ...common } satisfies TradeSellRequest));
  return { busy, buy, sell };
}

function Cells({ address, ctx, name }: { address: string; ctx: TradeCtx; name: string }) {
  const w = ctx.wallets.find((x) => x.address === address);
  const p = ctx.positions.get(address);
  const solBal = ctx.balances?.[address] ?? w?.sol ?? null;
  return (
    <>
      <span className="truncate text-sm font-semibold text-text-100" title={address}>
        {name}
      </span>
      <span className="font-mono text-xs text-text-100">{solBal === null ? "—" : sol(solBal)}</span>
      <span className="font-mono text-xs text-text-100">{p ? compact(Number(p.amount)) : "0"}</span>
      <span className="font-mono text-xs text-text-100">{(p?.supplyPct ?? 0).toFixed(2)}%</span>
    </>
  );
}

function SellButtons({ address, ctx, trade, name }: { address: string; ctx: TradeCtx; trade: ReturnType<typeof useTrade>; name: string }) {
  const held = Number(ctx.positions.get(address)?.amount ?? 0) > 0;
  return (
    <>
      {ctx.tp.sellPercents.map((pc) => (
        <button key={pc} type="button" disabled={!ctx.mint || !held || !!trade.busy} onClick={() => trade.sell([address], pc, `${name} sell ${pc}%`, `s${pc}`)} className={sellBtn} title={!ctx.mint ? NOT_LAUNCHED : !held ? "No token in this wallet" : `Sell ${pc}% of this wallet`}>
          {pc}%
        </button>
      ))}
    </>
  );
}

/** Dev row: [amount] Buy · [%] Sell · | · 25 50 75 100 % */
export function DevTable({ address, name, ctx, defaultBuy }: { address: string; name: string; ctx: TradeCtx; defaultBuy: string }) {
  const trade = useTrade(ctx);
  const [amount, setAmount] = useState(defaultBuy);
  const [percent, setPercent] = useState("");
  const held = Number(ctx.positions.get(address)?.amount ?? 0) > 0;
  const field = "h-7 w-[52px] rounded border border-line-100 bg-input-100 px-1.5 text-center font-mono text-[11px] text-text-100 outline-none focus:border-accent/60";
  const doBuy = () => {
    const v = Number(amount);
    if (!(v > 0)) return toast("Enter a SOL amount to buy", "err");
    trade.buy(address, `${name} buy ${amount} SOL`, { sol: amount }, "b");
  };
  const doSell = () => {
    const v = Number(percent);
    if (!(v > 0 && v <= 100)) return toast("Enter a percent between 1 and 100", "err");
    trade.sell([address], v, `${name} sell ${v}%`, "s");
  };
  return (
    <div className={GRID}>
      <TableHead />
      <div className={ROW}>
        <Cells address={address} ctx={ctx} name={name} />
        <div className="flex items-center justify-end gap-1">
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && doBuy()} inputMode="decimal" placeholder="SOL" className={field} aria-label="Dev buy amount (SOL)" />
          <button type="button" disabled={!ctx.mint || !!trade.busy} onClick={doBuy} className={buyBtn} title={ctx.mint ? "Buy this SOL amount with the dev wallet" : NOT_LAUNCHED}>
            Buy
          </button>
          <input value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && doSell()} inputMode="decimal" placeholder="%" className={field} aria-label="Dev sell percent" />
          <button type="button" disabled={!ctx.mint || !held || !!trade.busy} onClick={doSell} className={sellBtn} title={!ctx.mint ? NOT_LAUNCHED : held ? "Sell this percent of the dev wallet" : "No token in the dev wallet"}>
            Sell
          </button>
          <span className="mx-1 h-5 w-px bg-line-100" />
          <SellButtons address={address} ctx={ctx} trade={trade} name={name} />
        </div>
      </div>
    </div>
  );
}

function TaskRow({ address, ctx }: { address: string; ctx: TradeCtx }) {
  const trade = useTrade(ctx);
  const w = ctx.wallets.find((x) => x.address === address);
  const name = w?.label || short(address);
  return (
    <div className={ROW}>
      <Cells address={address} ctx={ctx} name={name} />
      <div className="flex items-center justify-end gap-1">
        {ctx.unit === "SOL"
          ? ctx.tp.buyAmounts.map((a, i) => (
              <button key={i} type="button" disabled={!ctx.mint || !!trade.busy} onClick={() => trade.buy(address, `${name} buy ${a} SOL`, { sol: a }, `b${i}`)} className={buyBtn} title={ctx.mint ? `Buy ${a} SOL` : NOT_LAUNCHED}>
                {a}
              </button>
            ))
          : ctx.tp.buyPercents.map((pc, i) => (
              <button key={i} type="button" disabled={!ctx.mint || !!trade.busy} onClick={() => trade.buy(address, `${name} buy ${pc}% SOL`, { percentOfBalance: pc }, `b${i}`)} className={buyBtn} title={ctx.mint ? `Buy with ${pc}% of the SOL balance` : NOT_LAUNCHED}>
                {pc}%
              </button>
            ))}
        <span className="mx-1 h-5 w-px bg-line-100" />
        <SellButtons address={address} ctx={ctx} trade={trade} name={name} />
      </div>
    </div>
  );
}

/** Wallet table of one task (Bundle, Sniper, Buy, Volume, Wash). */
export function TaskTable({ addresses, ctx, empty = "No wallet picked yet." }: { addresses: string[]; ctx: TradeCtx; empty?: string }) {
  if (!addresses.length) return <p className="px-3 pb-3 text-xs text-text-300">{empty}</p>;
  return (
    <div className={GRID}>
      <TableHead />
      {sorted(addresses, ctx).map((a) => (
        <TaskRow key={a} address={a} ctx={ctx} />
      ))}
    </div>
  );
}

/** Sell 100 % on every wallet of a task that holds the token (one job). */
export function useSellAll(ctx: TradeCtx) {
  const trade = useTrade(ctx);
  return {
    busy: !!trade.busy,
    sellAll: (addresses: string[], label: string) => {
      const holders = addresses.filter((a) => Number(ctx.positions.get(a)?.amount ?? 0) > 0);
      if (!holders.length) return toast(`Sell All — no wallet of ${label} holds the token`, "err");
      trade.sell(holders, 100, `Sell All (${label})`, "all");
    },
  };
}
