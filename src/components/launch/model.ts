/**
 * Launch form model — Block X task model reproduced 1:1 (see BRIEF "Tâches de launch").
 * Saved as a draft in localStorage and as presets through /api/presets.
 */
import { TASK_DEFAULTS, TASK_LIMITS, type LaunchTask, type LaunchTaskType, type TradeMode } from "@/lib/types";

export type FormTask = {
  id: string;
  type: LaunchTaskType;
  walletIds: string[];
  walletGroupIds: string[];
  /** bundle/sniper: SOL per wallet (default applies when empty) */
  buyAmount: string;
  walletBuyAmounts: Record<string, string>;
  slippagePercent: number;
  tip: string;
  autoRetryCount: number;
  autoStart: boolean;
  /** buy/volume */
  minIntervalSec: number;
  maxIntervalSec: number;
  minTradeAmount: string;
  maxTradeAmount: string;
  tradeMode: TradeMode;
  buyRatioPercent: number;
  maxTradesPerWallet: number;
  maxDurationMinutes: number;
};

export type LaunchForm = {
  name: string;
  symbol: string;
  description: string;
  twitter: string;
  telegram: string;
  website: string;
  /** square PNG data URL, cropped client-side */
  imageDataUrl: string;
  vanity: string;
  devWallet: string;
  devBuySol: string;
  slippageBps: number;
  cashback: boolean;
  tasks: FormTask[];
  sellOnExternalEnabled: boolean;
  sellOnExternalThreshold: string;
  autoDumpEnabled: boolean;
  autoDumpPercent: number;
  autoDumpMcUsd: string;
  autoDumpAfterSec: string;
};

let seq = 0;
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newTask(type: LaunchTaskType): FormTask {
  const d = TASK_DEFAULTS[type] as Partial<FormTask>;
  return {
    id: newId(),
    type,
    walletIds: [],
    walletGroupIds: [],
    buyAmount: "0.1",
    walletBuyAmounts: {},
    slippagePercent: d.slippagePercent ?? 20,
    tip: d.tip ?? "0.001",
    autoRetryCount: d.autoRetryCount ?? 0,
    autoStart: d.autoStart ?? true,
    minIntervalSec: d.minIntervalSec ?? 0,
    maxIntervalSec: d.maxIntervalSec ?? 1,
    minTradeAmount: d.minTradeAmount ?? "0.1",
    maxTradeAmount: d.maxTradeAmount ?? "0.2",
    tradeMode: d.tradeMode ?? (type === "volume" ? "both" : "buy"),
    buyRatioPercent: d.buyRatioPercent ?? 50,
    maxTradesPerWallet: 100,
    maxDurationMinutes: 60,
  };
}

export const EMPTY_FORM: LaunchForm = {
  name: "",
  symbol: "",
  description: "",
  twitter: "",
  telegram: "",
  website: "",
  imageDataUrl: "",
  vanity: "",
  devWallet: "",
  devBuySol: "0.5",
  slippageBps: 3000,
  cashback: false,
  tasks: [],
  sellOnExternalEnabled: false,
  sellOnExternalThreshold: "5",
  autoDumpEnabled: false,
  autoDumpPercent: 100,
  autoDumpMcUsd: "",
  autoDumpAfterSec: "",
};

export const TASK_META: Record<LaunchTaskType, { label: string; short: string; blurb: string; icon: "bundle" | "sniper" | "buy" | "volume" | "wash"; color: string }> = {
  bundle: { label: "Bundle", short: "Buy in the create bundle", blurb: "These wallets buy inside the same Jito bundle as the create, so nobody can trade before them. Jito accepts the create plus 4 buys.", icon: "bundle", color: "var(--accent)" },
  sniper: { label: "Sniper", short: "Buy right after create", blurb: "These wallets send their buy the instant the create confirms, with optional retries. No wallet limit beyond 50.", icon: "sniper", color: "var(--warn)" },
  buy: { label: "Buy", short: "Keep buying over time", blurb: "These wallets keep buying at random amounts and pauses after the launch. Pausable from the dashboard.", icon: "buy", color: "var(--up)" },
  volume: { label: "Volume", short: "Buy and sell to print volume", blurb: "These wallets buy and sell at random amounts and pauses to print volume. Pausable from the dashboard.", icon: "volume", color: "var(--auto)" },
  wash: { label: "Wash", short: "Move tokens to fresh wallets", blurb: "After the launch, every token these wallets hold is transferred to brand-new wallets added to your vault.", icon: "wash", color: "var(--text-2)" },
};

