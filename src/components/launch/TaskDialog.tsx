"use client";
/** Block X task setup dialogs (BEHAVIOUR.md §4.4): Bundle · Sniper · Volume · Buy · Wash. Common header with the task
 *  preset bar (Load task preset ▾ · Save as preset · Update · Delete), common Wallets block (Amount / Slider, wallet
 *  groups), footer Cancel / Add … Task. Task presets live in /api/presets with ids `task:<type>:…`. */
import { useMemo, useState } from "react";
import { Check, ChevronDown, Info, Save, Trash2, X } from "lucide-react";
import type { LaunchPreset, LaunchTaskType, PresetsResponse, WalletGroup, WalletInfo } from "@/lib/types";
import { TASK_LIMITS } from "@/lib/types";
import { failureMessage, post, useGet } from "@/lib/api";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxSwitch, cx } from "@/components/bx/ui";
import { useLaunchCalc } from "./calc";
import { TASK_META, newId, newTask, taskBuyFor, taskWallets, validateTask, type FormTask, type LaunchForm } from "./model";

type Props = {
  type: LaunchTaskType;
  /** editing an existing task (else a new one) */
  initial?: FormTask;
  form: LaunchForm;
  wallets: WalletInfo[];
  groups: WalletGroup[];
  balances: Record<string, string | null> | null;
  /** "SOL" = amounts in SOL · "%" = percent of each wallet's SOL balance (Tasks panel segmented SOL / %) */
  unit: "SOL" | "%";
  onSubmit: (t: FormTask) => void;
  onClose: () => void;
};

