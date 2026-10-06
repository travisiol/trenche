/**
 * Launch form model — Block X "Launch Token" modal + task model reproduced 1:1 (see design/blockx/BEHAVIOUR.md §4).
 * A form is one draft; drafts are saved through src/components/launch/drafts.ts and task presets through /api/presets.
 */
import { TASK_DEFAULTS, TASK_LIMITS, type LaunchExecuteRequest, type LaunchTask, type LaunchTaskType, type TradeMode } from "@/lib/types";

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
  /** sniper: retry switch (Block X "Retry On/Off"; off = autoRetryCount ignored) */
  retry: boolean;
  /** sniper: delay between wallet buys, seconds (0 = all instant) */
  minDelaySec: number;
  maxDelaySec: number;
  autoStart: boolean;
  /** buy/volume */
  minIntervalSec: number;
  maxIntervalSec: number;
  minTradeAmount: string;
  maxTradeAmount: string;
  tradeMode: TradeMode;
  buyRatioPercent: number;
  /** "" = unlimited (Block X leaves these empty) */
  maxTradesPerWallet: string;
  maxDurationMinutes: string;
  /** "Stop on activity" / bundle "Sell all on external": net external SOL threshold */
  stopOnActivity: boolean;
  stopOnActivitySol: string;
  /** wash: wash wallets per source wallet (1–3) and the pairing */
  washPerSource: 1 | 2 | 3;
  washPairs: Record<string, string[]>;
  /** wash: delay between pairs, seconds */
  washMinDelaySec: number;
  washMaxDelaySec: number;
};

export type LaunchForm = {
  /** draft id (server or local) */
  id: string;
  name: string;
  symbol: string;
  description: string;
  twitter: string;
  telegram: string;
  website: string;
  /** square PNG data URL, cropped client-side */
  imageDataUrl: string;
  /** "pump" = a …pump address is searched at launch (Fetch mint address) */
  vanity: string;
  /** imported mint keypair (base58 or JSON byte array) — signs the create tx instead of a generated mint */
  mintSecret: string;
  /** public key derived from mintSecret (display only) */
  mintAddress: string;
  /** "Fetch mint address": a …pump address reserved by POST /api/launch/mint, passed as LaunchPrepareRequest.mint */
  reservedMint: string;
  devWallet: string;
  devBuySol: string;
  slippageBps: number;
  cashback: boolean;
  /** default tip (SOL) for new tasks — Block X "TIP (SOL)" field of the Tasks panel */
  tipSol: string;
  /** trading preset selected in the Tasks panel (P1 · P2 · P3) */
  presetIndex: 0 | 1 | 2;
  tasks: FormTask[];
  /** Auto Dump: dump every launch wallet when net external volume reaches this SOL amount */
  sellOnExternalEnabled: boolean;
  sellOnExternalThreshold: string;
  /** Auto Dev Sell: sell 100 % of the dev wallet after N ms (MS) or at a market cap in USD (MC) */
  autoDevSellEnabled: boolean;
  autoDevSellMode: "ms" | "mc";
  autoDevSellValue: string;
  /** Auto-claim rewards → dev wallet: the server claims the pump.fun creator vault to the dev wallet on a timer
   *  (default on = Settings.autoClaimRewards; min SOL 0.01, every 300 s) */
  autoClaimEnabled: boolean;
  autoClaimMinSol: string;
  autoClaimIntervalSec: string;
  updatedAt: number;
};

let seq = 0;
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
export const newDraftId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function newTask(type: LaunchTaskType): FormTask {
  const d = TASK_DEFAULTS[type] as Partial<Record<keyof FormTask, unknown>>;
  return {
    id: newId(),
    type,
    walletIds: [],
    walletGroupIds: [],
    buyAmount: "0.1",
    walletBuyAmounts: {},
    slippagePercent: (d.slippagePercent as number | undefined) ?? (type === "bundle" || type === "sniper" ? 30 : 20),
    tip: "0.0002",
    autoRetryCount: 1,
    retry: true,
    minDelaySec: 0,
    maxDelaySec: 0,
    autoStart: type === "buy" || type === "volume" ? false : true,
    minIntervalSec: 0,
    maxIntervalSec: type === "buy" ? 0 : 1,
    minTradeAmount: "0.1",
    maxTradeAmount: "0.2",
    tradeMode: (d.tradeMode as TradeMode | undefined) ?? (type === "volume" ? "both" : "buy"),
    buyRatioPercent: 50,
    maxTradesPerWallet: "",
    maxDurationMinutes: "",
    stopOnActivity: false,
    stopOnActivitySol: "",
    washPerSource: 1,
    washPairs: {},
    washMinDelaySec: 0,
    washMaxDelaySec: 0,
  };
}

