/* TRENCH server store — one singleton on globalThis.__trench so it survives Turbopack HMR.
 * Secrets (wallet keys) live ONLY in the encrypted keystore + in memory while unlocked. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Keypair } from "@solana/web3.js";
import { SolanaState } from "@/engine/solana/state.js";
import { HELIUS_SENDER_URL, SOLANA_PUBLIC_RPC, normalizeSolanaRpc, withSwqosOnly } from "@/engine/solana/config.js";
import { noteReadRpc, queuedConnection } from "./rpcqueue";
import { SenderConnection } from "./sender";

const senderConns = new Map<string, SenderConnection>();
import type { ActivityItem, LaunchPreset, LaunchRecord, Settings, TradingPreset, TradingPresets } from "@/lib/types";
import { DEFAULT_TIP_SOL, TRADING_PRESET_DEFAULTS } from "@/lib/types";

/** a vault entry; `deletedAt` = removed from the wallet list by the user, key kept encrypted in the vault (restorable) */
export type KeystoreEntry = { label: string; secret: string; deletedAt?: number };

export type WalletMeta = { label?: string; group: string | null; archived: boolean; order: number };
export type WalletMetaFile = {
  meta: Record<string, WalletMeta>;
  groups: { id: string; name: string }[];
  active: string | null;
};

export type Cluster = "mainnet" | "devnet";
export const DEVNET_RPC = "https://api.devnet.solana.com";

export type StoredSettings = {
  /** "mainnet" (default) or "devnet": devnet reads/sends on api.devnet.solana.com, disables Jito, links the explorer with ?cluster=devnet */
  cluster: Cluster;
  rpcUrl: string;
  sendRpcUrl: string;
  pumpportalKey: string;
  heliusKey: string;
  /** Astralane API key (portal.astralane.io): when set, launch bundles go through Astralane instead of the public Jito
   *  endpoint (which drops our pump.fun bundles — 6 real tests, 2026-10-06). Never sent to the browser. */
  astralaneKey: string;
  husherKey: string;
  /** the Astralane key may send bundles (VIP tier): Jito-on launches then use Astralane sendBundle */
  astralaneBundles?: boolean;
  /** Jito on with an Astralane key that has no bundles: send the launch bundle to Jito's public block engine anyway
   *  (atomic, one tx per wallet) instead of the Astralane fast lane (not atomic) — Settings › Bundle route */
  jitoPublic?: boolean;
  /** Jito on: launch bundles go through Helius sendBundle (the Helius key / RPC), which forwards them to Jito */
  heliusBundles?: boolean;
  jitoEnabled: boolean;
  /** Launch Token modal "Auto-claim rewards → dev wallet" default (true) */
  autoClaimRewards: boolean;
  slippageBps: number;
  cuPrice: number;
  /** launch buys racing the snipers (bundle wallets in their own tx, sniper tasks), µL/CU — the create goes ×1.5 above */
  launchCuPrice: number;
  /** Jito off: the first 2 bundle wallets buy INSIDE the create (atomic, but trackers then show ONE trader — the dev —
   *  for the whole buy). Off by default since 2026-10-06: the owner wants every wallet to show as its own trader */
  bundleInCreate: boolean;
  tipSol: string;
  presets: [string, string, string];
  /** Block X Trading Presets P1..P3 */
  tradingPresets: TradingPresets;
  keybinds: { quickBuy: [string, string, string]; close: string };
};

export type PendingMint = {
  keypair: Keypair;
  uri: string;
  name: string;
  symbol: string;
  image: string | null;
  at: number;
  /** came from the reserved pool ("Fetch mint address"): handed back when the launch is refused before sending */
  reserved?: boolean;
};

export type Job = {
  id: string;
  kind: string;
  label: string;
  total: number;
  completed: number;
  sent: number;
  failed: number;
  steps: import("@/lib/types").JobStep[];
  status: "running" | "done" | "error" | "stopped";
  cluster: Cluster;
  nextAt: number;
  error: string | null;
  extra: Record<string, unknown> | null;
  startedAt: number;
  endedAt: number | null;
  /** cooperative cancellation flag read by long loops */
  stop: boolean;
};

