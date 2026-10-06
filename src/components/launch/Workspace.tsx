"use client";
/** Block X launch workspace: Chart · Tasks · Token info · Activity panels + the right rail (Launch · Claim Rewards). */
import { useMemo, useState } from "react";
import { ChevronDown, ClipboardPlus, Flame, Gift, GripVertical, Maximize2, Minimize2, MoreHorizontal, Pencil, Rocket, Settings, SlidersHorizontal, Square } from "lucide-react";
import { type AutoClaimStatus, type LaunchPreset, type LaunchState, type LaunchTaskType, type MintPnl, type PositionsResponse, type TokenInfo, type TokenTradesResponse, type WalletGroup, type WalletInfo } from "@/lib/types";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSolPrice, useWallets } from "@/lib/store";
import { tradeRowStyle } from "@/components/trade/tradeRowStyle";
import { mergePending, usePendingTrades, type ListedTrade } from "@/lib/pendingTrades";
import { usePresetIndex, useTradingPresets } from "@/lib/presets";
import { age, short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { CopyCa } from "@/components/bx/CopyCa";
import { TxLink } from "@/components/bx/Job";
import { TokenChart } from "@/components/trade/Chart";
import { LiveTaskCard, TaskCard } from "./TaskEditor";
import { TaskDialog, TASK_TYPES } from "./TaskDialog";
import { GlobalPresetsDialog } from "./GlobalPresetsDialog";
import { TradingPresetsDialog } from "./TradingPresetsDialog";
import { TASK_META, taskWallets, type FormTask, type LaunchForm } from "./model";
import { DevTable, TaskSection, sectionDanger, type TradeCtx } from "./WalletRows";
import { useLivePnl } from "./livePnl";
import { mergeLive, useLiveFeed } from "@/lib/livefeed";
import { applyLive, spotOf } from "@/lib/livePositions";

/** maximize / restore + "Reset layout" of one workspace panel (see layout.ts); absent on panels outside the workspace */
export type PanelFrame = { maximized: boolean; onMaximize: () => void; onResetLayout: () => void };

export function Panel({ title, titleExtra, right, children, className, frame }: { title: string; /** shown right after the title (Tasks: live PnL) */ titleExtra?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; frame?: PanelFrame }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={cx("flex flex-col overflow-hidden border border-line-100 bg-bg-100 shadow-[0_8px_24px_rgba(0,0,0,0.28)]", className)}>
      <div className="flex h-7 shrink-0 select-none items-center gap-1.5 border-b border-line-100 bg-surface-muted px-2 text-xs font-medium text-text-300">
        <GripVertical className="h-3.5 w-3.5 shrink-0" />
        <span className={cx("truncate", titleExtra ? "shrink-0" : "min-w-0 flex-1")}>{title}</span>
        {titleExtra ? <div className="flex min-w-0 flex-1 items-center overflow-hidden">{titleExtra}</div> : null}
        {right ? <div className="ml-auto shrink-0">{right}</div> : null}
        {frame ? (
          <div className={cx("flex shrink-0 items-center gap-0.5", right ? "" : "ml-auto")}>
            <button type="button" onClick={frame.onMaximize} className="flex h-5 w-5 items-center justify-center rounded text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100" aria-label={frame.maximized ? `Restore ${title}` : `Maximize ${title}`} title={frame.maximized ? "Restore the layout" : "Maximize this panel"}>
              {frame.maximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100" aria-label={`${title} panel menu`} title="Panel menu">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {menu ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 top-6 z-20 w-40 rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        frame.onMaximize();
                      }}
                      className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-text-100 hover:bg-hover-100"
                    >
                      {frame.maximized ? "Restore" : "Maximize"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        frame.onResetLayout();
                      }}
                      className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-text-100 hover:bg-hover-100"
                    >
                      Reset layout
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/** draggable gutter between two panels (4 px, highlights on hover); `onDrag` receives the pointer delta in px */
export function Gutter({ axis, onDrag, onEnd }: { axis: "x" | "y"; onDrag: (delta: number) => void; onEnd?: () => void }) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let last = axis === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const v = axis === "x" ? ev.clientX : ev.clientY;
      onDrag(v - last);
      last = v;
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      onEnd?.();
    };
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      onPointerDown={start}
      className={cx("group relative shrink-0 touch-none select-none", axis === "x" ? "w-4 -mx-1.5 cursor-col-resize" : "h-4 -my-1.5 cursor-row-resize")}
      title="Drag to resize"
    >
      <div className={cx("absolute rounded-full bg-transparent transition-colors group-hover:bg-accent/50 group-active:bg-accent", axis === "x" ? "inset-y-0 left-1/2 w-0.5 -translate-x-1/2" : "inset-x-0 top-1/2 h-0.5 -translate-y-1/2")} />
    </div>
  );
}

/** Dev task · "Auto-claim rewards → dev wallet" watcher of the live mint (GET /api/dev/autoclaim?mint=): pending in the
 *  creator vault, last claim, total claimed, Arm / Disarm (Resume after a server restart). Works for a CTO or any viewed
 *  mint whose creator is a vault wallet — the server never claims for a creator it cannot sign for. */
