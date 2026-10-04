"use client";
import { useState } from "react";
import type { LaunchTaskType, WalletGroup, WalletInfo } from "@/lib/ui-types";
import { TASK_LIMITS } from "@/lib/ui-types";
import { short, sol } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { Button, Field, Input, Segmented, Toggle, cx } from "../ui";
import { TASK_META, validateTask, type FormTask } from "./model";

type Props = {
  task: FormTask;
  wallets: WalletInfo[];
  groups: WalletGroup[];
  balances: Record<string, string | null> | null;
  onChange: (t: FormTask) => void;
  onRemove: () => void;
};

export function TaskCard({ task, wallets, groups, balances, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(true);
  const meta = TASK_META[task.type];
  const problems = validateTask(task);
  const set = <K extends keyof FormTask>(k: K, v: FormTask[K]) => onChange({ ...task, [k]: v });
  const isBundle = task.type === "bundle" || task.type === "sniper";
  const isTrade = task.type === "buy" || task.type === "volume";
  const groupWallets = wallets.filter((w) => task.walletGroupIds.includes(w.group ?? ""));
  const allAddrs = Array.from(new Set([...task.walletIds, ...groupWallets.map((w) => w.address)]));
  const totalSol = isBundle ? allAddrs.reduce((n, a) => n + Number(task.walletBuyAmounts[a] ?? task.buyAmount ?? 0), 0) : null;

  return (
    <div className="card overflow-hidden" style={{ borderColor: problems.length ? "var(--down)" : undefined }}>
      <div className="flex items-center gap-2.5 px-3 h-11 cursor-pointer select-none" onClick={() => setOpen((o) => !o)}>
        <Icon3D name={meta.icon} size={22} />
        <span className="text-xs font-semibold">{meta.label}</span>
        <span className="mono text-[11px] text-text-3">
          {allAddrs.length} wallet{allAddrs.length !== 1 ? "s" : ""}
          {totalSol !== null && allAddrs.length ? ` · ${sol(totalSol)} SOL` : ""}
          {isTrade ? ` · ${task.minTradeAmount}–${task.maxTradeAmount} SOL · ${task.tradeMode}` : ""}
        </span>
        {problems.length ? <span className="text-[10px] text-down ml-1">{problems.length} issue{problems.length > 1 ? "s" : ""}</span> : null}
        <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Toggle checked={task.autoStart} onChange={(v) => set("autoStart", v)} label="Auto start" color={task.type === "volume" || task.type === "buy" ? "auto" : "accent"} />
          <Button size="xs" variant="ghost" onClick={onRemove} title="Remove task" className="text-text-3">
            ×
          </Button>
        </span>
      </div>
      {open ? (
        <div className="px-3 pb-3 flex flex-col gap-3 border-t border-line pt-3">
          <p className="text-[11px] text-text-3 -mt-1">{meta.blurb}</p>
          <WalletPicker task={task} wallets={wallets} groups={groups} balances={balances} onChange={onChange} />

          {isBundle ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="SOL per wallet">
                <Input type="number" step="0.01" min={0} value={task.buyAmount} onChange={(e) => set("buyAmount", e.target.value)} mono suffix="SOL" />
              </Field>
              <Field label="Slippage">
                <Input type="number" min={0} max={TASK_LIMITS.maxSlippagePercent} value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value))} mono suffix="%" />
              </Field>
              <Field label={task.type === "bundle" ? "Jito tip" : "Priority tip"}>
                <Input type="number" step="0.0001" min={0} value={task.tip} onChange={(e) => set("tip", e.target.value)} mono suffix="SOL" />
              </Field>
              <Field label="Retries">
                <Input type="number" min={0} max={TASK_LIMITS.maxAutoRetryCount} value={task.autoRetryCount} onChange={(e) => set("autoRetryCount", Number(e.target.value))} mono />
              </Field>
            </div>
          ) : null}

          {isTrade ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Min amount">
                  <Input type="number" step="0.01" min={0} value={task.minTradeAmount} onChange={(e) => set("minTradeAmount", e.target.value)} mono suffix="SOL" />
                </Field>
                <Field label="Max amount">
                  <Input type="number" step="0.01" min={0} value={task.maxTradeAmount} onChange={(e) => set("maxTradeAmount", e.target.value)} mono suffix="SOL" />
                </Field>
                <Field label="Min interval">
                  <Input type="number" min={0} value={task.minIntervalSec} onChange={(e) => set("minIntervalSec", Number(e.target.value))} mono suffix="s" />
                </Field>
                <Field label="Max interval">
                  <Input type="number" min={0} value={task.maxIntervalSec} onChange={(e) => set("maxIntervalSec", Number(e.target.value))} mono suffix="s" />
                </Field>
                <Field label="Slippage">
                  <Input type="number" min={0} max={TASK_LIMITS.maxSlippagePercent} value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value))} mono suffix="%" />
                </Field>
                <Field label="Tip">
                  <Input type="number" step="0.0001" min={0} value={task.tip} onChange={(e) => set("tip", e.target.value)} mono suffix="SOL" />
                </Field>
                <Field label="Trades per wallet">
                  <Input type="number" min={1} max={TASK_LIMITS.maxTradesPerWallet} value={task.maxTradesPerWallet} onChange={(e) => set("maxTradesPerWallet", Number(e.target.value))} mono />
                </Field>
                <Field label="Max duration">
                  <Input type="number" min={1} max={TASK_LIMITS.maxDurationMinutes} value={task.maxDurationMinutes} onChange={(e) => set("maxDurationMinutes", Number(e.target.value))} mono suffix="min" />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Field label="Mode">
                  <Segmented value={task.tradeMode} onChange={(v) => set("tradeMode", v)} options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }, { value: "both", label: "Both" }]} />
                </Field>
                {task.tradeMode === "both" ? (
                  <Field label={`Buy ratio ${task.buyRatioPercent} %`} className="flex-1 min-w-[160px]">
                    <input type="range" min={0} max={100} value={task.buyRatioPercent} onChange={(e) => set("buyRatioPercent", Number(e.target.value))} className="w-full accent-auto" />
                  </Field>
                ) : null}
              </div>
            </>
          ) : null}

          {problems.length ? (
            <ul className="text-[11px] text-down flex flex-col gap-0.5">
              {problems.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WalletPicker({ task, wallets, groups, balances, onChange }: Omit<Props, "onRemove">) {
  const [q, setQ] = useState("");
  const isBundle = task.type === "bundle" || task.type === "sniper";
  const list = wallets.filter((w) => !w.archived && (!q || (w.label + w.address).toLowerCase().includes(q.toLowerCase())));
  const toggle = (a: string) => onChange({ ...task, walletIds: task.walletIds.includes(a) ? task.walletIds.filter((x) => x !== a) : [...task.walletIds, a] });
  const toggleGroup = (g: string) => onChange({ ...task, walletGroupIds: task.walletGroupIds.includes(g) ? task.walletGroupIds.filter((x) => x !== g) : [...task.walletGroupIds, g] });
  const cap = task.type === "bundle" ? TASK_LIMITS.maxWalletsPerBundleTask : TASK_LIMITS.maxWalletsPerTask;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label">Wallets</span>
        <span className="mono text-[11px] text-text-3">
          {task.walletIds.length}/{cap}
        </span>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => toggleGroup(g.id)}
            className={cx("h-6 px-2 rounded-md border text-[11px]", task.walletGroupIds.includes(g.id) ? "border-accent bg-accent-soft text-accent" : "border-line text-text-2 hover:border-line-hover")}
          >
            {g.name} <span className="text-text-3 mono">{wallets.filter((w) => w.group === g.id && !w.archived).length}</span>
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="input h-6 text-[11px] w-28 ml-auto" />
      </div>
      <div className="max-h-40 overflow-y-auto rounded-lg border border-line bg-bg p-1 flex flex-col gap-0.5">
        {!list.length ? <div className="text-[11px] text-text-3 p-2">No wallet — create some in Portfolio.</div> : null}
        {list.map((w) => {
          const on = task.walletIds.includes(w.address);
          const viaGroup = task.walletGroupIds.includes(w.group ?? "");
          return (
            <label key={w.address} className={cx("flex items-center gap-2 h-8 px-2 rounded-md text-xs cursor-pointer", on || viaGroup ? "bg-accent-soft" : "hover:bg-white/5")}>
              <input type="checkbox" checked={on} disabled={viaGroup} onChange={() => toggle(w.address)} className="accent-accent" />
              <span className="truncate flex-1">{w.label || short(w.address)}</span>
              <span className="mono text-text-3">{sol(balances?.[w.address] ?? w.sol)}</span>
              {isBundle && (on || viaGroup) ? (
                <input
                  type="number"
                  step="0.01"
                  placeholder={task.buyAmount}
                  value={task.walletBuyAmounts[w.address] ?? ""}
                  onChange={(e) => {
                    const next = { ...task.walletBuyAmounts };
                    if (e.target.value) next[w.address] = e.target.value;
                    else delete next[w.address];
                    onChange({ ...task, walletBuyAmounts: next });
                  }}
                  onClick={(e) => e.preventDefault()}
                  className="input h-6 w-20 text-[11px] mono"
                  title="SOL for this wallet (blank = default)"
                />
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function AddTaskMenu({ onAdd, count }: { onAdd: (t: LaunchTaskType) => void; count: Record<LaunchTaskType, number> }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {(Object.keys(TASK_META) as LaunchTaskType[]).map((t) => (
        <button key={t} type="button" onClick={() => onAdd(t)} className="card flex flex-col items-center gap-1 py-2.5 hover:bg-card-2" title={TASK_META[t].blurb}>
          <Icon3D name={TASK_META[t].icon} size={28} />
          <span className="text-[11px] font-medium">{TASK_META[t].label}</span>
          {count[t] ? <span className="mono text-[10px] text-accent">{count[t]}</span> : null}
        </button>
      ))}
    </div>
  );
}