export const EMPTY_FORM: LaunchForm = {
  id: "",
  name: "",
  symbol: "",
  description: "",
  twitter: "",
  telegram: "",
  website: "",
  imageDataUrl: "",
  vanity: "",
  mintSecret: "",
  mintAddress: "",
  reservedMint: "",
  devWallet: "",
  devBuySol: "1",
  slippageBps: 3000,
  cashback: false,
  tipSol: "0.0002",
  presetIndex: 0,
  tasks: [],
  sellOnExternalEnabled: false,
  sellOnExternalThreshold: "0",
  autoDevSellEnabled: false,
  autoDevSellMode: "ms",
  autoDevSellValue: "",
  autoClaimEnabled: true,
  autoClaimMinSol: "0.01",
  autoClaimIntervalSec: "300",
  updatedAt: 0,
};

/** `autoClaim` = Settings.autoClaimRewards (the Launch Token "Auto-claim rewards → dev wallet" default) */
export function newForm(devWallet = "", autoClaim = true): LaunchForm {
  return { ...EMPTY_FORM, id: newDraftId(), devWallet, autoClaimEnabled: autoClaim, updatedAt: Date.now() };
}

/** Accepts any older draft shape (localStorage of ui2, server drafts) and fills the gaps. */
export function normalizeForm(d: Partial<LaunchForm> & Record<string, unknown>): LaunchForm {
  const legacyAuto = d as { autoDumpEnabled?: boolean; autoDumpMcUsd?: string; autoDumpAfterSec?: string };
  const auto: Partial<LaunchForm> = {};
  if (legacyAuto.autoDumpEnabled !== undefined && d.autoDevSellEnabled === undefined) {
    auto.autoDevSellEnabled = !!legacyAuto.autoDumpEnabled;
    if (Number(legacyAuto.autoDumpMcUsd) > 0) {
      auto.autoDevSellMode = "mc";
      auto.autoDevSellValue = String(legacyAuto.autoDumpMcUsd);
    } else if (Number(legacyAuto.autoDumpAfterSec) > 0) {
      auto.autoDevSellMode = "ms";
      auto.autoDevSellValue = String(Number(legacyAuto.autoDumpAfterSec) * 1000);
    }
  }
  return {
    ...EMPTY_FORM,
    ...d,
    ...auto,
    id: d.id || newDraftId(),
    tasks: (d.tasks ?? []).map((t) => ({ ...newTask(t.type), ...t })),
  };
}

export const TASK_META: Record<LaunchTaskType, { label: string; title: string; short: string; blurb: string; icon: "bundle" | "sniper" | "buy" | "volume" | "wash"; color: string }> = {
  bundle: { label: "Bundle", title: "Bundle Task", short: "Buy in the create bundle", blurb: "These wallets buy inside the same Jito bundle as the create, so nobody can trade before them. Jito accepts the create plus 4 buys.", icon: "bundle", color: "var(--accent)" },
  sniper: { label: "Sniper", title: "Sniper Task", short: "Buy right after create", blurb: "These wallets send their buy the instant the create confirms, with optional retries.", icon: "sniper", color: "var(--yellow-100)" },
  buy: { label: "Buy", title: "Buy Task", short: "Keep buying over time", blurb: "These wallets keep buying at random amounts and pauses after the launch. Start / Pause / Stop from the card.", icon: "buy", color: "var(--green-100)" },
  volume: { label: "Volume", title: "Volume Task", short: "Buy and sell to print volume", blurb: "These wallets buy and sell at random amounts and pauses to print volume. Start / Pause / Stop from the card.", icon: "volume", color: "var(--blue-100)" },
  wash: { label: "Wash", title: "Wash Task", short: "Sell to wash wallets", blurb: "Each source wallet sells its balance, the SOL goes to its wash wallets, they buy back. Multiple wash wallets split evenly.", icon: "wash", color: "var(--text-300)" },
};