export type Store = {
  dir: string;
  paths: {
    keystore: string;
    settings: string;
    wallets: string;
    activity: string;
    launches: string;
    presets: string;
    tracked: string;
    jobs: string;
    runtime: string;
    drafts: string;
    recent: string;
    ctos: string;
  };
  sol: SolanaState;
  passphrase: string | null;
  vault: KeystoreEntry[];
  settings: StoredSettings;
  walletMeta: WalletMetaFile;
  activity: ActivityItem[];
  launches: LaunchRecord[];
  presets: LaunchPreset[];
  tracked: string[];
  jobs: Map<string, Job>;
  pendingMints: Map<string, PendingMint>;
  balances: { at: number; map: Record<string, string | null> } | null;
  /** runtime bags owned by other modules (launch.ts, volume.ts, autodump.ts, feed.ts) */
  runtime: Record<string, unknown>;
};

const DEFAULT_SETTINGS: StoredSettings = {
  cluster: "mainnet",
  rpcUrl: "",
  sendRpcUrl: HELIUS_SENDER_URL,
  pumpportalKey: "",
  heliusKey: "",
  astralaneKey: "",
  husherKey: "",
  jitoEnabled: false,
  autoClaimRewards: true,
  slippageBps: 1000,
  cuPrice: 2_000_000,
  // 2026-10-06, his 16 launches: external buys landing in the create's block paid 3.3 M µL/CU median (max 55 M);
  // ours paid 2 M and mostly landed one block late. 10 M ≈ 0.0013 SOL per buy (130 k CU limit)
  launchCuPrice: 10_000_000,
  bundleInCreate: false,
  tipSol: DEFAULT_TIP_SOL,
  presets: ["0.1", "0.2", "0.5"],
  tradingPresets: TRADING_PRESET_DEFAULTS,
  keybinds: { quickBuy: ["1", "2", "3"], close: "Escape" },
};

