"use client";
/** Block X launch workspace: Chart · Tasks · Token info · Activity panels + the right rail (Launch · Claim Rewards). */
import { useState } from "react";
import { ChevronDown, Gift, GripVertical, Info, Pause, Pencil, Play, Plus, Rocket, Square, Trash2 } from "lucide-react";
import type { LaunchState, LaunchTaskState, PositionsResponse, TaskActionResponse, TokenInfo, TokenTradesResponse, WalletGroup, WalletInfo } from "@/lib/types";
import { PAUSABLE_TASKS } from "@/lib/types";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useSolPrice } from "@/lib/store";
import { age, short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxSwitch, cx } from "@/components/bx/ui";
import { TxLink } from "@/components/bx/Job";
import { CandleChart } from "@/components/trade/Chart";
import { TaskCard, TASK_TYPES } from "./TaskEditor";
import { TASK_META, newTask, solForSupplyPct, supplyPctForSol, type LaunchForm } from "./model";
import { TASK_STATUS_WORD } from "../dev/TaskRowCompact";
import type { LaunchPreset } from "@/lib/types";

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
}: {
  form: LaunchForm;
  onChange: (f: LaunchForm) => void;
  wallets: WalletInfo[];
  groups: WalletGroup[];
  balances: Record<string, string | null> | null;
  presets: LaunchPreset[];
  onPreset: (action: "load" | "quick" | "save" | "delete", preset?: LaunchPreset, name?: string) => void;
  /** live launch state once launched / when viewing a launched token */
  live: LaunchState | null;
  launchId: string | null;
  onDump?: () => void;
}) {
  const settings = useSettings();
  const [unit, setUnit] = useState<"SOL" | "%">("SOL");
  const [balOpen, setBalOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => onChange({ ...form, [k]: v });
  const quick = settings.data?.presets ?? ["0.1", "0.5", "1"];
  const dev = wallets.find((w) => w.address === form.devWallet) ?? null;
  const devBal = dev ? Number(balances?.[dev.address] ?? dev.sol ?? 0) : 0;
  const involved = Array.from(new Set([form.devWallet, ...form.tasks.flatMap((t) => [...t.walletIds, ...wallets.filter((w) => t.walletGroupIds.includes(w.group ?? "")).map((w) => w.address)])].filter(Boolean)));
  const total = involved.reduce((n, a) => n + (Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0), 0);
  const devPct = supplyPctForSol(Number(form.devBuySol) || 0);
  const readOnly = !!live;

  return (
    <Panel
      title="Tasks"
      right={
        !readOnly ? (
          <div className="flex items-center gap-1">
            <div className="flex h-5 items-center gap-0.5 rounded bg-input-100 p-0.5">
              {(["SOL", "%"] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} className={cx("h-full rounded px-1.5 text-[10px] font-medium", unit === u ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                  {u}
                </button>
              ))}
            </div>
            <div className="relative">
              <button type="button" onClick={() => setBalOpen((o) => !o)} className="inline-flex h-5 items-center gap-1 rounded border border-line-100 bg-bg-50 px-1.5 text-[10px] font-medium text-text-200 hover:bg-white/[0.04]">
                Balance <ChevronDown className="h-3 w-3" />
              </button>
              {balOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBalOpen(false)} />
                  <div className="absolute right-0 top-6 z-20 w-56 rounded-md border border-line-100 bg-bg-50 p-2 text-[11px] shadow-xl">
                    <div className="mb-1 flex justify-between text-text-300">
                      <span>Involved wallets</span>
                      <span className="font-mono text-text-100">{involved.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-300">Total SOL</span>
                      <span className="font-mono text-text-100">{sol(total)}</span>
                    </div>
                    {dev ? (
                      <div className="flex justify-between">
                        <span className="text-text-300">Dev ({dev.label || short(dev.address)})</span>
                        <span className="font-mono text-text-100">{sol(devBal)}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
            <div className="relative">
              <button type="button" onClick={() => setAddOpen((o) => !o)} className="inline-flex h-5 items-center gap-1 rounded border border-line-100 bg-bg-50 px-1.5 text-[10px] font-medium text-text-200 hover:bg-white/[0.04]">
                <Plus className="h-3 w-3" /> Add Task <ChevronDown className="h-3 w-3" />
              </button>
              {addOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
                  <div className="absolute right-0 top-6 z-20 w-56 rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
                    {TASK_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          set("tasks", [...form.tasks, { ...newTask(t), tip: form.tipSol }]);
                          setAddOpen(false);
                        }}
                        className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-hover-100"
                      >
                        <span className="text-xs font-medium text-text-100">{TASK_META[t].label}</span>
                        <span className="text-[10px] text-text-300">{TASK_META[t].short}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <div className="relative">
              <button type="button" onClick={() => setPresetOpen((o) => !o)} className="inline-flex h-5 items-center gap-1 rounded border border-line-100 bg-bg-50 px-1.5 text-[10px] font-medium text-text-200 hover:bg-white/[0.04]">
                Presets
              </button>
              {presetOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPresetOpen(false)} />
                  <div className="absolute right-0 top-6 z-20 w-72 rounded-md border border-line-100 bg-bg-50 p-2 shadow-xl">
                    <div className="mb-2 flex gap-1">
                      <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save setup as…" className="h-7 min-w-0 flex-1 rounded border border-line-100 bg-input-100 px-2 text-[11px] text-text-100 outline-none focus:border-accent" />
                      <button type="button" disabled={!presetName.trim()} onClick={() => { onPreset("save", undefined, presetName.trim()); setPresetName(""); }} className="h-7 rounded bg-accent px-2 text-[11px] font-medium text-white disabled:opacity-40">
                        Save
                      </button>
                    </div>
                    {!presets.length ? <p className="px-1 py-2 text-[11px] text-text-300">No preset yet. A preset keeps everything except the image.</p> : null}
                    {presets.map((p) => (
                      <div key={p.id} className="flex items-center gap-1 rounded px-1 py-1 text-[11px] hover:bg-hover-100">
                        <span className="min-w-0 flex-1 truncate text-text-100">{p.name}</span>
                        <button type="button" onClick={() => { onPreset("load", p); setPresetOpen(false); }} className="rounded border border-line-100 px-1.5 py-0.5 text-text-200 hover:text-text-100">
                          Load
                        </button>
                        <button type="button" onClick={() => { onPreset("quick", p); setPresetOpen(false); }} className="rounded bg-accent px-1.5 py-0.5 text-white">
                          Quick launch
                        </button>
                        <button type="button" onClick={() => onPreset("delete", p)} className="flex h-5 w-5 items-center justify-center text-text-300 hover:text-decrease" aria-label="Delete preset">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="text-[10px] text-text-300">{live?.restored ? "restored after restart" : live?.status}</span>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {!readOnly ? (
          <div className="flex h-8 shrink-0 items-center justify-end gap-3 border-b border-line-50 px-3 text-[11px]">
            <div className="flex items-center gap-0.5">
              {quick.map((p, i) => (
                <button key={i} type="button" onClick={() => set("devBuySol", p)} className={cx("rounded px-1.5 py-0.5 font-medium", form.devBuySol === p ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100")} title={`Dev buy ${p} SOL`}>
                  P{i + 1}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 uppercase text-text-300">
              Slippage
              <input type="number" min={0} max={100} value={form.slippageBps / 100} onChange={(e) => set("slippageBps", Math.round(Number(e.target.value) * 100))} className="h-5 w-12 rounded border border-transparent bg-input-100 px-1 text-right font-mono text-[11px] normal-case text-text-100 outline-none hover:border-line-200 focus:border-line-200" />
              %
            </label>
            <label className="flex items-center gap-1 uppercase text-text-300">
              Tip (SOL)
              <input type="number" step="0.0001" min={0} value={form.tipSol} onChange={(e) => set("tipSol", e.target.value)} className="h-5 w-16 rounded border border-transparent bg-input-100 px-1 text-right font-mono text-[11px] normal-case text-text-100 outline-none hover:border-line-200 focus:border-line-200" />
            </label>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Dev task */}
          <div className="task-card">
            <div className="flex h-10 items-center gap-2 px-3">
              <ChevronDown className="h-3.5 w-3.5 text-text-300" />
              <span className="text-sm font-medium text-text-100">Dev</span>
              <span className="text-text-300" title="The developer wallet creates the token and makes the first buy">
                <Info className="h-3 w-3" />
              </span>
              {dev ? <span className="text-xs text-text-300">{dev.label || short(dev.address)} · {sol(devBal)} SOL</span> : null}
              <button type="button" disabled={!live || !onDump} onClick={onDump} className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-decrease/40 px-2 text-[11px] font-medium text-decrease hover:bg-decrease/10 disabled:cursor-not-allowed disabled:opacity-40" title={live ? "Sell 100 % on every wallet of this launch" : "Available once the token is launched"}>
                <Trash2 className="h-3 w-3" /> Dump All
              </button>
            </div>
            {!readOnly ? (
              !dev ? (
                <p className="px-3 pb-3 text-xs text-text-300">Select a developer wallet for this launch to manage the dev task.</p>
              ) : (
                <div className="flex flex-wrap items-end gap-3 border-t border-line-50 px-3 pb-3 pt-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wider text-text-300">Dev buy ({unit})</span>
                    <input
                      type="number"
                      step={unit === "SOL" ? "0.01" : "0.1"}
                      min={0}
                      value={unit === "SOL" ? form.devBuySol : devPct.toFixed(2)}
                      onChange={(e) => set("devBuySol", unit === "SOL" ? e.target.value : solForSupplyPct(Number(e.target.value) || 0).toFixed(4))}
                      className="h-7 w-28 rounded border border-line-100 bg-input-100 px-2 font-mono text-xs text-text-100 outline-none focus:border-accent"
                    />
                  </label>
                  <span className="pb-1.5 text-[11px] text-text-300">{unit === "SOL" ? `≈ ${devPct.toFixed(2)}% of supply` : `≈ ${sol(Number(form.devBuySol) || 0)} SOL`}</span>
                  <label className="ml-auto flex items-center gap-1.5 pb-1 text-[11px] text-text-300">
                    Cashback coin
                    <BxSwitch checked={form.cashback} onChange={(v) => set("cashback", v)} />
                  </label>
                </div>
              )
            ) : null}
          </div>
          {readOnly && live ? (
            <div className="flex flex-col">
              {live.restored ? <p className="border-b border-line-50 bg-yellow-100/10 px-3 py-2 text-[11px] text-yellow-100">{live.restored.note}</p> : null}
              {!live.tasks.length ? <p className="px-3 py-4 text-xs text-text-300">No task on this launch.</p> : null}
              {live.tasks.map((t) => (
                <LiveTaskRow key={t.id} launchId={launchId ?? live.id} t={t} />
              ))}
            </div>
          ) : (
            <>
              {form.tasks.map((t) => (
                <TaskCard key={t.id} task={t} wallets={wallets} groups={groups} balances={balances} onChange={(nt) => set("tasks", form.tasks.map((x) => (x.id === t.id ? nt : x)))} onRemove={() => set("tasks", form.tasks.filter((x) => x.id !== t.id))} />
              ))}
              {!form.tasks.length ? <p className="px-3 py-4 text-xs text-text-300">No task yet — Add Task: Bundle buys inside the create bundle, Sniper right after it, Buy / Volume keep trading, Wash moves tokens to fresh wallets.</p> : null}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function LiveTaskRow({ launchId, t }: { launchId: string; t: LaunchTaskState }) {
  const [busy, setBusy] = useState(false);
  const meta = TASK_META[t.type];
  const act = async (action: "pause" | "resume" | "stop") => {
    setBusy(true);
    try {
      await post<TaskActionResponse>(`/api/launch/${launchId}/tasks/${t.id}/${action}`, {});
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const pct = t.total ? Math.round((t.done / t.total) * 100) : t.status === "done" ? 100 : 0;
  const tone = t.status === "error" ? "bg-decrease" : t.status === "done" ? "bg-green-100" : t.status === "paused" || t.status === "stopped" ? "bg-yellow-100" : t.status === "running" ? "bg-accent" : "bg-text-300";
  const pausable = PAUSABLE_TASKS.includes(t.type);
  const activeNow = t.status === "running" || t.status === "paused" || t.status === "pending";
  return (
    <div className="task-card flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className={cx("h-2 w-2 rounded-full", tone, t.status === "running" ? "animate-pulse" : "")} />
        <span className="font-medium text-text-100">{meta.label}</span>
        <span className="text-text-300">{TASK_STATUS_WORD[t.status]}</span>
        <span className="ml-auto font-mono text-[11px] text-text-300">
          {t.done}/{t.total ?? "∞"} · {t.sent} sent{t.failed ? ` · ${t.failed} failed` : ""} · {t.wallets.length} wallets
        </span>
        {activeNow && pausable && t.status === "running" ? (
          <button type="button" disabled={busy} onClick={() => act("pause")} className="inline-flex h-5 items-center gap-1 rounded border border-line-100 px-1.5 text-[10px] text-text-200 hover:text-text-100">
            <Pause className="h-3 w-3" /> Pause
          </button>
        ) : null}
        {(t.status === "paused" || t.resumable) ? (
          <button type="button" disabled={busy} onClick={() => act("resume")} className="inline-flex h-5 items-center gap-1 rounded bg-accent px-1.5 text-[10px] text-white">
            <Play className="h-3 w-3" /> Resume
          </button>
        ) : null}
        {activeNow ? (
          <button type="button" disabled={busy} onClick={() => act("stop")} className="inline-flex h-5 items-center gap-1 rounded border border-decrease/40 px-1.5 text-[10px] text-decrease hover:bg-decrease/10">
            <Square className="h-3 w-3" /> Stop
          </button>
        ) : null}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line-50">
        <div className={cx("h-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      {t.error ? <p className="text-[11px] text-decrease">{t.error}</p> : null}
    </div>
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
                <p className="text-sm font-semibold leading-none tabular-nums text-text-100">{c ? (c.marketCapUsd !== null ? usd(c.marketCapUsd) : price.data ? usd(c.marketCapSol * price.data.usd) : `${sol(c.marketCapSol)} SOL`) : "—"}</p>
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
export function RightRail({ canLaunch, onLaunch, onClaim, claimBusy, launched, launchTitle }: { canLaunch: boolean; onLaunch: () => void; onClaim?: () => void; claimBusy?: boolean; launched: boolean; launchTitle?: string }) {
  const btn = "group flex w-full flex-col items-center justify-center gap-1 rounded-md border border-line-100 bg-bg-50 px-1 py-2 text-center transition-colors hover:bg-white/[0.04] hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <aside className="flex min-h-0 shrink-0 flex-col border-l border-line-100 bg-bg-100" aria-label="Launch options" style={{ width: 72 }}>
      <div className="flex items-center justify-center border-b border-line-50 px-2 py-2">
        <span className="h-6" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <button type="button" onClick={() => (canLaunch ? onLaunch() : launchTitle ? toast(launchTitle, "err") : null)} disabled={launched} className={cx(btn, !canLaunch && !launched ? "opacity-70" : "")} title={launched ? "Already launched" : canLaunch ? "Review and launch" : (launchTitle ?? "Open a draft first")}>
          <Rocket className="h-3.5 w-3.5 shrink-0 text-text-300 transition-colors group-hover:text-text-100" />
          <span className="max-w-full text-center text-[10px] font-medium leading-tight text-text-200">Launch</span>
        </button>
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