const num = "h-8 w-full rounded-md border border-line-100 bg-input-100 px-2 font-mono text-xs text-text-100 outline-none placeholder:text-text-300 focus:border-accent disabled:cursor-not-allowed disabled:opacity-40";
const presetIdFor = (type: LaunchTaskType, name: string) => `task:${type}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function TaskDialog({ type, initial, form, wallets, groups, balances, unit, onSubmit, onClose }: Props) {
  const [task, setTask] = useState<FormTask>(() => initial ?? { ...newTask(type), tip: form.tipSol });
  const [mode, setMode] = useState<"amount" | "slider">("amount");
  const [presetSel, setPresetSel] = useState("");
  const [saveName, setSaveName] = useState<string | null>(null);
  const presetsQ = useGet<PresetsResponse>("/api/presets", 0);
  const taskPresets = (presetsQ.data?.presets ?? []).filter((p) => p.id.startsWith(`task:${type}:`));
  const meta = TASK_META[type];
  const set = <K extends keyof FormTask>(k: K, v: FormTask[K]) => setTask((t) => ({ ...t, [k]: v }));
  const problems = validateTask(task);
  const balOf = (a: string) => Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0;
  const picked = taskWallets(task, wallets);
  const cap = type === "bundle" ? TASK_LIMITS.maxWalletsPerBundleTask : TASK_LIMITS.maxWalletsPerTask;
  const isBuyLike = type === "bundle" || type === "sniper" || type === "buy";
  /** the Buy task has its own unit (default % of balance, read at the moment of each buy); the others follow the page */
  const u: "SOL" | "%" = type === "buy" ? (task.buyUnit ?? "SOL") : unit;
  const bundleSols = type === "bundle" ? picked.map((a) => taskBuyFor(task, a)) : form.tasks.filter((t) => t.type === "bundle" && t.id !== task.id).flatMap((t) => taskWallets(t, wallets).map((a) => taskBuyFor(t, a)));
  const calc = useLaunchCalc(Number(form.devBuySol) || 0, bundleSols);

  const applyPreset = (p: LaunchPreset) => {
    const d = p.data as Partial<FormTask>;
    setTask((t) => ({ ...newTask(type), ...d, id: t.id, type }));
    setPresetSel(p.id);
  };
  const savePreset = async (name: string, id?: string) => {
    try {
      const { id: _id, ...data } = task;
      void _id;
      await post("/api/presets", { preset: { id: id ?? presetIdFor(type, name), name, data } });
      await presetsQ.refresh();
      setPresetSel(id ?? presetIdFor(type, name));
      setSaveName(null);
      toast(`Preset “${name}” ${id ? "updated" : "saved"}`, "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const deletePreset = async () => {
    const p = taskPresets.find((x) => x.id === presetSel);
    if (!p) return;
    try {
      await post("/api/presets", { remove: p.id });
      await presetsQ.refresh();
      setPresetSel("");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const toggleWallet = (a: string) => {
    const on = task.walletIds.includes(a);
    if (!on && picked.length >= cap) return toast(`At most ${cap} wallets`, "err");
    set("walletIds", on ? task.walletIds.filter((x) => x !== a) : [...task.walletIds, a]);
  };
  const toggleGroup = (id: string) => set("walletGroupIds", task.walletGroupIds.includes(id) ? task.walletGroupIds.filter((x) => x !== id) : [...task.walletGroupIds, id]);
  /** per-wallet amount as typed (SOL, or % of the wallet balance in % mode) */
  const amountOf = (a: string) => task.walletBuyAmounts[a] ?? "";
  const setAmount = (a: string, v: string) => {
    const next = { ...task.walletBuyAmounts };
    if (v === "") delete next[a];
    else next[a] = v;
    set("walletBuyAmounts", next);
  };
  const submit = () => {
    if (problems.length) return toast(problems[0], "err");
    let out = { ...task };
    if (type === "buy" && u === "%") {
      // % of balance stays a %: the server reads each wallet's SOL when it buys (a wallet funded later buys its 90 % too)
      return onSubmit(out);
    }
    if (u === "%" && isBuyLike) {
      // convert % of balance into SOL per wallet (fees kept aside by the server)
      const conv: Record<string, string> = {};
      for (const a of picked) {
        const pct = Number(task.walletBuyAmounts[a] ?? task.buyAmount) || 0;
        conv[a] = ((balOf(a) * pct) / 100).toFixed(4);
      }
      out = { ...out, walletBuyAmounts: conv, buyAmount: task.buyAmount };
    }
    if (type === "buy") {
      // Buy task amount = the per-wallet amount of the Wallets block (min/max of the picked rows)
      const sols = picked.map((a) => Number(out.walletBuyAmounts[a] ?? out.buyAmount) || 0).filter((n) => n > 0);
      if (sols.length) out = { ...out, minTradeAmount: String(Math.min(...sols)), maxTradeAmount: String(Math.max(...sols)) };
    }
    onSubmit(out);
  };

  return (
    <div className="fixed inset-0 z-[205] flex items-center justify-center p-4" style={{ background: "var(--modal-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="relative z-[206] flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-line-100 bg-bg-100 shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between gap-2 border-b border-line-100 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-sm font-semibold text-text-100">{meta.title} Setup</h2>
            <span className="text-text-300" title={meta.blurb}>
              <Info className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <select value={presetSel} onChange={(e) => { const p = taskPresets.find((x) => x.id === e.target.value); if (p) applyPreset(p); else setPresetSel(""); }} className="h-7 appearance-none rounded-md border border-line-100 bg-bg-50 pl-2 pr-6 text-[11px] text-text-200 outline-none focus:border-accent" aria-label="Load task preset" title="Load task preset">
                <option value="">{taskPresets.length ? "Load task preset" : "No presets"}</option>
                {taskPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-300" />
            </div>
            {saveName === null ? (
              <button type="button" onClick={() => setSaveName("")} className="inline-flex h-7 items-center gap-1 rounded-md border border-line-100 bg-bg-50 px-2 text-[11px] font-medium text-text-200 hover:bg-white/[0.04] hover:text-text-100" title="Save current settings as a new preset">
                <Save className="h-3 w-3" /> Save as preset
              </button>
            ) : (
              <span className="flex items-center gap-1">
                <input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && saveName.trim()) savePreset(saveName.trim()); if (e.key === "Escape") setSaveName(null); }} placeholder="Preset name" className="h-7 w-32 rounded-md border border-line-100 bg-input-100 px-2 text-[11px] text-text-100 outline-none focus:border-accent" />
                <button type="button" disabled={!saveName.trim()} onClick={() => savePreset(saveName.trim())} className="h-7 rounded-md bg-accent px-2 text-[11px] font-medium text-white disabled:opacity-40">
                  Save
                </button>
              </span>
            )}
            <button type="button" disabled={!presetSel} onClick={() => { const p = taskPresets.find((x) => x.id === presetSel); if (p) savePreset(p.name, p.id); }} className="h-7 rounded-md border border-line-100 bg-bg-50 px-2 text-[11px] font-medium text-text-200 hover:bg-white/[0.04] hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40" title="Overwrite selected preset">
              Update
            </button>
            <button type="button" disabled={!presetSel} onClick={deletePreset} className="flex h-7 w-7 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 hover:text-decrease disabled:cursor-not-allowed disabled:opacity-40" title="Delete selected preset" aria-label="Delete preset">
              <Trash2 className="h-3 w-3" />
            </button>
            <button type="button" onClick={onClose} className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-text-300 hover:bg-white/[0.06] hover:text-text-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {type === "bundle" ? <p className="text-[11px] text-text-300">At most 4 wallets — each buys in its own transaction so they show as different buyers. Runs with the create transaction: no start, pause or stop.</p> : null}

          {/* ---------------------------------------------------------- wallets */}
          {type !== "wash" ? (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-text-100">
                  Wallets <span className={cx("font-mono text-text-300", picked.length > cap ? "text-decrease" : "")}>{picked.length}/{cap}</span>
                </h3>
                {isBuyLike ? (
                  <div className="flex items-center gap-1.5">
                  {type === "buy" ? (
                    <div className="flex h-6 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5" title="% of balance: each wallet buys that share of the SOL it holds when its buy fires">
                      {(["%", "SOL"] as const).map((x) => (
                        <button key={x} type="button" onClick={() => x !== u && setTask((t) => ({ ...t, buyUnit: x, buyAmount: x === "%" ? "90" : "0.1", walletBuyAmounts: {} }))} className={cx("h-full rounded px-2 text-[10px] font-medium transition-colors", u === x ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                          {x === "%" ? "% of balance" : "SOL"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex h-6 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
                    {(["amount", "slider"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setMode(m)} className={cx("h-full rounded px-2 text-[10px] font-medium capitalize transition-colors", mode === m ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")} title={m === "amount" ? `Type the ${u === "%" ? "% of balance" : "SOL"} per wallet` : `Drag the ${u === "%" ? "% of balance" : "SOL"} per wallet`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  </div>
                ) : null}
              </div>
              {isBuyLike ? (
                <label className="flex items-center gap-2 text-[11px] text-text-300">
                  Default per wallet
                  <span className="relative">
                    <input inputMode="decimal" value={task.buyAmount} onChange={(e) => set("buyAmount", e.target.value.replace(/[^0-9.]/g, ""))} className={cx(num, "h-7 w-24 pr-8")} />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-300">{u}</span>
                  </span>
                  <span>{type === "buy" && u === "%" ? "of the SOL each wallet holds when it buys (fees kept aside)" : "applies to every wallet without its own value"}</span>
                </label>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {!groups.length ? <p className="text-[11px] text-text-300">No wallet groups yet. Create groups in Portfolio to use them here.</p> : null}
                {groups.map((g) => {
                  const on = task.walletGroupIds.includes(g.id);
                  const n = wallets.filter((w) => w.group === g.id).length;
                  return (
                    <button key={g.id} type="button" onClick={() => toggleGroup(g.id)} className={cx("inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors", on ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200 hover:border-line-200 hover:text-text-100")} title={`${g.name}: ${n} wallet${n !== 1 ? "s" : ""} (expanded at launch, archived skipped)`}>
                      {on ? <Check className="h-3 w-3" /> : null}
                      {g.name} <span className="font-mono text-text-300">{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-line-100 bg-bg-50 p-1">
                {!wallets.length ? <p className="px-2 py-3 text-xs text-text-300">No developer wallets yet. Create them in Portfolio.</p> : null}
                {wallets.map((w) => {
                  const on = picked.includes(w.address);
                  const viaGroup = !task.walletIds.includes(w.address) && on;
                  const bal = balOf(w.address);
                  const max = u === "%" ? 100 : Math.max(0, bal - 0.01);
                  return (
                    <div key={w.address} className={cx("flex h-8 items-center gap-2 rounded px-2 text-xs", on ? "bg-accent-muted" : "hover:bg-hover-100")}>
                      <input type="checkbox" className="pi-checkbox" checked={on} disabled={viaGroup} onChange={() => toggleWallet(w.address)} aria-label={`Select ${w.label || short(w.address)}`} />
                      <span className="min-w-0 flex-1 truncate text-text-100">{w.label || short(w.address)}</span>
                      <span className="font-mono text-[11px] text-text-300">{short(w.address, 4, 4)}</span>
                      <span className="w-16 text-right font-mono text-[11px] tabular-nums text-text-200">{sol(bal)} SOL</span>
                      {isBuyLike && on ? (
                        mode === "amount" ? (
                          <span className="relative">
                            <input inputMode="decimal" placeholder={task.buyAmount} value={amountOf(w.address)} onChange={(e) => setAmount(w.address, e.target.value.replace(/[^0-9.]/g, ""))} className={cx(num, "h-6 w-20 pr-7 text-[11px]")} title={`${u} for this wallet (blank = default)`} />
                            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-text-300">{u}</span>
                          </span>
                        ) : (
                          <span className="flex w-36 items-center gap-1.5">
                            <input type="range" min={0} max={max} step={u === "%" ? 1 : 0.01} value={Number(amountOf(w.address) || task.buyAmount) || 0} onChange={(e) => setAmount(w.address, e.target.value)} className="consolidate-slider min-w-0 flex-1" aria-label={`Amount for ${w.label}`} />
                            <span className="w-12 text-right font-mono text-[10px] text-text-200">{amountOf(w.address) || task.buyAmount}{u === "%" ? "%" : ""}</span>
                          </span>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* ---------------------------------------------------------- per type */}
          {type === "bundle" ? (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-text-100">Bundle calculator — Pump.fun curve</h3>
                <table className="w-full border-collapse overflow-hidden rounded-lg border border-input-200 text-xs">
                  <thead>
                    <tr className="text-[11px] text-text-300">
                      <th className="h-8 w-8 border-b border-r border-input-200 px-2 text-center font-normal">#</th>
                      <th className="h-8 border-b border-r border-input-200 px-2 text-left font-normal">BUYER</th>
                      <th className="h-8 w-24 border-b border-r border-input-200 px-2 text-right font-normal">SOL</th>
                      <th className="h-8 w-24 border-b border-input-200 px-2 text-right font-normal">SUPPLY</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border-b border-r border-input-200 px-2 py-1.5 text-center text-text-300">1</td>
                      <td className="border-b border-r border-input-200 px-2 py-1.5 text-text-100">Dev buy</td>
                      <td className="border-b border-r border-input-200 px-2 py-1.5 text-right font-mono text-text-100">{sol(calc.dev.sol)}</td>
                      <td className="border-b border-input-200 px-2 py-1.5 text-right font-mono text-text-100">{calc.dev.supplyPct.toFixed(2)}%</td>
                    </tr>
                    {picked.map((a, i) => {
                      const w = wallets.find((x) => x.address === a);
                      const row = calc.bundle[i];
                      const bal = balOf(a);
                      const over = unit === "SOL" && taskBuyFor(task, a) > bal;
                      return (
                        <tr key={a}>
                          <td className="border-b border-r border-input-200 px-2 py-1.5 text-center text-text-300">{i + 2}</td>
                          <td className="border-b border-r border-input-200 px-2 py-1.5 text-text-100">
                            {w?.label || short(a)}
                            {over ? <span className="ml-2 text-[10px] text-decrease">exceeds balance {sol(bal)} SOL</span> : null}
                          </td>
                          <td className="border-b border-r border-input-200 px-2 py-1.5 text-right font-mono text-text-100">{sol(row?.sol ?? taskBuyFor(task, a))}</td>
                          <td className="border-b border-input-200 px-2 py-1.5 text-right font-mono text-text-100">{(row?.supplyPct ?? 0).toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-surface-muted">
                      <td className="border-r border-input-200 px-2 py-1.5" />
                      <td className="border-r border-input-200 px-2 py-1.5 font-medium text-text-100">Dev + bundle</td>
                      <td className="border-r border-input-200 px-2 py-1.5 text-right font-mono font-medium text-text-100">{sol(calc.total.sol)}</td>
                      <td className="px-2 py-1.5 text-right font-mono font-medium text-text-100">{calc.total.supplyPct.toFixed(2)}%</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[11px] text-text-300">Buys land in this order in one bundle, after fees.{calc.source === "local" ? " Figures from the fresh-curve formula (1.25 % fee netted)." : ""}</p>
              </section>
              <div className="grid grid-cols-2 gap-3">
                <F label="Slippage %">
                  <input inputMode="decimal" value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value) || 0)} className={num} />
                </F>
                <F label="Tip (SOL)">
                  <input inputMode="decimal" value={task.tip} onChange={(e) => set("tip", e.target.value.replace(/[^0-9.]/g, ""))} className={num} />
                </F>
              </div>
              <Threshold label="Sell all on external" hint="Sell 100% of bundle wallets when net external SOL hits the threshold" task={task} set={set} />
            </>
          ) : null}

          {type === "sniper" ? (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-text-100">Timing &amp; execution</h3>
                <p className="text-[11px] text-text-300">Delay between wallet buys · 0 = all instant</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <F label="Min delay (sec)">
                    <DecimalInput value={task.minDelaySec} onChange={(v) => set("minDelaySec", v)} className={num} />
                  </F>
                  <F label="Max delay (sec)">
                    <DecimalInput value={task.maxDelaySec} onChange={(v) => set("maxDelaySec", v)} className={num} />
                  </F>
                  <F label="Slippage %">
                    <input inputMode="decimal" placeholder="20" value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value) || 0)} className={num} />
                  </F>
                  <F label="Tip (SOL)">
                    <input inputMode="decimal" value={task.tip} onChange={(e) => set("tip", e.target.value.replace(/[^0-9.]/g, ""))} className={num} />
                  </F>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex items-center gap-2 text-xs text-text-100">
                    Retry
                    <BxSwitch checked={task.retry} onChange={(v) => set("retry", v)} />
                    <span className="text-text-300">{task.retry ? "On" : "Off"}</span>
                  </label>
                  <F label="Max retries">
                    <input type="number" min={0} max={TASK_LIMITS.maxAutoRetryCount} disabled={!task.retry} value={task.autoRetryCount} onChange={(e) => set("autoRetryCount", Math.max(0, Math.min(TASK_LIMITS.maxAutoRetryCount, Number(e.target.value) || 0)))} className={cx(num, "w-24")} />
                  </F>
                </div>
              </section>
              <Threshold label="Stop on activity" hint="Cancel this task when net external volume hits the threshold" task={task} set={set} />
            </>
          ) : null}

          {type === "volume" || type === "buy" ? (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-text-100">Execution</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {type === "volume" ? (
                    <F label="Mode">
                      <div className="relative">
                        <select value={task.tradeMode} onChange={(e) => set("tradeMode", e.target.value as FormTask["tradeMode"])} className={cx(num, "appearance-none pr-6")}>
                          <option value="buy">Buy only</option>
                          <option value="sell">Sell only</option>
                          <option value="both">Buy + Sell</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-300" />
                      </div>
                    </F>
                  ) : null}
                  <F label="Min (s)">
                    <DecimalInput value={task.minIntervalSec} onChange={(v) => set("minIntervalSec", v)} className={num} />
                  </F>
                  <F label="Max (s)">
                    <DecimalInput value={task.maxIntervalSec} onChange={(v) => set("maxIntervalSec", v)} className={num} />
                  </F>
                  {type === "volume" ? (
                    <>
                      <F label="Min (SOL)">
                        <input inputMode="decimal" value={task.minTradeAmount} onChange={(e) => set("minTradeAmount", e.target.value.replace(/[^0-9.]/g, ""))} className={num} />
                      </F>
                      <F label="Max (SOL)">
                        <input inputMode="decimal" value={task.maxTradeAmount} onChange={(e) => set("maxTradeAmount", e.target.value.replace(/[^0-9.]/g, ""))} className={num} />
                      </F>
                    </>
                  ) : null}
                  <F label="Slippage %">
                    <input inputMode="decimal" value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value) || 0)} className={num} />
                  </F>
                  <F label="Tip (SOL)">
                    <input inputMode="decimal" value={task.tip} onChange={(e) => set("tip", e.target.value.replace(/[^0-9.]/g, ""))} className={num} />
                  </F>
                  {type === "volume" && task.tradeMode === "both" ? (
                    <F label={`Buy ratio ${task.buyRatioPercent}%`}>
                      <input type="range" min={0} max={100} value={task.buyRatioPercent} onChange={(e) => set("buyRatioPercent", Number(e.target.value))} className="consolidate-slider mt-2 w-full" />
                    </F>
                  ) : null}
                </div>
                <label className="flex items-center gap-2 text-xs text-text-100">
                  <BxSwitch checked={task.autoStart} onChange={(v) => set("autoStart", v)} />
                  Auto-Start
                  <span className="text-[11px] text-text-300">{type === "buy" ? "Fire buys as soon as the token mint is known at launch" : "Start trading as soon as the token mint is known at launch"}</span>
                </label>
                {type === "volume" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Duration Limit (min)">
                      <input type="number" min={1} max={TASK_LIMITS.maxDurationMinutes} placeholder="No limit" value={task.maxDurationMinutes} onChange={(e) => set("maxDurationMinutes", e.target.value)} className={num} />
                    </F>
                    <F label="Max Trades per Wallet">
                      <input type="number" min={1} max={TASK_LIMITS.maxTradesPerWallet} placeholder="No limit" value={task.maxTradesPerWallet} onChange={(e) => set("maxTradesPerWallet", e.target.value)} className={num} />
                    </F>
                  </div>
                ) : null}
              </section>
              <Threshold label="Stop on activity" hint="Cancel this task when net external volume hits the threshold" task={task} set={set} />
            </>
          ) : null}

          {type === "wash" ? <WashSetup task={task} set={set} form={form} wallets={wallets} groups={groups} balances={balances} /> : null}

          {problems.length ? (
            <ul className="text-[11px] text-decrease">
              {problems.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line-100 px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-md border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-200 transition-colors hover:bg-white/[0.04]">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!!problems.length} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
            {initial ? `Save ${meta.title}` : `Add ${meta.title}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** seconds with decimals: "0,5" or "0.5" (a type=number input fed back through Number() turned "0." into 0 at every
 *  keystroke, so no decimal could be typed). Keeps what is typed, reports the number once it parses. */