/** Validation mirrors TASK_LIMITS; returns one message per problem (empty = ok). */
export function validateTask(t: FormTask): string[] {
  const out: string[] = [];
  const wallets = t.walletIds.length + (t.walletGroupIds.length ? 1 : 0);
  if (t.type !== "wash" && !wallets) out.push("Pick at least one wallet or group.");
  if (t.walletIds.length > TASK_LIMITS.maxWalletsPerTask) out.push(`Max ${TASK_LIMITS.maxWalletsPerTask} wallets per task.`);
  if (t.type === "bundle" && t.walletIds.length > TASK_LIMITS.maxWalletsPerBundleTask) out.push(`A bundle task holds ${TASK_LIMITS.maxWalletsPerBundleTask} wallets at most.`);
  if (t.slippagePercent < 0 || t.slippagePercent > TASK_LIMITS.maxSlippagePercent) out.push(`Slippage must be 0–${TASK_LIMITS.maxSlippagePercent} %.`);
  if (t.type === "bundle" || t.type === "sniper") {
    if (!(Number(t.buyAmount) > 0) && !Object.values(t.walletBuyAmounts).some((v) => Number(v) > 0)) out.push("Buy amount must be above 0.");
    if (t.retry && t.autoRetryCount > TASK_LIMITS.maxAutoRetryCount) out.push(`Max ${TASK_LIMITS.maxAutoRetryCount} retries.`);
    if (t.minDelaySec > t.maxDelaySec) out.push("Min delay is above max delay.");
  }
  if (t.type === "buy" || t.type === "volume") {
    if (t.minIntervalSec > t.maxIntervalSec) out.push("Min interval is above max interval.");
    if (t.maxIntervalSec > TASK_LIMITS.maxIntervalSec) out.push("Interval too long.");
    if (Number(t.minTradeAmount) > Number(t.maxTradeAmount)) out.push("Min amount is above max amount.");
    if (!(Number(t.minTradeAmount) > 0)) out.push("Trade amount must be above 0.");
    if (t.maxTradesPerWallet !== "" && (Number(t.maxTradesPerWallet) < 1 || Number(t.maxTradesPerWallet) > TASK_LIMITS.maxTradesPerWallet)) out.push(`Trades per wallet: 1–${TASK_LIMITS.maxTradesPerWallet}.`);
    if (t.maxDurationMinutes !== "" && (Number(t.maxDurationMinutes) < 1 || Number(t.maxDurationMinutes) > TASK_LIMITS.maxDurationMinutes)) out.push(`Duration: 1–${TASK_LIMITS.maxDurationMinutes} min.`);
  }
  if (t.type === "wash") {
    const sources = Object.keys(t.washPairs);
    if (!sources.length) out.push("Mark at least one source wallet.");
    if (sources.some((s) => !t.washPairs[s]?.length)) out.push("Every source needs a wash wallet.");
    if (t.washMinDelaySec > t.washMaxDelaySec) out.push("Min delay is above max delay.");
  }
  if (t.stopOnActivity && !(Number(t.stopOnActivitySol) > 0)) out.push("Set the external volume threshold.");
  return out;
}

export function validateForm(f: LaunchForm): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push("Token name is required.");
  if (!f.symbol.trim()) out.push("Symbol is required.");
  if (f.symbol.length > 10) out.push("Symbol: 10 characters max.");
  if (!f.imageDataUrl) out.push("Add an image.");
  if (!f.devWallet) out.push("Select a developer wallet first.");
  if (!(Number(f.devBuySol) >= 0)) out.push("Buy amount must be a number.");
  for (const t of f.tasks) for (const m of validateTask(t)) out.push(`${TASK_META[t.type].label}: ${m}`);
  // the server refuses it (the dev buys inside the create): say so before the click
  if (f.devWallet && f.tasks.some((t) => t.type === "bundle" && t.walletIds.includes(f.devWallet))) out.push("Bundle: the dev wallet buys with the create — take it out of the bundle wallets.");
  if (f.sellOnExternalEnabled && !(Number(f.sellOnExternalThreshold) > 0)) out.push("Auto Dump: set the external volume threshold.");
  if (f.autoDevSellEnabled && !(Number(f.autoDevSellValue) > 0)) out.push(f.autoDevSellMode === "ms" ? "Auto Dev Sell: set the delay in ms." : "Auto Dev Sell: set the market cap.");
  if (f.autoClaimEnabled) {
    if (!(Number(f.autoClaimMinSol) >= 0.001)) out.push("Auto-claim: min SOL must be at least 0.001.");
    if (!(Number(f.autoClaimIntervalSec) >= 300)) out.push("Auto-claim: the interval must be at least 300 s (one vault read per tick).");
  }
  return out;
}