/** Validation mirrors TASK_LIMITS; returns one message per problem (empty = ok). */
export function validateTask(t: FormTask): string[] {
  const out: string[] = [];
  const wallets = t.walletIds.length + (t.walletGroupIds.length ? 1 : 0);
  if (!wallets) out.push("Pick at least one wallet or group.");
  if (t.walletIds.length > TASK_LIMITS.maxWalletsPerTask) out.push(`Max ${TASK_LIMITS.maxWalletsPerTask} wallets per task.`);
  if (t.type === "bundle" && t.walletIds.length > TASK_LIMITS.maxWalletsPerBundleTask) out.push(`A Jito bundle holds the create plus ${TASK_LIMITS.maxWalletsPerBundleTask} buys.`);
  if (t.slippagePercent < 0 || t.slippagePercent > TASK_LIMITS.maxSlippagePercent) out.push(`Slippage must be 0–${TASK_LIMITS.maxSlippagePercent} %.`);
  if (t.type === "bundle" || t.type === "sniper") {
    if (!(Number(t.buyAmount) > 0)) out.push("Buy amount must be above 0.");
    if (t.autoRetryCount > TASK_LIMITS.maxAutoRetryCount) out.push(`Max ${TASK_LIMITS.maxAutoRetryCount} retries.`);
  }
  if (t.type === "buy" || t.type === "volume") {
    if (t.minIntervalSec > t.maxIntervalSec) out.push("Min interval is above max interval.");
    if (t.maxIntervalSec > TASK_LIMITS.maxIntervalSec) out.push("Interval too long.");
    if (Number(t.minTradeAmount) > Number(t.maxTradeAmount)) out.push("Min amount is above max amount.");
    if (!(Number(t.minTradeAmount) > 0)) out.push("Trade amount must be above 0.");
    if (t.maxTradesPerWallet < 1 || t.maxTradesPerWallet > TASK_LIMITS.maxTradesPerWallet) out.push(`Trades per wallet: 1–${TASK_LIMITS.maxTradesPerWallet}.`);
    if (t.maxDurationMinutes < 1 || t.maxDurationMinutes > TASK_LIMITS.maxDurationMinutes) out.push(`Duration: 1–${TASK_LIMITS.maxDurationMinutes} min.`);
  }
  return out;
}

export function validateForm(f: LaunchForm): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push("Token name is required.");
  if (!f.symbol.trim()) out.push("Symbol is required.");
  if (f.symbol.length > 10) out.push("Symbol: 10 characters max.");
  if (!f.imageDataUrl) out.push("Add an image.");
  if (!f.devWallet) out.push("Pick the dev wallet.");
  if (!(Number(f.devBuySol) >= 0)) out.push("Dev buy must be a number.");
  for (const t of f.tasks) for (const m of validateTask(t)) out.push(`${TASK_META[t.type].label}: ${m}`);
  if (f.sellOnExternalEnabled && !(Number(f.sellOnExternalThreshold) > 0)) out.push("External-volume threshold must be above 0.");
  if (f.autoDumpEnabled && !(Number(f.autoDumpMcUsd) > 0) && !(Number(f.autoDumpAfterSec) > 0)) out.push("Auto-dump needs a market cap or a delay.");
  return out;
}

/** Form task → API task (only the fields the type uses). */
export function toApiTask(t: FormTask): LaunchTask {
  const base = {
    id: t.id,
    walletIds: t.walletIds,
    walletGroupIds: t.walletGroupIds.length ? t.walletGroupIds : undefined,
  };
  if (t.type === "bundle" || t.type === "sniper") {
    return {
      ...base,
      type: t.type,
      buyAmount: t.buyAmount,
      walletBuyAmounts: Object.keys(t.walletBuyAmounts).length ? t.walletBuyAmounts : undefined,
      slippagePercent: t.slippagePercent,
      tip: t.tip,
      autoRetryCount: t.autoRetryCount,
      autoStart: t.autoStart,
    };
  }
  if (t.type === "wash") return { ...base, type: "wash", autoStart: t.autoStart };
  return {
    ...base,
    type: t.type,
    minIntervalSec: t.minIntervalSec,
    maxIntervalSec: t.maxIntervalSec,
    minTradeAmount: t.minTradeAmount,
    maxTradeAmount: t.maxTradeAmount,
    slippagePercent: t.slippagePercent,
    tip: t.tip,
    tradeMode: t.tradeMode,
    buyRatioPercent: t.buyRatioPercent,
    maxTradesPerWallet: t.maxTradesPerWallet,
    maxDurationMinutes: t.maxDurationMinutes,
    autoStart: t.autoStart,
  };
}

const DRAFT_KEY = "trench.launch.draft";
export function loadDraft(): LaunchForm | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<LaunchForm>;
    return { ...EMPTY_FORM, ...d, tasks: (d.tasks ?? []).map((t) => ({ ...newTask(t.type), ...t })) };
  } catch {
    return null;
  }
}
export function saveDraft(f: LaunchForm) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
  } catch {
    /* quota / private mode */
  }
}
export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Presets never carry the image (too large) — keep everything else. */
export function presetData(f: LaunchForm): Record<string, unknown> {
  const { imageDataUrl: _img, ...rest } = f;
  void _img;
  return rest;
}
export function fromPreset(data: Record<string, unknown>, current: LaunchForm): LaunchForm {
  const d = data as Partial<LaunchForm>;
  return { ...EMPTY_FORM, ...d, imageDataUrl: current.imageDataUrl, tasks: (d.tasks ?? []).map((t) => ({ ...newTask(t.type), ...t, id: newId() })) };
}

