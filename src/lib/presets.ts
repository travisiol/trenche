"use client";
/** Block X Trading Presets P1..P3 — read from GET /api/settings (tradingPresets), saved with POST /api/settings.
 *  The selected preset index is a per-machine UI preference (localStorage). */
import { useSyncExternalStore } from "react";
import { post } from "./api";
import { settingsRes, useSettings } from "./store";
import { TRADING_PRESET_DEFAULTS, type SettingsUpdateRequest, type TradingPreset, type TradingPresets } from "./types";

export type PresetIndex = 0 | 1 | 2;

export function useTradingPresets(): { presets: TradingPresets; loaded: boolean } {
  const settings = useSettings();
  const tp = settings.data?.tradingPresets;
  return { presets: Array.isArray(tp) && tp.length === 3 ? tp : TRADING_PRESET_DEFAULTS, loaded: !!settings.data };
}

export async function saveTradingPresets(next: TradingPresets): Promise<void> {
  const body: SettingsUpdateRequest = { tradingPresets: next };
  await post("/api/settings", body);
  await settingsRes.refresh();
}

const KEY = "donchain.preset.index";
const listeners = new Set<() => void>();
let cached: PresetIndex | null = null;
function read(): PresetIndex {
  if (cached !== null) return cached;
  try {
    const v = Number(localStorage.getItem(KEY));
    cached = v === 1 || v === 2 ? v : 0;
  } catch {
    cached = 0;
  }
  return cached;
}
export function setPresetIndex(i: PresetIndex) {
  cached = i;
  try {
    localStorage.setItem(KEY, String(i));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}
/** The P1/P2/P3 choice shared by the Tasks panel, the order rail, Instant Trade and the quick-buy chips. */
export function usePresetIndex(): [PresetIndex, (i: PresetIndex) => void] {
  const i = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    read,
    () => 0 as PresetIndex,
  );
  return [i, setPresetIndex];
}

export function presetLabel(i: PresetIndex) {
  return `P${i + 1}`;
}
export const EMPTY_PRESET: TradingPreset = TRADING_PRESET_DEFAULTS[0];