/** Form task → API task (only the fields the type uses; contract in src/lib/types.ts). */
export function toApiTask(t: FormTask): LaunchTask {
  const base = {
    id: t.id,
    walletIds: t.walletIds,
    walletGroupIds: t.walletGroupIds.length ? t.walletGroupIds : undefined,
  };
  if (t.type === "bundle") {
    return {
      ...base,
      type: "bundle",
      buyAmount: t.buyAmount,
      walletBuyAmounts: Object.keys(t.walletBuyAmounts).length ? t.walletBuyAmounts : undefined,
      slippagePercent: t.slippagePercent,
      tip: t.tip,
      sellOnExternalEnabled: t.stopOnActivity || undefined,
      sellOnExternalThreshold: t.stopOnActivity ? t.stopOnActivitySol : undefined,
      autoStart: true,
    };
  }
  if (t.type === "sniper") {
    return {
      ...base,
      type: "sniper",
      buyAmount: t.buyAmount,
      walletBuyAmounts: Object.keys(t.walletBuyAmounts).length ? t.walletBuyAmounts : undefined,
      minDelaySec: t.minDelaySec,
      maxDelaySec: t.maxDelaySec,
      slippagePercent: t.slippagePercent,
      tip: t.tip,
      retry: t.retry,
      maxRetries: t.retry ? t.autoRetryCount : 0,
      autoRetryCount: t.retry ? t.autoRetryCount : 0,
      stopOnActivityEnabled: t.stopOnActivity || undefined,
      stopOnActivityThreshold: t.stopOnActivity ? t.stopOnActivitySol : undefined,
      autoStart: true,
    };
  }
  if (t.type === "wash") {
    const pairs = Object.entries(t.washPairs).map(([source, wash]) => ({ source, wash }));
    return { ...base, type: "wash", walletIds: pairs.map((p) => p.source), pairs, perSource: t.washPerSource, minDelaySec: t.washMinDelaySec, maxDelaySec: t.washMaxDelaySec, autoStart: t.autoStart };
  }
  return {
    ...base,
    type: t.type,
    minIntervalSec: t.minIntervalSec,
    maxIntervalSec: t.maxIntervalSec,
    minTradeAmount: t.minTradeAmount,
    maxTradeAmount: t.maxTradeAmount,
    slippagePercent: t.slippagePercent,
    tip: t.tip,
    tradeMode: t.type === "volume" ? t.tradeMode : "buy",
    buyRatioPercent: t.buyRatioPercent,
    maxTradesPerWallet: t.maxTradesPerWallet !== "" ? Number(t.maxTradesPerWallet) : undefined,
    maxDurationMinutes: t.maxDurationMinutes !== "" ? Number(t.maxDurationMinutes) : undefined,
    autoStart: t.autoStart,
    stopOnActivityEnabled: t.stopOnActivity || undefined,
    stopOnActivityThreshold: t.stopOnActivity ? t.stopOnActivitySol : undefined,
  };
}

