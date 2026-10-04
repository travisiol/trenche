"use client";
/** Shared polled resources (navbar + pages read the same snapshots). */
import { createResource, useResource } from "./api";
import type { BalancesResponse, SettingsResponseLike, SolPriceResponse, VaultStatus, WalletsResponse } from "./ui-types";

export const vaultRes = createResource<VaultStatus>("/api/vault", 5000);
export const walletsRes = createResource<WalletsResponse>("/api/wallets", 10000);
export const balancesRes = createResource<BalancesResponse>("/api/balances", 5000);
export const solPriceRes = createResource<SolPriceResponse>("/api/sol-price", 30000);
export const settingsRes = createResource<SettingsResponseLike>("/api/settings", 0);

export const useVault = () => useResource(vaultRes);
export const useWallets = () => useResource(walletsRes);
export const useBalances = () => useResource(balancesRes);
export const useSolPrice = () => useResource(solPriceRes);
export const useSettings = () => useResource(settingsRes);

/** Refresh everything that depends on the keystore after lock / unlock / create. */
export function refreshVaultDependents() {
  vaultRes.refresh();
  walletsRes.refresh();
  balancesRes.refresh();
}

/** Quick-buy presets P1..P3 (SOL) — settings first, localStorage override, brief defaults last. */
export const DEFAULT_PRESETS: [string, string, string] = ["0.1", "0.5", "1"];
const PRESET_KEY = "trench.presets";
export function readLocalPresets(): [string, string, string] | null {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length === 3 ? (arr.map(String) as [string, string, string]) : null;
  } catch {
    return null;
  }
}
export function writeLocalPresets(p: [string, string, string]) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
