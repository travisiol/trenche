"use client";
import { useState } from "react";
import type { LaunchTaskType, WalletGroup, WalletInfo } from "@/lib/types";
import { TASK_LIMITS } from "@/lib/types";
import { short, sol } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { Icon } from "../icons";
import { Field, Input, Segmented, Toggle, cx } from "../ui";
import { TASK_META, taskSentence, taskWallets, validateTask, type FormTask } from "./model";

type Props = {
  task: FormTask;
  wallets: WalletInfo[];
  groups: WalletGroup[];
  balances: Record<string, string | null> | null;
  onChange: (t: FormTask) => void;
  onRemove: () => void;
};

/** Expandable task card: icon, name, one plain-language sentence, then the editor. */
export function TaskCard({ task, wallets, groups, balances, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(true);
  const meta = TASK_META[task.type];
  const problems = validateTask(task);
  const set = <K extends keyof FormTask>(k: K, v: FormTask[K]) => onChange({ ...task, [k]: v });
  const isBundle = task.type === "bundle" || task.type === "sniper";
  const isTrade = task.type === "buy" || task.type === "volume";
  const sentence = taskSentence(task, wallets);

  return (
    <div className={cx("card overflow-hidden", problems.length ? "!border-down/50" : "")}>
      <div className="flex items-start gap-3 px-4 py-3 cursor-pointer select-none" onClick={() => setOpen((o) => !o)}>
        <Icon3D name={meta.icon} size={28} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{meta.label}</span>
            {problems.length ? (
              <span className="text-[13px] text-down">
                {problems.length} thing{problems.length > 1 ? "s" : ""} to fix
              </span>
            ) : null}
          </div>
          <p className={cx("text-sm", problems.length ? "text-text-3" : "text-text-2")}>{sentence}</p>
        </div>
        <span className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Toggle checked={task.autoStart} onChange={(v) => set("autoStart", v)} label={<span className="hidden sm:inline">Auto start</span>} color={task.type === "volume" || task.type === "buy" ? "auto" : "accent"} />
          <button type="button" onClick={onRemove} title="Remove this task" aria-label="Remove task" className="w-8 h-8 rounded-md text-text-3 hover:text-down hover:bg-white/5 flex items-center justify-center">
            <Icon name="trash" size={15} />
          </button>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"} className="w-8 h-8 rounded-md text-text-3 hover:text-text hover:bg-white/5 flex items-center justify-center">
            <Icon name="chevronDown" size={16} className={cx("transition-transform", open ? "rotate-180" : "")} />
          </button>
        </span>
      </div>
      {open ? (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t border-line pt-4">
          <p className="hint">{meta.blurb}</p>
          <WalletPicker task={task} wallets={wallets} groups={groups} balances={balances} onChange={onChange} />

          {isBundle ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="SOL per wallet" hint="Default; override per wallet above.">
                <Input type="number" step="0.01" min={0} value={task.buyAmount} onChange={(e) => set("buyAmount", e.target.value)} mono suffix="SOL" />
              </Field>
              <Field label="Slippage">
                <Input type="number" min={0} max={TASK_LIMITS.maxSlippagePercent} value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value))} mono suffix="%" />
              </Field>
              <Field label={task.type === "bundle" ? "Jito tip" : "Priority tip"} hint={task.type === "bundle" ? "Paid once for the whole bundle." : "Per transaction."}>
                <Input type="number" step="0.0001" min={0} value={task.tip} onChange={(e) => set("tip", e.target.value)} mono suffix="SOL" />
              </Field>
              <Field label="Retries" hint={`0 to ${TASK_LIMITS.maxAutoRetryCount}.`}>
                <Input type="number" min={0} max={TASK_LIMITS.maxAutoRetryCount} value={task.autoRetryCount} onChange={(e) => set("autoRetryCount", Number(e.target.value))} mono suffix="tries" />
              </Field>
            </div>
          ) : null}

          {isTrade ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Min per trade">
                  <Input type="number" step="0.01" min={0} value={task.minTradeAmount} onChange={(e) => set("minTradeAmount", e.target.value)} mono suffix="SOL" />
                </Field>
                <Field label="Max per trade">
                  <Input type="number" step="0.01" min={0} value={task.maxTradeAmount} onChange={(e) => set("maxTradeAmount", e.target.value)} mono suffix="SOL" />
                </Field>
                <Field label="Min pause between trades">
                  <Input type="number" min={0} value={task.minIntervalSec} onChange={(e) => set("minIntervalSec", Number(e.target.value))} mono suffix="s" />
                </Field>
                <Field label="Max pause between trades">
                  <Input type="number" min={0} value={task.maxIntervalSec} onChange={(e) => set("maxIntervalSec", Number(e.target.value))} mono suffix="s" />
                </Field>
                <Field label="Slippage">
                  <Input type="number" min={0} max={TASK_LIMITS.maxSlippagePercent} value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value))} mono suffix="%" />
                </Field>
                <Field label="Priority tip">
                  <Input type="number" step="0.0001" min={0} value={task.tip} onChange={(e) => set("tip", e.target.value)} mono suffix="SOL" />
                </Field>
                <Field label="Trades per wallet">
                  <Input type="number" min={1} max={TASK_LIMITS.maxTradesPerWallet} value={task.maxTradesPerWallet} onChange={(e) => set("maxTradesPerWallet", Number(e.target.value))} mono suffix="trades" />
                </Field>
                <Field label="Stop after">
                  <Input type="number" min={1} max={TASK_LIMITS.maxDurationMinutes} value={task.maxDurationMinutes} onChange={(e) => set("maxDurationMinutes", Number(e.target.value))} mono suffix="min" />
                </Field>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <Field label="Direction">
                  <Segmented value={task.tradeMode} onChange={(v) => set("tradeMode", v)} options={[{ value: "buy", label: "Buy only" }, { value: "sell", label: "Sell only" }, { value: "both", label: "Buy and sell" }]} />
                </Field>
                {task.tradeMode === "both" ? (
                  <Field label={`Share of buys: ${task.buyRatioPercent} %`} className="flex-1 min-w-[200px]">
                    <input type="range" min={0} max={100} value={task.buyRatioPercent} onChange={(e) => set("buyRatioPercent", Number(e.target.value))} className="w-full accent-auto h-10" aria-label="Share of buys" />
                  </Field>
                ) : null}
              </div>
            </>
          ) : null}

          {problems.length ? (
            <ul className="text-sm text-down flex flex-col gap-1">
              {problems.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <Icon name="warning" size={14} /> {p}
                </li>
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
  const picked = taskWallets(task, wallets).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label">Wallets</span>
        <span className={cx("mono text-[13px]", picked > cap ? "text-down" : "text-text-3")}>
          {picked} of {cap} max
        </span>
        <span className="hidden sm:inline hint">· tick wallets or pick a whole group</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter wallets…" className="input h-8 text-[13px] w-40 ml-auto" aria-label="Filter wallets" />
      </div>
      {groups.length ? (
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => {
            const on = task.walletGroupIds.includes(g.id);
            const n = wallets.filter((w) => w.group === g.id && !w.archived).length;
            return (
              <button key={g.id} type="button" onClick={() => toggleGroup(g.id)} className={cx("inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px]", on ? "border-accent bg-accent-soft text-accent" : "border-line text-text-2 hover:border-line-hover")}>
                <Icon name={on ? "check" : "tag"} size={13} />
                {g.name} <span className="text-text-3 mono">{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="max-h-52 overflow-y-auto rounded-lg border border-line bg-bg p-1.5 flex flex-col gap-0.5">
        {!list.length ? <div className="hint p-2">No wallet — create some in Portfolio.</div> : null}
        {list.map((w) => {
          const on = task.walletIds.includes(w.address);
          const viaGroup = task.walletGroupIds.includes(w.group ?? "");
          return (
            <label key={w.address} className={cx("flex items-center gap-2.5 h-9 px-2 rounded-md text-sm cursor-pointer", on || viaGroup ? "bg-accent-soft" : "hover:bg-white/5")}>
              <input type="checkbox" checked={on || viaGroup} disabled={viaGroup} onChange={() => toggle(w.address)} className="accent-accent w-4 h-4" />
              <span className="truncate flex-1">{w.label || short(w.address)}</span>
              {viaGroup ? <span className="hint">via group</span> : null}
              <span className="mono text-text-3 text-[13px]">{sol(balances?.[w.address] ?? w.sol)} SOL</span>
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
                  className="input h-8 w-24 text-[13px] mono"
                  title="SOL for this wallet (blank = default)"
                  aria-label={`SOL for ${w.label || short(w.address)}`}
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
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {(Object.keys(TASK_META) as LaunchTaskType[]).map((t) => (
        <button key={t} type="button" onClick={() => onAdd(t)} className="card flex flex-col items-center gap-1.5 px-2 py-3 hover:bg-card-2 text-center" title={TASK_META[t].blurb}>
          <Icon3D name={TASK_META[t].icon} size={32} />
          <span className="text-sm font-medium">
            + {TASK_META[t].label}
            {count[t] ? <span className="mono text-[13px] text-accent ml-1">×{count[t]}</span> : null}
          </span>
          <span className="hint leading-snug">{TASK_META[t].short}</span>
        </button>
      ))}
    </div>
  );
}