/** %LOCALAPPDATA%/trench, or TRENCH_DATA_DIR (an isolated directory for tests: own vault, settings, jobs) */
export function dataDir(): string {
  const override = process.env.TRENCH_DATA_DIR?.trim();
  if (override) return override;
  const base = process.env.LOCALAPPDATA || join(homedir(), ".local", "share");
  return join(base, "trench");
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

function build(): Store {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const paths = {
    keystore: join(dir, "keystore.enc.json"),
    settings: join(dir, "settings.json"),
    wallets: join(dir, "wallets.json"),
    activity: join(dir, "activity.json"),
    launches: join(dir, "launches.json"),
    presets: join(dir, "presets.json"),
    tracked: join(dir, "tracked.json"),
    jobs: join(dir, "jobs.json"),
    runtime: join(dir, "runtime.json"),
    drafts: join(dir, "drafts.json"),
    recent: join(dir, "recent.json"),
    ctos: join(dir, "ctos.json"),
  };
  const saved = readJson<Partial<StoredSettings>>(paths.settings, {});
  const settings: StoredSettings = { ...DEFAULT_SETTINGS, ...saved, tradingPresets: mergeTradingPresets(saved.tradingPresets) };
  // every server-side Connection goes through the RPC queue (concurrency, retry on 429, micro-cache) — rpcqueue.ts
  const sol = new SolanaState();
  sol.connection = () => {
    const url = sol.config.rpcUrl?.trim() || SOLANA_PUBLIC_RPC;
    noteReadRpc(url);
    return queuedConnection(url);
  };
  // the send connection is a Connection on the READ RPC whose sendRawTransaction also posts to the send RPC (Helius
  // Sender): blockhash / simulate / statuses never reach Sender, which only accepts sendTransaction — sender.ts
  sol.sendConnection = () => {
    const read = sol.config.rpcUrl?.trim() || SOLANA_PUBLIC_RPC;
    const send = withSwqosOnly(sol.config.sendRpcUrl ?? "");
    const key = `${read}|${send}`;
    if (!senderConns.has(key)) senderConns.set(key, new SenderConnection(read, send || null));
    return senderConns.get(key)!;
  };
  const store: Store = {
    dir,
    paths,
    sol,
    passphrase: null,
    vault: [],
    settings,
    walletMeta: readJson<WalletMetaFile>(paths.wallets, { meta: {}, groups: [], active: null }),
    activity: readJson<ActivityItem[]>(paths.activity, []),
    launches: readJson<LaunchRecord[]>(paths.launches, []),
    presets: readJson<LaunchPreset[]>(paths.presets, []),
    tracked: readJson<string[]>(paths.tracked, []),
    jobs: loadJobs(paths.jobs),
    pendingMints: new Map(),
    balances: null,
    runtime: {},
  };
  applySettings(store);
  return store;
}

/** saved presets merged over the Block X defaults (a partial/old file never yields a broken preset) */
export function mergeTradingPresets(saved: unknown, base: TradingPresets = TRADING_PRESET_DEFAULTS): TradingPresets {
  const arr = Array.isArray(saved) ? (saved as Partial<TradingPreset>[]) : [];
  const four = <T,>(v: unknown, d: [T, T, T, T], map: (x: unknown) => T | null): [T, T, T, T] => {
    if (!Array.isArray(v) || v.length !== 4) return d;
    const out = v.map(map);
    return out.every((x) => x !== null) ? (out as [T, T, T, T]) : d;
  };
  const str = (x: unknown) => (typeof x === "string" || typeof x === "number") && /^\d*\.?\d+$/.test(String(x)) ? String(x) : null;
  const pct = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 100 ? Number(x) : null);
  return base.map((b, i): TradingPreset => {
    const p = arr[i] ?? {};
    return {
      buyAmounts: four(p.buyAmounts, b.buyAmounts, str),
      buyPercents: four(p.buyPercents, b.buyPercents, pct),
      sellPercents: four(p.sellPercents, b.sellPercents, pct),
      slippagePercent: pct(p.slippagePercent) ?? b.slippagePercent,
      tipSol: str(p.tipSol) ?? b.tipSol,
      buysValueSpreadPct: pct(p.buysValueSpreadPct) ?? b.buysValueSpreadPct,
      buysDelaySec: Number.isFinite(Number(p.buysDelaySec)) && Number(p.buysDelaySec) >= 0 && Number(p.buysDelaySec) <= 1 ? Number(p.buysDelaySec) : b.buysDelaySec,
    };
  }) as TradingPresets;
}

/** jobs.json → Map; a job that was still running when the server died becomes "stopped" (nothing more is sent) */
function loadJobs(path: string): Map<string, Job> {
  const map = new Map<string, Job>();
  for (const raw of readJson<Partial<Job>[]>(path, [])) {
    if (!raw || typeof raw.id !== "string") continue;
    const job: Job = {
      id: raw.id,
      kind: raw.kind ?? "job",
      label: raw.label ?? "",
      total: raw.total ?? 0,
      completed: raw.completed ?? 0,
      sent: raw.sent ?? 0,
      failed: raw.failed ?? 0,
      steps: Array.isArray(raw.steps) ? raw.steps : [],
      status: raw.status ?? "stopped",
      cluster: raw.cluster === "devnet" ? "devnet" : "mainnet",
      nextAt: 0,
      error: raw.error ?? null,
      extra: raw.extra ?? null,
      startedAt: raw.startedAt ?? Date.now(),
      endedAt: raw.endedAt ?? null,
      stop: true,
    };
    if (job.status === "running") {
      job.status = "stopped";
      job.error = "Server restarted while this job was running: nothing more was sent. Check the signatures above on the explorer.";
      job.endedAt = Date.now();
      job.steps.push({ ok: false, at: Date.now(), note: job.error });
    }
    map.set(job.id, job);
  }
  return map;
}

