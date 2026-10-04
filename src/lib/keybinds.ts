"use client";
/** Block X keybinds (Settings → Keybinds, BEHAVIOUR.md §9): the launch-task shortcuts, all unbound by default,
 *  user-assignable, stored on this machine (localStorage). The launch workspace listens to them. */
import { useSyncExternalStore } from "react";

export type KeybindId = "dumpAll" | "devSell100" | "devSellCustom" | "buy1Toggle" | "buy1Stop" | "buy2Toggle" | "buy2Stop" | "buy3Toggle" | "buy3Stop" | "vol1Toggle" | "vol1Stop" | "vol2Toggle" | "vol2Stop" | "vol3Toggle" | "vol3Stop";

export type KeybindDef = { id: KeybindId; section: "Launch" | "Dev Task" | "Buy Tasks" | "Volume Tasks"; title: string; desc: string };
const ord = ["1st", "2nd", "3rd"];
export const KEYBINDS: KeybindDef[] = [
  { id: "dumpAll", section: "Launch", title: "Dump All", desc: "Sell 100% of the launch token from every project wallet" },
  { id: "devSell100", section: "Dev Task", title: "Dev — Sell 100%", desc: "Sell 100% of the launch token from the developer wallet" },
  { id: "devSellCustom", section: "Dev Task", title: "Dev — Sell custom %", desc: "Sell the custom % set below from the developer wallet" },
  ...([1, 2, 3] as const).flatMap((n): KeybindDef[] => [
    { id: `buy${n}Toggle` as KeybindId, section: "Buy Tasks", title: `Buy Task ${n} — Start / Pause`, desc: `Toggle Start/Pause/Resume for the ${ord[n - 1]} buy task in the Tasks panel` },
    { id: `buy${n}Stop` as KeybindId, section: "Buy Tasks", title: `Buy Task ${n} — Stop`, desc: `Stop the ${ord[n - 1]} buy task in the Tasks panel` },
  ]),
  ...([1, 2, 3] as const).flatMap((n): KeybindDef[] => [
    { id: `vol${n}Toggle` as KeybindId, section: "Volume Tasks", title: `Volume Task ${n} — Start / Pause`, desc: `Toggle Start/Pause/Resume for the ${ord[n - 1]} volume task in the Tasks panel` },
    { id: `vol${n}Stop` as KeybindId, section: "Volume Tasks", title: `Volume Task ${n} — Stop`, desc: `Stop the ${ord[n - 1]} volume task in the Tasks panel` },
  ]),
];

export type KeybindState = {
  enabled: boolean;
  /** "" = None; otherwise a combo like "ctrl+shift+d" */
  keys: Record<KeybindId, string>;
  /** Dev — Sell custom % */
  customSellPct: number;
};
export const KEYBIND_DEFAULTS: KeybindState = { enabled: true, keys: Object.fromEntries(KEYBINDS.map((k) => [k.id, ""])) as Record<KeybindId, string>, customSellPct: 50 };

const KEY = "donchain.keybinds";
const listeners = new Set<() => void>();
let cache: KeybindState | null = null;

function read(): KeybindState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const d = raw ? (JSON.parse(raw) as Partial<KeybindState>) : {};
    cache = { ...KEYBIND_DEFAULTS, ...d, keys: { ...KEYBIND_DEFAULTS.keys, ...(d.keys ?? {}) } };
  } catch {
    cache = KEYBIND_DEFAULTS;
  }
  return cache;
}
export function writeKeybinds(next: KeybindState) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}
export function useKeybinds(): [KeybindState, (next: KeybindState) => void] {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    read,
    () => KEYBIND_DEFAULTS,
  );
  return [s, writeKeybinds];
}

/** "ctrl+shift+d" from a keyboard event, or null for a lone modifier. */
export function comboOf(e: KeyboardEvent): string | null {
  const k = e.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(k)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.metaKey) parts.push("meta");
  parts.push(k === " " ? "space" : k);
  return parts.join("+");
}
export function comboLabel(c: string): string {
  if (!c) return "None";
  return c
    .split("+")
    .map((p) => (p === "ctrl" ? "Ctrl" : p === "alt" ? "Alt" : p === "shift" ? "Shift" : p === "meta" ? "Meta" : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(" + ");
}

const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

/** Listens for the bound combos (ignored while typing, or when shortcuts are disabled) and calls `onAction`. */
export function listenKeybinds(onAction: (id: KeybindId) => void): () => void {
  const handler = (e: KeyboardEvent) => {
    const s = read();
    if (!s.enabled || typing(e.target)) return;
    const c = comboOf(e);
    if (!c) return;
    const hit = (Object.keys(s.keys) as KeybindId[]).find((id) => s.keys[id] && s.keys[id] === c);
    if (!hit) return;
    e.preventDefault();
    onAction(hit);
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
