"use client";
/** Block X launch workspace: Chart · Tasks · Token info · Activity panels + the right rail (Launch · Claim Rewards). */
import { useState } from "react";
import { ChevronDown, Gift, GripVertical, Info, Pencil, Plus, Rocket, Settings2, Square, Trash2 } from "lucide-react";
import type { AutoClaimStatus, JobCreated, LaunchPreset, LaunchState, LaunchTaskType, PositionsResponse, TokenInfo, TokenTradesResponse, WalletGroup, WalletInfo } from "@/lib/types";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSolPrice } from "@/lib/store";
import { usePresetIndex, useTradingPresets } from "@/lib/presets";
import { age, pct, short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { TxLink } from "@/components/bx/Job";
import { CandleChart } from "@/components/trade/Chart";
import { LiveTaskCard, TaskCard } from "./TaskEditor";
import { TaskDialog, TASK_TYPES } from "./TaskDialog";
import { GlobalPresetsDialog } from "./GlobalPresetsDialog";
import { TradingPresetsDialog } from "./TradingPresetsDialog";
import { TASK_META, type FormTask, type LaunchForm } from "./model";

export function Panel({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col overflow-hidden border border-line-100 bg-bg-100 shadow-[0_8px_24px_rgba(0,0,0,0.28)]", className)}>
      <div className="flex h-7 shrink-0 select-none items-center gap-1.5 border-b border-line-100 bg-surface-muted px-2 text-xs font-medium text-text-300">
        <GripVertical className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {right ? <div className="ml-auto shrink-0">{right}</div> : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
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
export function ChartPanel({ mint }: { mint: string | null }) {
  const candles = useGet<{ candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }>(mint ? `/api/token/${mint}/candles?tf=15s` : null, 5000);
  return (
    <Panel title="Chart">
      {!mint ? (
        <section className="relative h-full min-h-0 w-full" aria-label="Price chart">
          <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-1 bg-bg-100 px-6 text-center">
            <p className="text-sm text-text-200">No chart yet</p>
            <p className="text-xs text-text-300">The chart will load after you launch.</p>
          </div>
        </section>
      ) : !candles.data?.candles.length ? (
        <div className="flex h-full items-center justify-center text-xs text-text-300">{candles.loading ? "Loading…" : "No trade on the curve yet."}</div>
      ) : (
        <CandleChart candles={candles.data.candles} live={null} height={360} />
      )}
    </Panel>
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
  const dev = wallets.find((w) => w.address === form.devWallet) ?? null;
  const devBal = dev ? Number(balances?.[dev.address] ?? dev.sol ?? 0) : 0;
  const readOnly = !!live;
  const positions = useGet<PositionsResponse>(live ? `/api/positions?mints=${live.mint}&wallets=${live.dev}` : null, 5000);
  const devRow = (positions.data ?? []).find((r) => r.wallet === live?.dev && r.mint === live?.mint) ?? null;
  const [sellBusy, setSellBusy] = useState<number | null>(null);
  const devSell = async (percent: number) => {
    if (!live) return;
    setSellBusy(percent);
    try {
      await post<JobCreated>("/api/trade/sell", { mint: live.mint, wallets: [live.dev], percent, slippageBps: tp.slippagePercent * 100, tipSol: tp.tipSol });
      toast(`Selling ${percent}% of the dev wallet`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setSellBusy(null);
    }
  };
  const dumpAll = () => {
    if (!live || !onDump) return toast("Dump All failed — No launch wallets to sell.", "err");
    onDump();
  };
  const submitTask = (t: FormTask) => {
    const exists = form.tasks.some((x) => x.id === t.id);
    set("tasks", exists ? form.tasks.map((x) => (x.id === t.id ? t : x)) : [...form.tasks, t]);
    setDialog(null);
  };
  const seg = (on: boolean) => cx("h-full rounded px-1.5 text-[10px] font-medium transition-colors", on ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100");
  const liveTasks = live ? [...live.tasks].sort((a, b) => (sortBy === "pct" ? b.wallets.length - a.wallets.length : 0)) : [];

  return (
    <Panel
      title="Tasks"
      right={
        !readOnly ? (
          <div className="flex items-center gap-1">
            <div className="flex h-5 items-center gap-0.5 rounded bg-input-100 p-0.5">
              <button type="button" onClick={() => setUnit("SOL")} className={seg(unit === "SOL")} title="Buy with SOL amounts">
                SOL
              </button>
              <button type="button" onClick={() => setUnit("%")} className={seg(unit === "%")} title="Buy with percent of SOL balance">
                %
              </button>
            </div>
            <div className="flex h-5 items-center gap-0.5 rounded bg-input-100 p-0.5">
              <button type="button" onClick={() => setSortBy("balance")} className={seg(sortBy === "balance")} title="Sort wallets by token balance">
                Balance
              </button>
              <button type="button" onClick={() => setSortBy("pct")} className={seg(sortBy === "pct")} title="Sort wallets by holding percent">
                %
              </button>
            </div>
            <div className="relative">
              <button type="button" onClick={() => setAddOpen((o) => !o)} className="inline-flex h-5 items-center gap-1 rounded border border-line-100 bg-bg-50 px-1.5 text-[10px] font-medium text-text-200 hover:bg-white/[0.04]">
                <Plus className="h-3 w-3" /> Add Task <ChevronDown className="h-3 w-3" />
              </button>
              {addOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
                  <div className="absolute right-0 top-6 z-20 w-44 rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
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
            <button type="button" onClick={() => setGlobalOpen(true)} className="inline-flex h-5 items-center gap-1 rounded border border-line-100 bg-bg-50 px-1.5 text-[10px] font-medium text-text-200 hover:bg-white/[0.04]">
              Presets
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-text-300">{live?.restored ? "restored after restart" : live?.status}</span>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex h-8 shrink-0 items-center justify-end gap-3 border-b border-line-50 px-3 text-[11px]">
          <button type="button" onClick={() => setPresetsOpen(true)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label="Trading preset settings" title="Trading preset settings">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-0.5">
            {([0, 1, 2] as const).map((i) => (
              <button key={i} type="button" onClick={() => setPresetIndex(i)} className={cx("rounded px-1.5 py-0.5 font-medium", presetIndex === i ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100")} title={`Preset P${i + 1}: slippage ${trading[i].slippagePercent}% · tip ${trading[i].tipSol} SOL`}>
                P{i + 1}
              </button>
            ))}
          </div>
          <span className="uppercase text-text-300">
            Slippage <span className="font-mono normal-case text-text-100">{tp.slippagePercent}%</span>
          </span>
          <span className="uppercase text-text-300">
            Tip (SOL) <span className="font-mono normal-case text-text-100">{tp.tipSol}</span>
          </span>
          <button type="button" onClick={() => setDetails((d) => !d)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label={details ? "Hide details" : "Show details"} title={details ? "Hide details" : "Show details"}>
            <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", details ? "rotate-180" : "")} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Dev task */}
          <div className="task-card">
            <div className="flex h-10 items-center gap-2 px-3">
              <button type="button" onClick={() => setDevOpen((o) => !o)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label={devOpen ? "Collapse" : "Expand"}>
                <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", devOpen ? "" : "-rotate-90")} />
              </button>
              <span className="text-sm font-medium text-text-100">Dev</span>
              <span className="text-text-300" title={`Buy Amount: ${form.devBuySol || "0"} SOL · Auto Sell: ${form.autoDevSellEnabled ? (form.autoDevSellMode === "ms" ? `${form.autoDevSellValue} ms` : `$${form.autoDevSellValue} MC`) : "Off"} · Auto Dump: ${form.sellOnExternalEnabled ? `${form.sellOnExternalThreshold} SOL` : "Off"}`}>
                <Info className="h-3 w-3" />
              </span>
              <button type="button" onClick={dumpAll} className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-decrease/40 px-2 text-[11px] font-medium text-decrease hover:bg-decrease/10" title="Stop every task, then dump all tokens from all launch wallets">
                <Trash2 className="h-3 w-3" /> Dump All
              </button>
            </div>
            {devOpen ? (
              !dev && !live ? (
                <p className="px-3 pb-3 text-xs text-text-300">Select a developer wallet for this launch to manage the dev task.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-3 border-t border-line-50 px-3 py-2 text-xs">
                  <span className="text-text-100">{dev?.label || short(live?.dev ?? form.devWallet)}</span>
                  <span className="font-mono text-text-300">{short(live?.dev ?? form.devWallet, 4, 4)}</span>
                  <span className="font-mono text-text-200">{sol(devBal)} SOL</span>
                  {live ? (
                    <>
                      <span className="font-mono text-text-300">{devRow ? `${sol(devRow.amount, 0)} tokens · ${pct(devRow.supplyPct, 2)}` : "—"}</span>
                      <span className="ml-auto flex items-center gap-1">
                        {tp.sellPercents.map((p) => (
                          <button key={p} type="button" disabled={sellBusy !== null || !devRow || !(Number(devRow.amount) > 0)} onClick={() => devSell(p)} className="h-6 rounded border border-decrease/40 px-1.5 text-[10px] font-medium text-decrease hover:bg-decrease/10 disabled:cursor-not-allowed disabled:opacity-40">
                            Sell {p}%
                          </button>
                        ))}
                      </span>
                    </>
                  ) : (
                    <span className="ml-auto text-text-300">
                      Buy {form.devBuySol || "0"} SOL · Auto Sell {form.autoDevSellEnabled ? "On" : "Off"} · Auto Dump {form.sellOnExternalEnabled ? "On" : "Off"}
                    </span>
                  )}
                </div>
              )
            ) : null}
            {live?.mint ?? launchId ? <AutoClaimRow mint={live?.mint ?? launchId!} /> : null}
          </div>
          {readOnly && live ? (
            <div className="flex flex-col">
              {live.restored ? <p className="border-b border-line-50 bg-yellow-100/10 px-3 py-2 text-[11px] text-yellow-100">{live.restored.note}</p> : null}
              {!live.tasks.length ? <p className="px-3 py-4 text-xs text-text-300">No tasks on this launch.</p> : null}
              {liveTasks.map((t) => (
                <LiveTaskCard key={t.id} launchId={launchId ?? live.id} mint={live.mint} t={t} wallets={wallets} controls={taskControls} />
              ))}
            </div>
          ) : (
            <>
              {form.tasks.map((t) => (
                <TaskCard key={`${t.id}-${details}`} task={t} wallets={wallets} detailsOpen={details} onEdit={() => setDialog({ type: t.type, task: t })} onChange={(nt) => set("tasks", form.tasks.map((x) => (x.id === t.id ? nt : x)))} onRemove={() => set("tasks", form.tasks.filter((x) => x.id !== t.id))} />
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
export function TokenInfoPanel({ form, token, mint, onEdit }: { form: LaunchForm; token: TokenInfo | null; mint: string | null; onEdit?: () => void }) {
  const positions = useGet<PositionsResponse>(mint ? `/api/positions?mints=${mint}` : null, 5000);
  const price = useSolPrice();
  const rows = (positions.data ?? []).filter((r) => r.mint === mint);
  const bought = rows.reduce((n, r) => n + Number(r.costSol), 0);
  const sold = rows.reduce((n, r) => n + Number(r.realisedSol), 0);
  const holding = rows.reduce((n, r) => n + Number(r.valueSol), 0);
  const supplyPct = rows.reduce((n, r) => n + (r.supplyPct ?? 0), 0);
  const c = token?.curve ?? null;
  const progress = token?.complete ? 100 : (c?.progress ?? 0);
  const image = mint ? token?.image : form.imageDataUrl || null;
  const name = mint ? (token?.name ?? short(mint)) : form.name.trim() || "Untitled token";
  const symbol = mint ? token?.symbol : form.symbol.trim();
  const r = 29;
  const circ = 2 * Math.PI * r;
  return (
    <Panel title="Token info">
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
                {mint ? <p className="mt-0.5 truncate font-mono text-[11px] text-text-300">{short(mint, 6, 6)}</p> : null}
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

/* --------------------------------------------------------------- Activity */
export function ActivityPanel({ mint, live }: { mint: string | null; live: LaunchState | null }) {
  const [tab, setTab] = useState<"trades" | "log">("trades");
  const trades = useGet<TokenTradesResponse>(mint ? `/api/token/${mint}/trades?limit=100` : null, 5000);
  const price = useSolPrice();
  const rows = trades.data?.trades ?? [];
  const supply = Number(trades.data?.supplyTokens ?? 1e9) || 1e9;
  return (
    <Panel title="Activity">
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
                  return (
                    <div key={t.signature} className="relative py-px">
                      <div className="relative flex h-[30px] cursor-pointer flex-row bg-bg-100 px-2 hover:bg-hover-100">
                        <div className="relative flex w-[22.5%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                          <div className={cx("flex items-center gap-0.5 text-[13px] font-normal leading-4", t.side === "buy" ? "text-increase" : "text-decrease")}>
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
                            <span className="max-w-[120px] truncate font-medium text-text-200">{t.wallet.slice(-4)}</span>
                          </div>
                        </div>
                        <div className="relative flex w-[15%] items-center justify-end overflow-hidden whitespace-nowrap p-1 leading-none">
                          <TxLink sig={t.signature} className="text-text-300 hover:text-text-100" />
                          <span className="ml-1 text-[13px] text-text-300">{age(t.blockTime * 1000)}</span>
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