let jobsTimer: ReturnType<typeof setTimeout> | null = null;
/** write jobs.json at most every 400 ms (every job mutation calls it) */
export function saveJobsSoon(st: Store = store()): void {
  if (jobsTimer) return;
  jobsTimer = setTimeout(() => {
    jobsTimer = null;
    try {
      const list = [...st.jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 200).map(({ stop: _stop, ...j }) => j);
      writeJson(st.paths.jobs, list);
    } catch {
      /* disk error: keep in memory */
    }
  }, 400);
}

declare global {
  var __trench: Store | undefined;
}

export function store(): Store {
  if (!globalThis.__trench) globalThis.__trench = build();
  return globalThis.__trench;
}

export const isDevnet = (s: StoredSettings = store().settings): boolean => s.cluster === "devnet";

/** effective read RPC — mainnet: explicit rpcUrl > Helius key > public; devnet: an explicit rpcUrl that
 *  names devnet, else api.devnet.solana.com (a saved mainnet RPC is never reused on devnet) */
export function effectiveRpcUrl(s: StoredSettings): string {
  const explicit = normalizeSolanaRpc(s.rpcUrl);
  if (isDevnet(s)) return explicit && /devnet/i.test(explicit) ? explicit : DEVNET_RPC;
  if (explicit) return explicit;
  if (s.heliusKey.trim()) {
    const k = s.heliusKey.trim();
    const m = /api-key=([A-Za-z0-9-]+)/.exec(k); // a whole URL stored by an older build
    return `https://mainnet.helius-rpc.com/?api-key=${m ? m[1] : k}`;
  }
  return SOLANA_PUBLIC_RPC;
}

/** Helius sendBundle endpoint: the Helius key, else an explicit RPC URL that is Helius; null when neither */
export function heliusBundleUrl(s: StoredSettings): string | null {
  return heliusBundleUrls(s)[0] ?? null;
}
/** every Helius endpoint a bundle may be sent to, tried in this order on an HTTP 5xx: the Settings RPC URL when it is a
 *  Helius one (a Business plan's dedicated "…-fast-mainnet.helius-rpc.com" endpoint carries its auth in the host), then
 *  mainnet and beta with the Helius key. sendBundle answered HTTP 500 on mainnet right after a Business upgrade. */
export function heliusBundleUrls(s: StoredSettings): string[] {
  const out: string[] = [];
  const explicit = normalizeSolanaRpc(s.rpcUrl);
  if (explicit && /^https:\/\/[a-z0-9.-]*helius-rpc\.com/i.test(explicit) && !/devnet/i.test(explicit)) out.push(explicit);
  if (s.heliusKey.trim()) {
    const k = s.heliusKey.trim();
    const m = /api-key=([A-Za-z0-9-]+)/.exec(k);
    const key = m ? m[1] : k;
    out.push(`https://mainnet.helius-rpc.com/?api-key=${key}`, `https://beta.helius-rpc.com/?api-key=${key}`);
  }
  return [...new Set(out)];
}

/** effective send RPC — devnet has no Helius Sender nor Jito: sends go to the read RPC */
export function effectiveSendRpcUrl(s: StoredSettings): string {
  const read = effectiveRpcUrl(s);
  if (isDevnet(s)) {
    const explicit = s.sendRpcUrl.trim();
    return explicit && /devnet/i.test(explicit) ? explicit : read;
  }
  return s.sendRpcUrl.trim() || read;
}

/** explorer link for a signature or an address, on the active cluster */
export function explorerUrl(kind: "tx" | "address", value: string, s: StoredSettings = store().settings): string {
  return `https://solscan.io/${kind}/${value}${isDevnet(s) ? "?cluster=devnet" : ""}`;
}

