"use client";
/** Task cards of the Block X Tasks panel (bundle / sniper / buy / volume / wash) — draft editors. */
import { useState } from "react";
import { ChevronDown, Info, Trash2 } from "lucide-react";
import type { LaunchTaskType, WalletGroup, WalletInfo } from "@/lib/types";
import { TASK_LIMITS } from "@/lib/types";
import { BxInput, BxSwitch, cx } from "../bx/ui";
import { WalletPicker } from "../bx/WalletPicker";
import { TASK_META, taskSentence, taskWallets, validateTask, type FormTask } from "./model";

type Props = {
  task: FormTask;
  wallets: WalletInfo[];
  groups: WalletGroup[];
  balances: Record<string, string | null> | null;
  onChange: (t: FormTask) => void;
  onRemove: () => void;
};

function F({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-text-300" title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}
const num = "h-7 px-2 font-mono text-xs";

export function TaskCard({ task, wallets, groups, balances, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(true);
  const meta = TASK_META[task.type];
  const problems = validateTask(task);
  const set = <K extends keyof FormTask>(k: K, v: FormTask[K]) => onChange({ ...task, [k]: v });
  const isBundle = task.type === "bundle" || task.type === "sniper";
  const isTrade = task.type === "buy" || task.type === "volume";
  const picked = taskWallets(task, wallets);
  const cap = task.type === "bundle" ? TASK_LIMITS.maxWalletsPerBundleTask : TASK_LIMITS.maxWalletsPerTask;

  return (
    <div className={cx("task-card flex flex-col", problems.length ? "border-decrease/40" : "")}>
      <div className="flex h-10 items-center gap-2 px-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" aria-label={open ? "Collapse" : "Expand"}>
          <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", open ? "" : "-rotate-90")} />
        </button>
        <span className="text-sm font-medium text-text-100">{meta.label}</span>
        <span className="text-text-300" title={meta.blurb}>
          <Info className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-text-300">{taskSentence(task, wallets)}</span>
        {problems.length ? <span className="shrink-0 text-[11px] text-decrease">{problems[0]}</span> : null}
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-300">
          Auto start
          <BxSwitch checked={task.autoStart} onChange={(v) => set("autoStart", v)} />
        </label>
        <button type="button" onClick={onRemove} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-decrease" aria-label="Remove task">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-line-50 px-3 pb-3 pt-2">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-300">
              Wallets
              <span className={cx("font-mono normal-case", picked.length > cap ? "text-decrease" : "")}>
                {picked.length}/{cap}
              </span>
              {task.walletGroupIds.length ? <span className="normal-case">· via group{task.walletGroupIds.length > 1 ? "s" : ""}</span> : null}
            </div>
            <WalletPicker
              wallets={wallets}
              groups={groups}
              value={picked}
              onChange={(v) => onChange({ ...task, walletIds: v, walletGroupIds: [] })}
              balances={balances}
              max={cap}
            />
          </div>
          {isBundle ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <F label="SOL per wallet" hint="Per-wallet amount; override below per wallet if needed">
                <BxInput type="number" step="0.01" min={0} value={task.buyAmount} onChange={(e) => set("buyAmount", e.target.value)} className={num} />
              </F>
              <F label="Slippage %">
                <BxInput type="number" min={0} max={TASK_LIMITS.maxSlippagePercent} value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value))} className={num} />
              </F>
              <F label={task.type === "bundle" ? "Jito tip (SOL)" : "Tip (SOL)"}>
                <BxInput type="number" step="0.0001" min={0} value={task.tip} onChange={(e) => set("tip", e.target.value)} className={num} />
              </F>
              <F label="Retries">
                <BxInput type="number" min={0} max={TASK_LIMITS.maxAutoRetryCount} value={task.autoRetryCount} onChange={(e) => set("autoRetryCount", Number(e.target.value))} className={num} />
              </F>
              {picked.length ? (
                <div className="col-span-full flex flex-wrap gap-1.5">
                  {picked.map((a) => {
                    const w = wallets.find((x) => x.address === a);
                    return (
                      <label key={a} className="flex items-center gap-1 rounded border border-line-100 bg-bg-50 px-1.5 py-0.5 text-[11px] text-text-200">
                        {w?.label || a.slice(0, 4)}
                        <input
                          type="number"
                          step="0.01"
                          placeholder={task.buyAmount}
                          value={task.walletBuyAmounts[a] ?? ""}
                          onChange={(e) => {
                            const next = { ...task.walletBuyAmounts };
                            if (e.target.value) next[a] = e.target.value;
                            else delete next[a];
                            onChange({ ...task, walletBuyAmounts: next });
                          }}
                          className="h-5 w-16 rounded border border-line-100 bg-input-100 px-1 font-mono text-[11px] text-text-100 outline-none focus:border-accent"
                          title="SOL for this wallet (blank = default)"
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          {isTrade ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <F label="Min amount (SOL)">
                  <BxInput type="number" step="0.01" min={0} value={task.minTradeAmount} onChange={(e) => set("minTradeAmount", e.target.value)} className={num} />
                </F>
                <F label="Max amount (SOL)">
                  <BxInput type="number" step="0.01" min={0} value={task.maxTradeAmount} onChange={(e) => set("maxTradeAmount", e.target.value)} className={num} />
                </F>
                <F label="Min interval (s)">
                  <BxInput type="number" min={0} value={task.minIntervalSec} onChange={(e) => set("minIntervalSec", Number(e.target.value))} className={num} />
                </F>
                <F label="Max interval (s)">
                  <BxInput type="number" min={0} value={task.maxIntervalSec} onChange={(e) => set("maxIntervalSec", Number(e.target.value))} className={num} />
                </F>
                <F label="Slippage %">
                  <BxInput type="number" min={0} max={TASK_LIMITS.maxSlippagePercent} value={task.slippagePercent} onChange={(e) => set("slippagePercent", Number(e.target.value))} className={num} />
                </F>
                <F label="Tip (SOL)">
                  <BxInput type="number" step="0.0001" min={0} value={task.tip} onChange={(e) => set("tip", e.target.value)} className={num} />
                </F>
                <F label="Trades / wallet">
                  <BxInput type="number" min={1} max={TASK_LIMITS.maxTradesPerWallet} value={task.maxTradesPerWallet} onChange={(e) => set("maxTradesPerWallet", Number(e.target.value))} className={num} />
                </F>
                <F label="Duration (min)">
                  <BxInput type="number" min={1} max={TASK_LIMITS.maxDurationMinutes} value={task.maxDurationMinutes} onChange={(e) => set("maxDurationMinutes", Number(e.target.value))} className={num} />
                </F>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <F label="Mode">
                  <div className="flex h-7 items-center gap-0.5 rounded bg-input-100 p-0.5">
                    {(["buy", "sell", "both"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => set("tradeMode", m)} className={cx("h-full rounded px-2 text-[11px] font-medium capitalize transition-colors", task.tradeMode === m ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                        {m}
                      </button>
                    ))}
                  </div>
                </F>
                {task.tradeMode === "both" ? (
                  <F label={`Buy ratio ${task.buyRatioPercent}%`}>
                    <input type="range" min={0} max={100} value={task.buyRatioPercent} onChange={(e) => set("buyRatioPercent", Number(e.target.value))} className="consolidate-slider w-40" />
                  </F>
                ) : null}
              </div>
            </>
          ) : null}
          {problems.length > 1 ? (
            <ul className="text-[11px] text-decrease">
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

export const TASK_TYPES = Object.keys(TASK_META) as LaunchTaskType[];