/* ------------------------------------------------------------- readability helpers (ui2) */

/** Wallet addresses a task touches (explicit + expanded groups), de-duplicated. */
export function taskWallets(t: FormTask, wallets: { address: string; group: string | null; archived: boolean }[]): string[] {
  const viaGroup = wallets.filter((w) => !w.archived && t.walletGroupIds.includes(w.group ?? "")).map((w) => w.address);
  return Array.from(new Set([...t.walletIds, ...viaGroup]));
}

/** SOL a bundle/sniper wallet buys with (per-wallet override or task default). */
export function taskBuyFor(t: FormTask, address: string): number {
  return Number(t.walletBuyAmounts[address] ?? t.buyAmount ?? 0) || 0;
}

/** One plain-language sentence describing what the task will do. */
export function taskSentence(t: FormTask, wallets: { address: string; group: string | null; archived: boolean }[]): string {
  const addrs = taskWallets(t, wallets);
  const n = addrs.length;
  const w = `${n} wallet${n !== 1 ? "s" : ""}`;
  if (!n) return "No wallet picked yet.";
  if (t.type === "bundle") {
    const total = addrs.reduce((s, a) => s + taskBuyFor(t, a), 0);
    const same = addrs.every((a) => taskBuyFor(t, a) === taskBuyFor(t, addrs[0]));
    return `${w} buy ${same ? `${t.buyAmount} SOL each` : `${total} SOL in total`} inside the create transaction via Jito, tip ${t.tip} SOL, slippage ${t.slippagePercent} %.`;
  }
  if (t.type === "sniper") {
    const same = addrs.every((a) => taskBuyFor(t, a) === taskBuyFor(t, addrs[0]));
    const total = addrs.reduce((s, a) => s + taskBuyFor(t, a), 0);
    return `${w} buy ${same ? `${t.buyAmount} SOL each` : `${total} SOL in total`} the moment the create confirms${t.autoRetryCount ? `, up to ${t.autoRetryCount} retr${t.autoRetryCount > 1 ? "ies" : "y"}` : ""}, slippage ${t.slippagePercent} %.`;
  }
  if (t.type === "wash") return `Every token held by ${w} is moved to fresh wallets after the launch.`;
  const verb = t.tradeMode === "both" ? `buy and sell (${t.buyRatioPercent} % buys)` : t.tradeMode === "sell" ? "sell" : "buy";
  return `${w} ${verb} ${t.minTradeAmount}–${t.maxTradeAmount} SOL every ${t.minIntervalSec}–${t.maxIntervalSec} s, up to ${t.maxTradesPerWallet} trades each, for ${t.maxDurationMinutes} min at most.`;
}

/** Rough on-chain costs (SOL) so the summary can compare needed vs available. The server re-checks before sending. */
export const COST = { create: 0.02, perBuy: 0.01 } as const;

export type NeedRow = { address: string; label: string; role: string; needed: number; available: number };

/** Per-wallet SOL needed for this launch (dev create + dev buy + task buys), with balances for comparison. */
export function launchNeeds(f: LaunchForm, wallets: { address: string; label: string; group: string | null; archived: boolean; sol: string | null }[], balances: Record<string, string | null> | null): NeedRow[] {
  const rows = new Map<string, NeedRow>();
  const add = (address: string, role: string, sol: number) => {
    const w = wallets.find((x) => x.address === address);
    const r = rows.get(address) ?? { address, label: w?.label || address, role, needed: 0, available: Number(balances?.[address] ?? w?.sol ?? 0) || 0 };
    r.needed += sol;
    if (!r.role.includes(role)) r.role = r.role ? `${r.role} + ${role}` : role;
    rows.set(address, r);
  };
  const hasBundle = f.tasks.some((t) => t.type === "bundle");
  if (f.devWallet) add(f.devWallet, "dev", COST.create + (Number(f.devBuySol) || 0) + (hasBundle ? Number(f.tasks.find((t) => t.type === "bundle")?.tip ?? 0) || 0 : 0));
  for (const t of f.tasks) {
    for (const a of taskWallets(t, wallets)) {
      if (t.type === "bundle" || t.type === "sniper") add(a, t.type, taskBuyFor(t, a) + COST.perBuy);
      else if (t.type === "buy" || t.type === "volume") add(a, t.type, (Number(t.maxTradeAmount) || 0) + COST.perBuy);
      else add(a, "wash", COST.perBuy);
    }
  }
  return [...rows.values()];
}
