/* TRENCH server store — one singleton on globalThis.__trench so it survives Turbopack HMR.
 * Secrets (wallet keys) live ONLY in the encrypted keystore + in memory while unlocked. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Keypair } from "@solana/web3.js";
import { SolanaState } from "@/engine/solana/state.js";
import { HELIUS_SENDER_URL, SOLANA_PUBLIC_RPC, normalizeSolanaRpc } from "@/engine/solana/config.js";
import type { ActivityItem, LaunchPreset, LaunchRecord, Settings } from "@/lib/types";

export type KeystoreEntry = { label: string; secret: string };

export type WalletMeta = { label?: string; group: string | null; archived: boolean; order: number };
export type WalletMetaFile = {
  meta: Record<string, WalletMeta>;
  groups: { id: string; name: string }[];
  active: string | null;
};

export type StoredSettings = {
  rpcUrl: string;
  sendRpcUrl: string;
  pumpportalKey: string;
  heliusKey: string;
  jitoEnabled: boolean;
  slippageBps: number;
  cuPrice: number;
  tipSol: string;
  presets: [string, string, string];
  keybinds: { quickBuy: [string, string, string]; close: string };
};

export type PendingMint = {
  keypair: Keypair;
  uri: string;
  name: string;
  symbol: string;
  image: string | null;
  at: number;
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
  status: "running" | "done" | "error";
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
  rpcUrl: "",
  sendRpcUrl: HELIUS_SENDER_URL,
  pumpportalKey: "",
  heliusKey: "",
  jitoEnabled: false,
  slippageBps: 1000,
  cuPrice: 2_000_000,
  tipSol: "0.0005",
  presets: ["0.1", "0.5", "1"],
  keybinds: { quickBuy: ["1", "2", "3"], close: "Escape" },
};

export function dataDir(): string {
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
  };
  const settings = { ...DEFAULT_SETTINGS, ...readJson<Partial<StoredSettings>>(paths.settings, {}) };
  const store: Store = {
    dir,
    paths,
    sol: new SolanaState(),
    passphrase: null,
    vault: [],
    settings,
    walletMeta: readJson<WalletMetaFile>(paths.wallets, { meta: {}, groups: [], active: null }),
    activity: readJson<ActivityItem[]>(paths.activity, []),
    launches: readJson<LaunchRecord[]>(paths.launches, []),
    presets: readJson<LaunchPreset[]>(paths.presets, []),
    tracked: readJson<string[]>(paths.tracked, []),
    jobs: new Map(),
    pendingMints: new Map(),
    balances: null,
    runtime: {},
  };
  applySettings(store);
  return store;
}

declare global {
  // eslint-disable-next-line no-var
  var __trench: Store | undefined;
}

export function store(): Store {
  if (!globalThis.__trench) globalThis.__trench = build();
  return globalThis.__trench;
}

/** effective read RPC: explicit rpcUrl > Helius key > public */
export function effectiveRpcUrl(s: StoredSettings): string {
  const explicit = normalizeSolanaRpc(s.rpcUrl);
  if (explicit) return explicit;
  if (s.heliusKey.trim()) return `https://mainnet.helius-rpc.com/?api-key=${s.heliusKey.trim()}`;
  return SOLANA_PUBLIC_RPC;
}

export function applySettings(st: Store): void {
  st.sol.config = {
    ...st.sol.config,
    rpcUrl: effectiveRpcUrl(st.settings),
    sendRpcUrl: st.settings.sendRpcUrl.trim() || effectiveRpcUrl(st.settings),
    slippageBps: st.settings.slippageBps,
    priorityMicroLamports: st.settings.cuPrice,
  };
}

export function saveSettings(st: Store): void {
  writeJson(st.paths.settings, st.settings);
  applySettings(st);
}

export function publicSettings(s: StoredSettings): Settings {
  return {
    rpcUrl: s.rpcUrl,
    sendRpcUrl: s.sendRpcUrl,
    hasPumpportalKey: !!s.pumpportalKey.trim(),
    hasHeliusKey: !!s.heliusKey.trim(),
    jitoEnabled: s.jitoEnabled,
    slippageBps: s.slippageBps,
    cuPrice: s.cuPrice,
    tipSol: s.tipSol,
    presets: s.presets,
    keybinds: s.keybinds,
    theme: "light",
  };
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