export function AutoClaimRow({ mint }: { mint: string }) {
  const st = useGet<AutoClaimStatus>(`/api/dev/autoclaim?mint=${mint}`, 5000);
  const [busy, setBusy] = useState(false);
  const s = st.data ?? null;
  const act = async (action: "arm" | "disarm" | "resume" | "tick") => {
    setBusy(true);
    try {
      await post(`/api/dev/autoclaim?mint=${mint}`, { action });
      st.refresh();
      if (action !== "tick") toast(action === "disarm" ? "Auto-claim disarmed" : "Auto-claim armed — creator fees go to the dev wallet by themselves", "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const btn = "h-6 rounded border border-line-100 px-1.5 text-[10px] font-medium text-text-200 hover:bg-hover-200 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-50 px-3 py-2 text-xs" data-testid="autoclaim-row">
      <span className="inline-flex items-center gap-1.5 text-text-100">
        <Gift className="h-3 w-3 text-text-300" /> Auto-claim
      </span>
      <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium", s?.enabled ? "bg-green-100/15 text-green-100" : s?.resumable ? "bg-yellow-100/15 text-yellow-100" : "bg-hover-200 text-text-300")} title={s?.enabled ? `Reads the creator vault every ${s.intervalSec}s and claims to the dev wallet once ≥ ${s.minSol} SOL` : s?.resumable ? "Restored after a server restart: disarmed until you resume it" : "Off — claim by hand with Claim Rewards"}>
        {!s ? "…" : s.enabled ? "on" : s.resumable ? "paused · restart" : "off"}
      </span>
      {s ? (
        <span className="font-mono text-text-300" title="Creator vault: claimable + cashback at the last read">
          pending {s.pendingSol === null ? "—" : sol(s.pendingSol)} SOL
        </span>
      ) : null}
      {s ? (
        <span className="font-mono text-text-300" title="Claimed by the watcher to the dev wallet">
          claimed {sol(s.claimedSol)} SOL{s.claims ? ` · ${s.claims}×` : ""}
        </span>
      ) : null}
      {s?.lastClaimAt ? <span className="text-text-300">last claim {age(s.lastClaimAt)} ago</span> : null}
      {s?.lastCheckAt ? <span className="text-text-300">checked {age(s.lastCheckAt)} ago</span> : null}
      {s?.claiming ? <span className="text-accent">claiming…</span> : null}
      {s?.error ? (
        <span className="min-w-0 basis-full truncate text-yellow-100" title={s.error}>
          {s.error}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-1">
        {s?.enabled || s?.resumable ? (
          <button type="button" disabled={busy} onClick={() => act("tick")} className={btn} title="Read the creator vault now">
            Check now
          </button>
        ) : null}
        {s?.resumable ? (
          <button type="button" disabled={busy} onClick={() => act("resume")} className={cx(btn, "border-accent/40 text-accent")}>
            Resume
          </button>
        ) : null}
        {s?.enabled ? (
          <button type="button" disabled={busy} onClick={() => act("disarm")} className={cx(btn, "border-decrease/40 text-decrease hover:bg-decrease/10")}>
            Disarm
          </button>
        ) : (
          <button type="button" disabled={busy || !s} onClick={() => act("arm")} className={cx(btn, "border-accent/40 text-accent")} title="Arm the auto-claim watcher on this mint (needs an unlocked vault)">
            Arm
          </button>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ Chart */
/** TokenChart (trade/Chart.tsx): server history + the live trade stream; token info on the launch page's own poll
 *  key (4 s) so no second request; our wallets = vault + trash, the server adds every launch wallet to the marks */
export function ChartPanel({ mint, frame, className }: { mint: string | null; frame?: PanelFrame; className?: string }) {
  const token = useGet<TokenInfo>(mint ? `/api/token/${mint}` : null, 4000);
  const price = useSolPrice();
  const vault = useWallets();
  const solUsd = token.data?.solPrice ?? price.data?.usd ?? null;
  const supply = Number(token.data?.curve?.tokenTotalSupply ?? 1e15) / 1e6 || 1e9;
  const walletKey = [...(vault.data?.wallets ?? []).map((w) => w.address), ...(vault.data?.history ?? [])].join(",");
  const mine = useMemo(() => new Set(walletKey ? walletKey.split(",") : []), [walletKey]);
  return (
    <Panel title="Chart" frame={frame} className={className}>
      {!mint ? (
        <section className="relative h-full min-h-0 w-full" aria-label="Price chart">
          <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-1 bg-bg-100 px-6 text-center">
            <p className="text-sm text-text-200">No chart yet</p>
            <p className="text-xs text-text-300">The chart will load after you launch.</p>
          </div>
        </section>
      ) : (
        <TokenChart mint={mint} solUsd={solUsd} supplyTokens={supply} mine={mine} creator={token.data?.creator ?? null} />
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- live PnL */
type PositionPnl = { cost: number; realised: number; value: number; trading: number; costs: number; creatorFees: number; net: number; pct: number | null; holding: boolean; feesKnown: boolean };
type MintPnlResponse = { mint: string; row: MintPnl | null; covered?: boolean; feesThrough?: number | null };
/** what the live feed adds to the ledger: creator fees of the trades after its last counted fee, and whether the ledger
 *  holds every transaction of this mint we know of (create + our trades, live ones included) */
export type LiveLedger = { covered: boolean; liveFees: number };

/** What this launch made, every launch wallet on the token, the same breakdown as the dashboard row:
 *  trading = sold + tokens still held (curve quote, moved with the last trade price) − spent (pump.fun fees inside);
 *  costs = creation rent + priority fees + tips + token accounts (on-chain ledger); + creator fees the token produced. */
export function positionPnl(rows: { costSol: string; realisedSol: string; valueSol: string; amount: string; marketCapSol: number | null; onCurve?: boolean }[], lastPriceSol: number, ledger: MintPnl | null, live: LiveLedger = { covered: true, liveFees: 0 }): PositionPnl | null {
  if (!rows.length && !ledger) return null;
  let cost = 0, realised = 0, value = 0, holding = false;
  for (const r of rows) {
    cost += Number(r.costSol) || 0;
    realised += Number(r.realisedSol) || 0;
    let v = Number(r.valueSol) || 0;
    const readPrice = r.marketCapSol ? r.marketCapSol / 1e9 : 0;
    if (v > 0 && r.onCurve !== false && readPrice > 0 && lastPriceSol > 0) v *= lastPriceSol / readPrice;
    value += v;
    if (Number(r.amount) > 0) holding = true;
  }
  const costs = Number(ledger?.costsSol ?? 0) || 0;
  const creatorFees = (Number(ledger?.creatorFeesSol ?? 0) || 0) + live.liveFees;
  let trading = realised + value - cost;
  let net = trading - costs + creatorFees;
  // position closed: the ledger's on-chain net (rent refunds included) is the Dashboard row's figure — show exactly that,
  // trades being what it leaves once costs and creator fees are put back. Only once the ledger holds every transaction
  // we know of: until then its row is short (a create or a sell not read yet) and the live estimate above stays
  if (!holding && ledger && live.covered) {
    net = (Number(ledger.netSol) || 0) + live.liveFees;
    trading = net + costs - creatorFees;
  }
  // what was put in: the positions' spent, or the ledger's buys when no position row is read (wallets not loaded)
  const basis = Math.max(cost, Number(ledger?.buysSol ?? 0) || 0) + costs;
  return { cost, realised, value, trading, costs, creatorFees, net, pct: basis > 0 ? (net / basis) * 100 : null, holding, feesKnown: !!ledger };
}

const signed = (n: number, d = 4) => `${n > 0.0000005 ? "+" : n < -0.0000005 ? "−" : ""}${Math.abs(n).toFixed(d)}`;

function PnlBadge({ pnl, solUsd, loading }: { pnl: PositionPnl | null; solUsd: number | null; loading: boolean }) {
  if (!pnl) return <span className="ml-2 text-[11px] text-text-300">{loading ? "PnL…" : "PnL — no position yet"}</span>;
  const up = pnl.net > 0.0000005, down = pnl.net < -0.0000005;
  const tone = up ? "text-increase" : down ? "text-decrease" : "text-text-200";
  const usdOf = (n: number) => (solUsd ? ` (${n > 0.0000005 ? "+" : n < -0.0000005 ? "−" : ""}$${Math.abs(n * solUsd).toFixed(2)})` : "");
  const title = [
    `Trades ${signed(pnl.trading)} SOL — sold ${pnl.realised.toFixed(4)} + still held ${pnl.value.toFixed(4)} − spent ${pnl.cost.toFixed(4)} (pump.fun fees inside)`,
    `Launch costs −${pnl.costs.toFixed(4)} SOL — creation rent, priority fees, tips, token accounts${pnl.feesKnown ? "" : " (being read from the chain)"}`,
    `Creator fees +${pnl.creatorFees.toFixed(4)} SOL — produced by every trade on this token, claimed or pending`,
    `= Net ${signed(pnl.net)} SOL${usdOf(pnl.net)} — same figure as this token's row on the Dashboard`,
  ].join("\n");
  return (
    <span className="ml-2 flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium" title={title} data-testid="tasks-pnl">
      <span className="text-text-300">PnL</span>
      <span className={cx("font-mono tabular-nums", tone)}>{signed(pnl.net)} SOL</span>
      {solUsd ? <span className={cx("font-mono tabular-nums", tone)}>{usdOf(pnl.net).trim()}</span> : null}
      {pnl.pct !== null ? <span className={cx("rounded px-1 font-mono tabular-nums", up ? "bg-increase/15" : down ? "bg-decrease/15" : "bg-hover-200", tone)}>{signed(pnl.pct, 1)}%</span> : null}
      <span className="hidden truncate font-normal text-text-300 xl:inline">
        trades {signed(pnl.trading)} · costs −{pnl.costs.toFixed(4)} · fees +{pnl.creatorFees.toFixed(4)}
      </span>
      {pnl.holding ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" title="Still holding: moves with the price" /> : <span className="text-text-300">closed</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ Tasks */
export function TasksPanel({
  form,
  onChange,
  wallets,
  groups,
  balances,
  presets,
  onPreset,
  live,
  launchId,
  onDump,
  taskControls = true,
  frame,
  className,
}: {
  form: LaunchForm;
  onChange: (f: LaunchForm) => void;
  wallets: WalletInfo[];
  groups: WalletGroup[];
  balances: Record<string, string | null> | null;
  presets: LaunchPreset[];
  onPreset: (action: "load" | "quick" | "save" | "update" | "delete", preset?: LaunchPreset, name?: string) => Promise<string | void> | void;
  /** live launch state once launched / when viewing a launched token */
  live: LaunchState | null;
  launchId: string | null;
  onDump?: () => void;
  /** false for a CTO: task states are shown, Start / Stop happen on the right rail */
  taskControls?: boolean;
  frame?: PanelFrame;
  className?: string;
}) {
  const [unit, setUnit] = useState<"SOL" | "%">("SOL");
  const [sortBy, setSortBy] = useState<"balance" | "pct">("balance");
  const [addOpen, setAddOpen] = useState(false);
  const [dialog, setDialog] = useState<{ type: LaunchTaskType; task?: FormTask } | null>(null);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [details, setDetails] = useState(true);
  const [devOpen, setDevOpen] = useState(true);
  const [presetIndex, setPresetIndex] = usePresetIndex();
  const { presets: trading } = useTradingPresets();
  const tp = trading[presetIndex];
  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => onChange({ ...form, [k]: v });
  const devAddr = live?.dev ?? form.devWallet;
  const dev = wallets.find((w) => w.address === devAddr) ?? null;
  const readOnly = !!live;
  // the viewed mint, even when the launch state is gone after a server restart
  const mint = live?.mint ?? launchId ?? null;
  // one positions read for the dev + every task wallet (walks wallet trade history on the RPC: 15 s is plenty)
  const rowWallets = Array.from(new Set([devAddr, ...(live ? live.tasks.flatMap((t) => t.wallets) : form.tasks.flatMap((t) => taskWallets(t, wallets)))].filter(Boolean))).sort();
  const positions = useGet<PositionsResponse>(mint && rowWallets.length ? `/api/positions?mints=${mint}&wallets=${rowWallets.join(",")}` : null, 8000);
  const price = useSolPrice();
  const mintPnl = useGet<MintPnlResponse>(mint ? `/api/pnl/mint?mint=${mint}` : null, 10000);
  // live: every trade on the curve moves the price, ours move balances / cost / realised at once (useLivePnl)
  const lp = useLivePnl(mint, rowWallets, positions, mintPnl);
  const posMap = lp.posMap;
  const pnl = positionPnl([...posMap.values()], lp.spot, mintPnl.data?.row ?? null, lp.ledger);
  const ctx: TradeCtx = { mint, wallets, balances: lp.balances(balances), positions: posMap, tp, presetIndex, unit, sortBy, onTraded: positions.refresh };
  const dumpAll = () => {
    if (!live || !onDump) return toast("Dump All failed — No launch wallets to sell.", "err");
    onDump();
  };
  const submitTask = (t: FormTask) => {
    const exists = form.tasks.some((x) => x.id === t.id);
    set("tasks", exists ? form.tasks.map((x) => (x.id === t.id ? t : x)) : [...form.tasks, t]);
    setDialog(null);
  };
  const seg = (on: boolean) => cx("h-full rounded-sm px-2 text-[11px] font-medium transition-colors", on ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100");
  const box = "flex h-6 items-center gap-0.5 rounded border border-line-100 bg-bg-50 p-0.5";
  const headBtn = "inline-flex h-6 items-center gap-1.5 rounded border border-line-100 bg-bg-50 px-2 text-[11px] font-medium text-text-100 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <Panel
      title="Tasks"
      titleExtra={mint ? <PnlBadge pnl={pnl} solUsd={lp.solUsd ?? price.data?.usd ?? null} loading={positions.loading && !positions.data} /> : null}
      frame={frame}
      className={className}
      right={
        <div className="flex items-center gap-1.5">
          <div className={box}>
            <button type="button" onClick={() => setUnit("SOL")} className={seg(unit === "SOL")} title="Buy buttons in SOL amounts">
              SOL
            </button>
            <button type="button" onClick={() => setUnit("%")} className={seg(unit === "%")} title="Buy buttons in percent of the wallet's SOL balance">
              %
            </button>
          </div>
          <div className={box}>
            <button type="button" onClick={() => setSortBy("balance")} className={seg(sortBy === "balance")} title="Order wallets by token balance">
              Balance
            </button>
            <button type="button" onClick={() => setSortBy("pct")} className={seg(sortBy === "pct")} title="Order wallets by supply percent">
              %
            </button>
          </div>
          <div className="relative">
            <button type="button" disabled={readOnly} onClick={() => setAddOpen((o) => !o)} className={headBtn} title={readOnly ? "Tasks cannot be added once the launch runs" : "Add a task"}>
              <ClipboardPlus className="h-3.5 w-3.5" /> Add Task <ChevronDown className="h-3 w-3" />
            </button>
            {addOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
                <div className="absolute right-0 top-7 z-20 w-44 rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
                  {TASK_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setAddOpen(false);
                        setDialog({ type: t });
                      }}
                      className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-text-100 hover:bg-hover-100"
                    >
                      {TASK_META[t].title}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          <button type="button" disabled={readOnly} onClick={() => setGlobalOpen(true)} className={headBtn} title={readOnly ? "Launch presets apply before launch" : "Launch presets"}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Presets
          </button>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center justify-end gap-3 border-b border-line-100 px-3 text-xs">
          {live ? <span className="mr-auto text-[11px] text-text-300">{live.restored ? "restored after restart" : live.status === "sending" && live.createLandedAt ? "landed — confirming" : live.status === "sending" && live.createSignature ? "create sent — landing" : live.status}</span> : null}
          <button type="button" onClick={() => setPresetsOpen(true)} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label="Trading preset settings" title="Trading preset settings">
            <Settings className="h-4 w-4" />
          </button>
          <div className="flex h-7 items-center gap-0.5 rounded border border-line-100 bg-bg-50 p-0.5">
            {([0, 1, 2] as const).map((i) => (
              <button key={i} type="button" onClick={() => setPresetIndex(i)} className={cx("h-full rounded-sm px-2.5 font-medium", presetIndex === i ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100")} title={`Preset P${i + 1}: buys ${trading[i].buyAmounts.join(" / ")} SOL · slippage ${trading[i].slippagePercent}% · tip ${trading[i].tipSol} SOL`}>
                P{i + 1}
              </button>
            ))}
          </div>
          <span className="uppercase text-text-300">
            Slippage <span className="ml-1 font-mono font-semibold normal-case text-text-100">{tp.slippagePercent}%</span>
          </span>
          <span className="uppercase text-text-300">
            Tip (SOL) <span className="ml-1 font-mono font-semibold normal-case text-text-100">{tp.tipSol}</span>
          </span>
          {!readOnly ? (
            <button type="button" onClick={() => setDetails((d) => !d)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label={details ? "Collapse every task" : "Expand every task"} title={details ? "Collapse every task" : "Expand every task"}>
              <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", details ? "rotate-180" : "")} />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskSection
            title="Dev"
            info={`Buy Amount: ${form.devBuySol || "0"} SOL · Auto Sell: ${form.autoDevSellEnabled ? (form.autoDevSellMode === "ms" ? `${form.autoDevSellValue} ms` : `$${form.autoDevSellValue} MC`) : "Off"} · Auto Dump: ${form.sellOnExternalEnabled ? `${form.sellOnExternalThreshold} SOL` : "Off"}`}
            open={devOpen}
            onToggle={() => setDevOpen((o) => !o)}
            right={
              <button type="button" onClick={dumpAll} className={sectionDanger} title="Stop every task, then dump all tokens from all launch wallets">
                <Flame className="h-3.5 w-3.5" /> Dump All
              </button>
            }
          >
            {!devAddr ? (
              <p className="px-3 pb-3 text-xs text-text-300">Select a developer wallet for this launch to manage the dev task.</p>
            ) : (
              <DevTable address={devAddr} name={dev?.label || short(devAddr)} ctx={ctx} defaultBuy={tp.buyAmounts[0]} />
            )}
            {mint ?? launchId ? <AutoClaimRow mint={mint ?? launchId!} /> : null}
          </TaskSection>
          {readOnly && live ? (
            <div className="flex flex-col">
              {live.restored ? <p className="border-b border-line-50 bg-yellow-100/10 px-3 py-2 text-[11px] text-yellow-100">{live.restored.note}</p> : null}
              {!live.tasks.length ? <p className="px-3 py-4 text-xs text-text-300">No tasks on this launch.</p> : null}
              {live.tasks.map((t) => (
                <LiveTaskCard key={t.id} launchId={launchId ?? live.id} t={t} ctx={ctx} controls={taskControls} />
              ))}
            </div>
          ) : (
            <>
              {form.tasks.map((t) => (
                <TaskCard key={`${t.id}-${details}`} task={t} ctx={ctx} detailsOpen={details} onEdit={() => setDialog({ type: t.type, task: t })} onChange={(nt) => set("tasks", form.tasks.map((x) => (x.id === t.id ? nt : x)))} onRemove={() => set("tasks", form.tasks.filter((x) => x.id !== t.id))} />
              ))}
              {!form.tasks.length ? <p className="px-3 py-4 text-xs text-text-300">No tasks yet.</p> : null}
            </>
          )}
        </div>
      </div>
      {dialog ? <TaskDialog type={dialog.type} initial={dialog.task} form={form} wallets={wallets} groups={groups} balances={balances} unit={unit} onSubmit={submitTask} onClose={() => setDialog(null)} /> : null}
      <GlobalPresetsDialog open={globalOpen} onClose={() => setGlobalOpen(false)} form={form} wallets={wallets} presets={presets} onPreset={onPreset} />
      <TradingPresetsDialog open={presetsOpen} onClose={() => setPresetsOpen(false)} />
    </Panel>
  );
}

/* ------------------------------------------------------------- Token info */
export function TokenInfoPanel({ form, token, mint, onEdit, frame, className }: { form: LaunchForm; token: TokenInfo | null; mint: string | null; onEdit?: () => void; frame?: PanelFrame; className?: string }) {
  const positions = useGet<PositionsResponse>(mint ? `/api/positions?mints=${mint}` : null, 15000);
  const price = useSolPrice();
  // Bought / Sold / Holdings move with each live trade of ours (and the holdings' quote with everyone's)
  const feed = useLiveFeed(mint);
  const vault = useWallets();
  const polled = (positions.data ?? []).filter((r) => r.mint === mint);
  const own = new Set([...polled.map((r) => r.wallet), ...(vault.data?.wallets ?? []).map((w) => w.address), ...(vault.data?.history ?? [])]);
  const rows = mint ? applyLive(mint, polled, feed.trades, feed.last, own, positions.startedAt ?? positions.at) : polled;
  const bought = rows.reduce((n, r) => n + Number(r.costSol), 0);
  const sold = rows.reduce((n, r) => n + Number(r.realisedSol), 0);
  const holding = rows.reduce((n, r) => n + Number(r.valueSol), 0);
  const supplyPct = rows.reduce((n, r) => n + (r.supplyPct ?? 0), 0);
  // the curve after the newest live trade (polled token info otherwise): market cap + progress move with each trade
  const lt = feed.status === "live" && feed.last && token?.curve && !token.complete ? feed.last : null;
  const c = token?.curve && lt ? { ...token.curve, marketCapSol: spotOf(lt) * 1e9, marketCapUsd: feed.solUsd ? spotOf(lt) * 1e9 * feed.solUsd : null, progress: Math.max(0, Math.min(100, ((793_100_000e6 - Number(lt.realTok)) / 793_100_000e6) * 100)) } : (token?.curve ?? null);
  const progress = token?.complete ? 100 : (c?.progress ?? 0);
  const image = mint ? token?.image : form.imageDataUrl || null;
  const name = mint ? (token?.name ?? short(mint)) : form.name.trim() || "Untitled token";
  const symbol = mint ? token?.symbol : form.symbol.trim();
  const r = 29;
  const circ = 2 * Math.PI * r;
  return (
    <Panel title="Token info" frame={frame} className={className}>
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="glass-card flex min-h-0 w-full flex-1 flex-col overflow-hidden px-3 py-2">
          <div className="shrink-0">
            <div className="mb-1 flex items-start gap-2.5">
              <div className="relative h-14 w-14 shrink-0 overflow-visible" title={`Bonding curve ${progress.toFixed(1)}%`}>
                <svg className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[60px] w-[60px] -translate-x-1/2 -translate-y-1/2" viewBox="0 0 60 60" aria-hidden>
                  <circle cx="30" cy="30" r={r} fill="none" stroke="var(--line-100)" strokeWidth="1.5" />
                  <circle cx="30" cy="30" r={r} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray={`${(progress / 100) * circ} ${circ}`} transform="rotate(-90 30 30)" />
                </svg>
                <div className="absolute left-[3px] top-[3px] z-[1] h-[50px] w-[50px] overflow-hidden rounded-[10px] border border-line-100 bg-bg-100">
                  <div className="flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-hidden">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- token image / local data URL
                      <img src={image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs font-semibold text-text-300">?</span>
                    )}
                  </div>
                </div>
                <div className="absolute left-[53px] top-[53px] z-20 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-solid bg-bg-100" style={{ borderColor: "rgba(82, 212, 143, 0.6)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                  <img src="/launchpads/pumpfun.svg" alt="Pump.fun" className="h-2.5 w-2.5 object-contain" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="mb-1 truncate text-lg font-bold text-text-100">{name}</h1>
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-sm text-text-300">{symbol || "—"}</p>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-text-200" title="Launch quoted in SOL">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                    <img src="/solana.svg" alt="" className="h-3 w-3 shrink-0 rounded-full object-contain" />
                    <span>SOL</span>
                  </span>
                </div>
                <TokenCa ca={mint ?? (form.reservedMint || form.mintAddress || null)} reserved={!mint} />
              </div>
              {onEdit ? (
                <div className="-mr-1 flex shrink-0 items-center gap-1">
                  <button type="button" onClick={onEdit} className="flex h-7 w-7 shrink-0 items-center justify-center text-text-300 transition-colors hover:bg-white/[0.06] hover:text-text-100" aria-label="Edit draft" title="Edit draft">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-auto grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] divide-x divide-line-100">
            {[
              ["Bought", `${sol(bought)}`, "text-increase"],
              ["Sold", `${sol(sold)}`, "text-decrease"],
              ["Holdings", `${sol(holding)}`, "text-text-100"],
            ].map(([k, v, tone]) => (
              <div key={k} className="flex min-w-0 flex-1 flex-col text-center">
                <div className="mb-1 flex h-4 items-center justify-center">
                  <p className="text-[10px] uppercase tracking-wider text-text-300">{k}</p>
                </div>
                <div className="flex min-w-0 items-center justify-center gap-1">
                  <p className={cx("min-w-0 truncate text-[11px] font-semibold", tone)}>{v}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card -mt-px flex w-full shrink-0 flex-col justify-end p-3 pb-3 pt-2" style={{ height: 84 }}>
          <div className="mb-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-text-300">Holdings</p>
              <p className="text-sm font-semibold leading-none tabular-nums text-text-100">{supplyPct.toFixed(2)}%</p>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-xs text-text-300">Bonding Curve</p>
                <p className="text-sm font-semibold leading-none tabular-nums text-text-100">{progress.toFixed(1)}%</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-text-300">Market Cap</p>
                {/* a migrated curve holds no reserves: its market cap lives on the PumpSwap pool, which this server does not read */}
                <p className="text-sm font-semibold leading-none tabular-nums text-text-100" title={c?.complete ? "Migrated to PumpSwap — market cap is not read from the pool" : undefined}>{!c ? "—" : c.complete ? "—" : c.marketCapUsd !== null ? usd(c.marketCapUsd) : price.data ? usd(c.marketCapSol * price.data.usd) : `${sol(c.marketCapSol)} SOL`}</p>
              </div>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden bg-surface-muted">
            <div className="h-full bg-gradient-to-r from-accent to-increase transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** contract address under the token name, click = copy. Before launch: the reserved / imported mint address when there
 *  is one (Edit → Fetch mint address), else the address is only drawn at launch. */
function TokenCa({ ca, reserved }: { ca: string | null; reserved: boolean }) {
  if (!ca) return <p className="mt-0.5 truncate text-[11px] text-text-300" title="Edit → Fetch mint address reserves the …pump address now, so the CA is known before launch">CA drawn at launch — reserve one in Edit</p>;
  return <CopyCa ca={ca} note={reserved ? "reserved" : undefined} className="mt-1" />;
}

/* --------------------------------------------------------------- Activity */
export function ActivityPanel({ mint, live, frame, className }: { mint: string | null; live: LaunchState | null; frame?: PanelFrame; className?: string }) {
  const [tab, setTab] = useState<"trades" | "log">("trades");
  // trades every 2 s while the page is open (server-side pump.fun cache: N clients = 1 upstream call)
  const trades = useGet<TokenTradesResponse>(mint ? `/api/token/${mint}/trades?limit=100` : null, 2000);
  const price = useSolPrice();
  // our own sent transactions are listed at once (pending → landed → confirmed) until the API returns them
  const pending = usePendingTrades(mint);
  // + the live feed's trades (pushed ~1 s after they land), until the poll lists them
  const feed = useLiveFeed(mint);
  const apiRows = mergeLive(trades.data?.trades ?? [], feed.trades, ({ side, wallet, solAmount, priceSol, blockTime, slot, signature }) => ({ side, wallet, solAmount, priceSol, blockTime, slot, signature }));
  const rows: ListedTrade[] = mergePending(apiRows, pending, apiRows[0] ? Number(apiRows[0].priceSol) : null);
  const vaultWallets = useWallets();
  // ours = the vault + the trash + every launch wallet (a dev deleted after its launch is still "you")
  const mine = new Set([...(vaultWallets.data?.wallets ?? []).map((w) => w.address), ...(vaultWallets.data?.history ?? []), ...(live ? [live.dev, ...live.tasks.flatMap((t) => t.wallets)] : [])]);
  const supply = Number(trades.data?.supplyTokens ?? 1e9) || 1e9;
  return (
    <Panel title="Activity" frame={frame} className={className}>
      <section className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Activity monitor">
        <div className="mb-2 mt-2 flex items-center gap-2 px-2" role="tablist">
          <div className="flex shrink-0 items-center gap-1 pl-0.5">
            <button type="button" role="tab" aria-selected={tab === "trades"} onClick={() => setTab("trades")} className={cx("px-2 py-1 text-sm font-medium", tab === "trades" ? "text-text-100" : "text-text-300 hover:text-text-100")}>
              Trades
            </button>
            {live ? (
              <button type="button" role="tab" aria-selected={tab === "log"} onClick={() => setTab("log")} className={cx("px-2 py-1 text-sm font-medium", tab === "log" ? "text-text-100" : "text-text-300 hover:text-text-100")}>
                Log <span className="font-mono text-[11px] text-text-300">{live.steps.length}</span>
              </button>
            ) : null}
          </div>
          <div className="flex flex-nowrap items-center gap-0 bg-btn-secondary p-0.5">
            <button type="button" className="cursor-pointer whitespace-nowrap border border-line-200 bg-input-200 px-2 py-1 text-xs font-medium leading-none text-text-100">
              All
            </button>
          </div>
        </div>
        {tab === "trades" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-8 flex-row items-center px-2 text-sm text-text-300">
              <div className="flex w-[22.5%] items-center gap-1 px-1">
                <span>Total</span>
              </div>
              <div className="flex w-[22.5%] items-center gap-1 px-1">
                <span className="px-0.5 text-sm font-medium">MC</span>
              </div>
              <div className="flex w-[40%] items-center justify-start gap-1 p-1">
                <span className="text-sm font-medium">Trader</span>
              </div>
              <div className="flex w-[15%] items-center justify-end p-1">
                <span className="text-[13px] leading-4">Age</span>
              </div>
            </div>
            <div className="h-px bg-line-100" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!mint ? (
                <p className="px-3 py-6 text-center text-xs text-text-300">Trades appear once a mint is known</p>
              ) : !rows.length ? (
                <p className="px-3 py-6 text-center text-xs text-text-300">{trades.loading ? "Reading the curve…" : "No trade on this curve yet."}</p>
              ) : (
                rows.map((t) => {
                  const mcSol = Number(t.priceSol) * supply;
                  const own = mine.has(t.wallet);
                  const st = tradeRowStyle(t.side, own);
                  return (
                    <div key={`${t.signature}:${t.wallet}:${t.side}`} className="relative py-px">
                      <div className={cx("relative flex h-[30px] cursor-pointer flex-row px-2 hover:brightness-125", st.row, t.pending === "sent" ? "opacity-60" : t.pending === "failed" ? "line-through opacity-50" : "")}>
                        <div className="relative flex w-[22.5%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                          <div className={cx("flex items-center gap-0.5 text-[13px] font-normal leading-4", st.amount)}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                            <img src="/solana.svg" alt="" width={12} height={12} className="h-3 w-3 shrink-0 object-contain" />
                            <span>{sol(t.solAmount)}</span>
                          </div>
                        </div>
                        <div className="relative flex w-[22.5%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                          <div className="text-[13px] font-normal text-text-200">{price.data ? usd(mcSol * price.data.usd) : `${sol(mcSol)} SOL`}</div>
                        </div>
                        <div className="relative flex w-[40%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                          <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[13px] font-medium leading-6 text-text-300" title={t.wallet}>
                            <span className={cx("max-w-[120px] truncate font-medium", own ? "rounded bg-white/[0.06] px-1 text-text-100" : "text-text-200")}>{own ? "you" : t.wallet.slice(-4)}</span>
                          </div>
                        </div>
                        <div className="relative flex w-[15%] items-center justify-end overflow-hidden whitespace-nowrap p-1 leading-none">
                          <TxLink sig={t.signature} className="text-text-300 hover:text-text-100" />
                          {t.pending ? (
                            <span className={cx("ml-1 text-[11px] font-medium uppercase", t.pending === "failed" ? "text-decrease" : t.pending === "sent" ? "animate-pulse text-text-300" : "text-green-100")} title="Sent from this terminal — the trade API has not listed it yet">
                              {t.pending}
                            </span>
                          ) : (
                            <span className="ml-1 text-[13px] text-text-300">{age(t.blockTime * 1000)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {!live?.steps.length ? <p className="px-3 py-6 text-center text-xs text-text-300">Waiting for the first step…</p> : null}
            {live?.steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-line-50 py-1 text-[11px]">
                <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", s.ok ? "bg-green-100" : "bg-decrease")} />
                <span className="shrink-0 rounded bg-accent-muted px-1 text-[10px] uppercase text-accent">{s.phase}</span>
                <span className={cx("min-w-0 flex-1 truncate", s.ok ? "text-text-200" : "text-decrease")}>{s.message}</span>
                {s.signature ? <TxLink sig={s.signature} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Right rail */
export function RightRail({ canLaunch, onLaunch, onClaim, claimBusy, launched, launchTitle, launchLabel = "Launch", onStop }: { canLaunch: boolean; onLaunch: () => void; onClaim?: () => void; claimBusy?: boolean; launched: boolean; launchTitle?: string; /** "Start" for a CTO */ launchLabel?: string; /** CTO: stop every task */ onStop?: () => void }) {
  const btn = "group flex w-full flex-col items-center justify-center gap-1 rounded-md border border-line-100 bg-bg-50 px-1 py-2 text-center transition-colors hover:bg-white/[0.04] hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <aside className="flex min-h-0 shrink-0 flex-col border-l border-line-100 bg-bg-100" aria-label="Launch options" style={{ width: 72 }}>
      <div className="flex items-center justify-center border-b border-line-50 px-2 py-2">
        <span className="h-6" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <button type="button" onClick={() => (canLaunch ? onLaunch() : launchTitle ? toast(launchTitle, "err") : null)} disabled={launched} className={cx(btn, !canLaunch && !launched ? "opacity-70" : "")} title={launched ? "Already launched" : canLaunch ? (launchLabel === "Launch" ? "Review and launch" : (launchTitle ?? "Run the tasks now")) : (launchTitle ?? "Open a draft first")}>
          <Rocket className="h-3.5 w-3.5 shrink-0 text-text-300 transition-colors group-hover:text-text-100" />
          <span className="max-w-full text-center text-[10px] font-medium leading-tight text-text-200">{launchLabel}</span>
        </button>
        {onStop ? (
          <button type="button" onClick={onStop} className={cx(btn, "mt-2")} title="Stop every task of this CTO">
            <Square className="h-3.5 w-3.5 shrink-0 text-decrease" />
            <span className="max-w-full text-center text-[10px] font-medium leading-tight text-text-200">Stop</span>
          </button>
        ) : null}
        <div className="no-scrollbar mt-auto flex flex-col gap-2 overflow-y-auto pt-2">
          <button type="button" onClick={onClaim} disabled={!onClaim || claimBusy} className={btn} title={onClaim ? "Claim the pump.fun creator fees of this token" : "Available once the token is launched"}>
            <Gift className="h-3.5 w-3.5 shrink-0 text-text-300 transition-colors group-hover:text-text-100" />
            <span className="max-w-full text-center text-[10px] font-medium leading-tight text-text-200">Claim Rewards</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
