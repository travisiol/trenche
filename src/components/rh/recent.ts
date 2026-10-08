"use client";
/** Robinhood mode: recently opened tokens (own list, never mixed with the Solana one) and the last chain used */
import { useSyncExternalStore } from "react";

export type RhRecent = { token: string; symbol: string; image: string | null };
const KEY = "donchain.rh.recent";
const CHAIN_KEY = "donchain.chain";
const listeners = new Set<() => void>();
let cache: { raw: string | null; list: RhRecent[] } = { raw: null, list: [] };

function read(): RhRecent[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* storage blocked */
  }
  if (raw === cache.raw) return cache.list;
  let list: RhRecent[] = [];
  try {
    list = raw ? (JSON.parse(raw) as RhRecent[]) : [];
  } catch {
    list = [];
  }
  cache = { raw, list };
  return list;
}

export function pushRhRecent(t: RhRecent): void {
  const next = [t, ...read().filter((x) => x.token.toLowerCase() !== t.token.toLowerCase())].slice(0, 12);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

export function clearRhRecent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

const EMPTY: RhRecent[] = [];
export function useRhRecent(): RhRecent[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMPTY,
  );
}

export type Chain = "solana" | "robinhood";
export const chainOfPath = (path: string): Chain => (path === "/rh" || path.startsWith("/rh/") ? "robinhood" : "solana");
export const chainHome = (c: Chain) => (c === "robinhood" ? "/rh/dashboard" : "/dashboard");

export function rememberChain(c: Chain): void {
  try {
    localStorage.setItem(CHAIN_KEY, c);
  } catch {
    /* storage blocked */
  }
}
export function lastChain(): Chain {
  try {
    return localStorage.getItem(CHAIN_KEY) === "robinhood" ? "robinhood" : "solana";
  } catch {
    return "solana";
  }
}