/** API task → form task (CTO records keep LaunchTask[]; the dialogs edit FormTask). */
export function fromApiTask(t: LaunchTask): FormTask {
  const base = newTask(t.type);
  const o = t as unknown as Record<string, unknown>;
  const num = (k: string, d: number) => (typeof o[k] === "number" ? (o[k] as number) : d);
  const str = (k: string, d: string) => (typeof o[k] === "string" ? (o[k] as string) : d);
  const f: FormTask = {
    ...base,
    id: t.id ?? base.id,
    walletIds: t.walletIds ?? [],
    walletGroupIds: t.walletGroupIds ?? [],
    buyAmount: str("buyAmount", base.buyAmount),
    walletBuyAmounts: (o.walletBuyAmounts as Record<string, string> | undefined) ?? {},
    slippagePercent: num("slippagePercent", base.slippagePercent),
    tip: str("tip", base.tip),
    autoStart: typeof o.autoStart === "boolean" ? (o.autoStart as boolean) : base.autoStart,
  };
  if (t.type === "sniper") {
    f.minDelaySec = num("minDelaySec", 0);
    f.maxDelaySec = num("maxDelaySec", 0);
    f.retry = typeof o.retry === "boolean" ? (o.retry as boolean) : num("maxRetries", num("autoRetryCount", 0)) > 0;
    f.autoRetryCount = num("maxRetries", num("autoRetryCount", 1));
    f.stopOnActivity = !!o.stopOnActivityEnabled;
    f.stopOnActivitySol = str("stopOnActivityThreshold", "");
  } else if (t.type === "bundle") {
    f.stopOnActivity = !!o.sellOnExternalEnabled;
    f.stopOnActivitySol = str("sellOnExternalThreshold", "");
  } else if (t.type === "buy" || t.type === "volume") {
    f.minIntervalSec = num("minIntervalSec", base.minIntervalSec);
    f.maxIntervalSec = num("maxIntervalSec", base.maxIntervalSec);
    f.minTradeAmount = str("minTradeAmount", base.minTradeAmount);
    f.maxTradeAmount = str("maxTradeAmount", base.maxTradeAmount);
    f.tradeMode = (o.tradeMode as TradeMode | undefined) ?? base.tradeMode;
    f.buyRatioPercent = num("buyRatioPercent", 50);
    f.maxTradesPerWallet = typeof o.maxTradesPerWallet === "number" ? String(o.maxTradesPerWallet) : "";
    f.maxDurationMinutes = typeof o.maxDurationMinutes === "number" ? String(o.maxDurationMinutes) : "";
    f.stopOnActivity = !!o.stopOnActivityEnabled;
    f.stopOnActivitySol = str("stopOnActivityThreshold", "");
  } else if (t.type === "wash") {
    const pairs = (o.pairs as { source: string; wash: string[] }[] | undefined) ?? [];
    f.washPairs = Object.fromEntries(pairs.map((p) => [p.source, p.wash]));
    f.washPerSource = (num("perSource", 1) as 1 | 2 | 3) || 1;
    f.washMinDelaySec = num("minDelaySec", 0);
    f.washMaxDelaySec = num("maxDelaySec", 0);
  }
  return f;
}

/** The POST /api/launch/execute body for a form whose mint came back from /api/launch/prepare. */
export function toExecuteRequest(f: LaunchForm, mint: string): LaunchExecuteRequest {
  const v = Number(f.autoDevSellValue) || 0;
  return {
    mint,
    launchpad: "pumpfun",
    devWallet: f.devWallet,
    devBuySol: f.devBuySol || "0",
    quote: "SOL",
    tasks: f.tasks.map(toApiTask),
    sellOnExternalEnabled: f.sellOnExternalEnabled || undefined,
    sellOnExternalThreshold: f.sellOnExternalEnabled ? f.sellOnExternalThreshold : undefined,
    autoDevSell: f.autoDevSellEnabled && v > 0 ? { mode: f.autoDevSellMode, value: v } : undefined,
    autoClaim: { enabled: !!f.autoClaimEnabled, minSol: f.autoClaimMinSol || undefined, intervalSec: Number(f.autoClaimIntervalSec) || undefined },
    slippageBps: f.slippageBps,
    cashback: false,
    draftId: f.id || undefined,
  };
}

/** Global Task Presets keep the whole snapshot except the image (Quick Launch replays it); "Load preset" takes only the tasks. */
export function presetData(f: LaunchForm): Record<string, unknown> {
  const { imageDataUrl: _img, id: _id, mintSecret: _secret, mintAddress: _addr, reservedMint: _res, ...rest } = f;
  void _res;
  void _img;
  void _id;
  void _secret;
  void _addr;
  return rest;
}
/** "Load replaces only the tasks on this launch. Launchpad, quote, buy amount, wallet, and fees stay as they are." */
export function fromPreset(data: Record<string, unknown>, current: LaunchForm): LaunchForm {
  const d = data as Partial<LaunchForm>;
  return { ...current, tasks: (d.tasks ?? []).map((t) => ({ ...newTask(t.type), ...t, id: newId() })) };
}
/** Quick Launch: the saved snapshot on a fresh draft (image and dev wallet from the current form). */
export function fromPresetSnapshot(data: Record<string, unknown>, current: LaunchForm): LaunchForm {
  const d = data as Partial<LaunchForm>;
  return normalizeForm({ ...d, id: current.id, imageDataUrl: current.imageDataUrl, devWallet: d.devWallet || current.devWallet, tasks: (d.tasks ?? []).map((t) => ({ ...newTask(t.type), ...t, id: newId() })) });
}