function DecimalInput({ value, onChange, className }: { value: number; onChange: (v: number) => void; className?: string }) {
  const [text, setText] = useState(() => String(value ?? 0));
  const shown = Number(text.replace(",", ".")) === value || text === "" ? text : String(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.,]/g, "");
        setText(raw);
        const n = Number(raw.replace(",", "."));
        if (raw !== "" && Number.isFinite(n)) onChange(n);
        else if (raw === "") onChange(0);
      }}
      className={className}
    />
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-text-300">{label}</span>
      {children}
    </label>
  );
}

function Threshold({ label, hint, task, set }: { label: string; hint: string; task: FormTask; set: <K extends keyof FormTask>(k: K, v: FormTask[K]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-100 bg-bg-50 px-3 py-2">
      <label className="flex items-center gap-2 text-xs text-text-100">
        <BxSwitch checked={task.stopOnActivity} onChange={(v) => set("stopOnActivity", v)} />
        {label}
      </label>
      <span className="min-w-0 flex-1 text-[11px] text-text-300">{hint}</span>
      <span className="relative">
        <input inputMode="decimal" disabled={!task.stopOnActivity} value={task.stopOnActivitySol} onChange={(e) => set("stopOnActivitySol", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className={cx(num, "h-7 w-24 pr-9")} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-300">SOL</span>
      </span>
    </div>
  );
}

/** Wash: 1. Source wallets (dev + bundle/sniper wallets) · 2. Wash wallets (per source 1–3, auto-pair from group) · 3. Delay between pairs */
function WashSetup({ task, set, form, wallets, groups, balances }: { task: FormTask; set: <K extends keyof FormTask>(k: K, v: FormTask[K]) => void; form: LaunchForm; wallets: WalletInfo[]; groups: WalletGroup[]; balances: Record<string, string | null> | null }) {
  const [from, setFrom] = useState<string>("any");
  const candidates = useMemo(() => {
    const set = new Set<string>();
    if (form.devWallet) set.add(form.devWallet);
    for (const t of form.tasks) if (t.type === "bundle" || t.type === "sniper") for (const a of taskWallets(t, wallets)) set.add(a);
    return [...set];
  }, [form, wallets]);
  const marked = Object.keys(task.washPairs);
  const used = new Set([...candidates, ...Object.values(task.washPairs).flat()]);
  const pool = wallets.filter((w) => !used.has(w.address) && (from === "any" || w.group === from));
  const toggleSource = (a: string) => {
    const next = { ...task.washPairs };
    if (next[a]) delete next[a];
    else next[a] = [];
    set("washPairs", next);
  };
  const autoPair = () => {
    const next: Record<string, string[]> = {};
    const free = wallets.filter((w) => !candidates.includes(w.address) && (from === "any" || w.group === from)).map((w) => w.address);
    let i = 0;
    for (const s of marked) {
      next[s] = [];
      for (let k = 0; k < task.washPerSource && i < free.length; k++) next[s].push(free[i++]);
    }
    set("washPairs", next);
    if (i < marked.length * task.washPerSource) toast(`Only ${i} wash wallet${i !== 1 ? "s" : ""} available ${from === "any" ? "in the vault" : "in this group"}`, "info");
  };
  const setPair = (s: string, idx: number, a: string) => {
    const arr = [...(task.washPairs[s] ?? [])];
    if (a) arr[idx] = a;
    else arr.splice(idx, 1);
    set("washPairs", { ...task.washPairs, [s]: arr.filter(Boolean).slice(0, task.washPerSource) });
  };
  const balOf = (a: string) => Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0;
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-text-100">
          1. Source wallets <span className="font-mono text-text-300">{marked.length} marked</span>
        </h3>
        {!candidates.length ? (
          <p className="text-[11px] text-text-300">Pick a dev wallet or add a Bundle or Sniper task first. Their wallets show up here.</p>
        ) : (
          <div className="flex flex-col gap-0.5 rounded-md border border-line-100 bg-bg-50 p-1">
            {candidates.map((a) => {
              const w = wallets.find((x) => x.address === a);
              const on = !!task.washPairs[a];
              return (
                <label key={a} className={cx("flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-xs", on ? "bg-accent-muted" : "hover:bg-hover-100")}>
                  <input type="checkbox" className="pi-checkbox" checked={on} onChange={() => toggleSource(a)} />
                  <span className="min-w-0 flex-1 truncate text-text-100">{w?.label || short(a)}</span>
                  <span className="text-[10px] text-text-300">{a === form.devWallet ? "dev" : "task wallet"}</span>
                  <span className="font-mono text-[11px] text-text-300">{short(a, 4, 4)}</span>
                </label>
              );
            })}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-text-100">2. Wash wallets</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-text-300">
            Per source
            <span className="flex h-7 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
              {([1, 2, 3] as const).map((n) => (
                <button key={n} type="button" onClick={() => set("washPerSource", n)} className={cx("h-full rounded px-2 text-[11px] font-medium transition-colors", task.washPerSource === n ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                  {n}
                </button>
              ))}
            </span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text-300">
            Auto-pair from
            <span className="relative">
              <select value={from} onChange={(e) => setFrom(e.target.value)} className={cx(num, "h-7 w-40 appearance-none pr-6 font-sans")}>
                <option value="any">Any wallet</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-300" />
            </span>
          </label>
          <button type="button" disabled={!marked.length} onClick={autoPair} className="h-7 rounded-md border border-line-100 bg-bg-50 px-2.5 text-[11px] font-medium text-text-200 hover:bg-white/[0.04] hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40">
            Auto-pair
          </button>
        </div>
        {!marked.length ? (
          <p className="text-[11px] text-text-300">Mark source wallets above to pair them.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {marked.map((s) => {
              const sw = wallets.find((x) => x.address === s);
              const pairs = task.washPairs[s] ?? [];
              return (
                <div key={s} className="flex flex-col gap-1 rounded-md border border-line-100 bg-bg-50 px-2 py-1.5 text-xs">
                  <span className="text-text-100">
                    {sw?.label || short(s)} <span className="text-text-300">→</span>
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: task.washPerSource }).map((_, i) => (
                      <span key={i} className="relative">
                        <select value={pairs[i] ?? ""} onChange={(e) => setPair(s, i, e.target.value)} className={cx(num, "h-7 w-44 appearance-none pr-6 font-sans text-[11px]")}>
                          <option value="">— pick a wash wallet —</option>
                          {[...pool, ...wallets.filter((w) => pairs[i] === w.address)].map((w) => (
                            <option key={w.address} value={w.address}>
                              {w.label || short(w.address)} · {sol(balOf(w.address))} SOL
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-300" />
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-text-300">Each source sells its balance, the SOL goes to its wash wallets, they buy back. Several wash wallets split evenly; a wallet short on SOL fails its pair while the rest run.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-text-100">3. Delay between pairs</h3>
        <p className="text-[11px] text-text-300">Random, in seconds. 0 = no delay.</p>
        <div className="grid grid-cols-2 gap-3 sm:w-1/2">
          <F label="Min">
            <DecimalInput value={task.washMinDelaySec} onChange={(v) => set("washMinDelaySec", v)} className={num} />
          </F>
          <F label="Max">
            <DecimalInput value={task.washMaxDelaySec} onChange={(v) => set("washMaxDelaySec", v)} className={num} />
          </F>
        </div>
      </section>
    </>
  );
}

export const TASK_TYPES: LaunchTaskType[] = ["bundle", "sniper", "volume", "buy", "wash"];
export { newId as newTaskId };