export function applySettings(st: Store): void {
  st.sol.config = {
    ...st.sol.config,
    cluster: isDevnet(st.settings) ? "devnet" : "mainnet-beta",
    rpcUrl: effectiveRpcUrl(st.settings),
    sendRpcUrl: effectiveSendRpcUrl(st.settings),
    slippageBps: st.settings.slippageBps,
    priorityMicroLamports: st.settings.cuPrice,
  };
}

export function saveSettings(st: Store): void {
  writeJson(st.paths.settings, st.settings);
  applySettings(st);
}

export function publicSettings(s: StoredSettings): Settings {
  const pump = store().runtime.pumpCluster as Settings["pump"] & { rpcUrl?: string } | undefined;
  return {
    pump: pump && pump.cluster === s.cluster ? { cluster: pump.cluster, feeRecipients: pump.feeRecipients, secondRecipients: pump.secondRecipients, initialVirtualSol: pump.initialVirtualSol, initialVirtualTokens: pump.initialVirtualTokens, initialRealTokens: pump.initialRealTokens, at: pump.at } : null,
    cluster: s.cluster,
    explorerSuffix: isDevnet(s) ? "?cluster=devnet" : "",
    effectiveRpcUrl: effectiveRpcUrl(s),
    effectiveSendRpcUrl: effectiveSendRpcUrl(s),
    rpcUrl: s.rpcUrl,
    sendRpcUrl: s.sendRpcUrl,
    hasPumpportalKey: !!s.pumpportalKey.trim(),
    hasHeliusKey: !!s.heliusKey.trim(),
    hasAstralaneKey: !!(s.astralaneKey ?? "").trim(),
    hasHusherKey: !!(process.env.HUSHER_API_KEY?.trim() || (s.husherKey ?? "").trim()),
    jitoEnabled: s.jitoEnabled,
    astralaneBundles: s.astralaneBundles === true,
    jitoPublic: s.jitoPublic === true,
    heliusBundles: s.heliusBundles === true,
    hasHeliusBundleUrl: !!heliusBundleUrl(s),
    autoClaimRewards: s.autoClaimRewards !== false,
    slippageBps: s.slippageBps,
    cuPrice: s.cuPrice,
    launchCuPrice: s.launchCuPrice ?? 10_000_000,
    bundleInCreate: s.bundleInCreate === true,
    tipSol: s.tipSol,
    presets: s.presets,
    // a Store singleton built by an older version of this module (HMR) has no tradingPresets yet
    tradingPresets: s.tradingPresets ?? TRADING_PRESET_DEFAULTS,
    keybinds: s.keybinds,
    theme: "dark",
  };
}

/** path of a per-feature JSON file (drafts/recent/ctos); resolved lazily so a Store singleton built by an older
 *  version of this module (globalThis survives HMR) still finds it */
export function dataPath(name: "drafts" | "recent" | "ctos" | "dispersePresets"): string {
  const st = store();
  return (st.paths as Record<string, string>)[name] ?? join(st.dir, `${name}.json`);
}

export function saveWalletMeta(st: Store): void {
  writeJson(st.paths.wallets, st.walletMeta);
}

export function saveLaunches(st: Store): void {
  writeJson(st.paths.launches, st.launches);
}

export function savePresets(st: Store): void {
  writeJson(st.paths.presets, st.presets);
}

export function track(st: Store, mint: string): void {
  if (!st.tracked.includes(mint)) {
    st.tracked.unshift(mint);
    st.tracked = st.tracked.slice(0, 200);
    writeJson(st.paths.tracked, st.tracked);
  }
}

export function logActivity(
  st: Store,
  item: Omit<ActivityItem, "id" | "at"> & { at?: number },
): ActivityItem {
  const full: ActivityItem = {
    id: "a_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    at: item.at ?? Date.now(),
    ...item,
  };
  st.activity.unshift(full);
  if (st.activity.length > 2000) st.activity.length = 2000;
  try {
    writeJson(st.paths.activity, st.activity);
  } catch {
    /* disk error: keep in memory */
  }
  return full;
}