/* ------------------------------------------------------------- readability helpers */

/** Wallet addresses a task touches (explicit + expanded groups), de-duplicated. */
export function taskWallets(t: FormTask, wallets: { address: string; group: string | null; archived: boolean }[]): string[] {
  if (t.type === "wash") return Object.keys(t.washPairs);
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
    return `${w} buy ${same ? `${t.buyAmount} SOL each` : `${total} SOL in total`} inside the create bundle, tip ${t.tip} SOL, slippage ${t.slippagePercent} %.`;
  }
  if (t.type === "sniper") {
    const same = addrs.every((a) => taskBuyFor(t, a) === taskBuyFor(t, addrs[0]));
    const total = addrs.reduce((s, a) => s + taskBuyFor(t, a), 0);
    return `${w} buy ${same ? `${t.buyAmount} SOL each` : `${total} SOL in total`} the moment the create confirms${t.retry && t.autoRetryCount ? `, up to ${t.autoRetryCount} retr${t.autoRetryCount > 1 ? "ies" : "y"}` : ""}, slippage ${t.slippagePercent} %.`;
  }
  if (t.type === "wash") {
    const pairs = Object.values(t.washPairs).reduce((s, p) => s + p.length, 0);
    return `${n} source wallet${n !== 1 ? "s" : ""} sell to ${pairs} wash wallet${pairs !== 1 ? "s" : ""}${t.washMaxDelaySec ? `, ${t.washMinDelaySec}–${t.washMaxDelaySec} s between pairs` : ""}.`;
  }
  const verb = t.tradeMode === "both" ? "buy and sell" : t.tradeMode === "sell" ? "sell" : "buy";
  return `${w} ${verb} ${t.minTradeAmount}–${t.maxTradeAmount} SOL every ${t.minIntervalSec}–${t.maxIntervalSec} s${t.maxTradesPerWallet ? `, up to ${t.maxTradesPerWallet} trades each` : ""}${t.maxDurationMinutes ? `, for ${t.maxDurationMinutes} min` : ""}.`;
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

/* ------------------------------------------------------------- pump.fun curve math (dev buy ⇄ % of supply) */
/** Fresh-curve constants (mainnet); the server exposes the per-cluster values on GET /api/settings.pump and the
 *  exact figures on GET /api/launch/calc — this local copy only fills the hint while that call is in flight. */
export const CURVE = { virtualSol: 30, virtualTokens: 1_073_000_000, supply: 1_000_000_000 };
/** pump.fun protocol fee taken on the SOL side of a buy (1.25 % — Block X shows 1 SOL → 3.42 %, 2 SOL → 6.63 %) */
export const PUMP_FEE = 0.0125;
/** Tokens received for `sol` on a fresh curve (constant product, fee netted first). */
export function tokensForSol(sol: number, c = CURVE): number {
  if (!(sol > 0)) return 0;
  const net = sol * (1 - PUMP_FEE);
  const k = c.virtualSol * c.virtualTokens;
  return c.virtualTokens - k / (c.virtualSol + net);
}
export function supplyPctForSol(sol: number, c = CURVE): number {
  return (tokensForSol(sol, c) / c.supply) * 100;
}
/** SOL needed to buy `pct` % of the supply on a fresh curve. */
export function solForSupplyPct(pct: number, c = CURVE): number {
  const tokens = Math.min(c.virtualTokens - 1, (Math.max(0, pct) / 100) * c.supply);
  const k = c.virtualSol * c.virtualTokens;
  return (k / (c.virtualTokens - tokens) - c.virtualSol) / (1 - PUMP_FEE);
}
/** Sequential buys on a fresh curve (dev first, then bundle wallets in order): % of supply each one gets. */
export function sequentialSupplyPct(sols: number[], c = CURVE): { pct: number; tokens: number }[] {
  let vSol = c.virtualSol;
  let vTok = c.virtualTokens;
  const k = vSol * vTok;
  return sols.map((s) => {
    if (!(s > 0)) return { pct: 0, tokens: 0 };
    const net = s * (1 - PUMP_FEE);
    const nextTok = k / (vSol + net);
    const got = vTok - nextTok;
    vSol += net;
    vTok = nextTok;
    return { pct: (got / c.supply) * 100, tokens: got };
  });
}
