/**
 * Launch form model — Block X task model reproduced 1:1 (see BRIEF "Tâches de launch").
 * Saved as a draft in localStorage and as presets through /api/presets.
 */
import { TASK_DEFAULTS, TASK_LIMITS, type LaunchTask, type LaunchTaskType, type TradeMode } from "@/lib/ui-types";

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

export const TASK_META: Record<LaunchTaskType, { label: string; blurb: string; icon: "bundle" | "sniper" | "buy" | "volume" | "wash"; color: string }> = {
  bundle: { label: "Bundle", blurb: "Buys inside the same Jito bundle as the create. Max 4 wallets.", icon: "bundle", color: "var(--accent)" },
  sniper: { label: "Sniper", blurb: "Buys the instant the create confirms, with retries.", icon: "sniper", color: "var(--warn)" },
  buy: { label: "Buy", blurb: "Periodic buys from the wallets. Pausable.", icon: "buy", color: "var(--up)" },
  volume: { label: "Volume", blurb: "Periodic buys and sells to print volume. Pausable.", icon: "volume", color: "var(--auto)" },
  wash: { label: "Wash", blurb: "Moves every token of the wallets to fresh wallets.", icon: "wash", color: "var(--text-2)" },
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
