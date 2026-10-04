"use client";
/**
 * Pump.fun curve figures for the Launch Token modal ("3.42% supply") and the Bundle calculator table.
 * GET /api/launch/calc?devBuySol=<sol>&buys=<sol,sol,…> (LaunchCalcResponse: server constants of the active cluster);
 * the local fresh-curve formula fills the same numbers while the request is in flight or when the route is not served.
 */
import { useEffect, useState } from "react";
import type { LaunchCalcResponse } from "@/lib/types";
import { get, isApiFailure } from "@/lib/api";
import { sequentialSupplyPct } from "./model";

export type CalcRow = { label: string; sol: number; supplyPct: number; tokens: number };
export type LaunchCalc = {
  dev: CalcRow;
  bundle: CalcRow[];
  total: CalcRow;
  marketCapSol: number | null;
  marketCapUsd: number | null;
  /** "server" = figures from /api/launch/calc, "local" = fresh-curve formula in the browser */
  source: "server" | "local";
};

let missing = false;

export function localCalc(devSol: number, bundleSols: number[]): LaunchCalc {
  const rows = sequentialSupplyPct([devSol, ...bundleSols]);
  const dev: CalcRow = { label: "Dev buy", sol: devSol, supplyPct: rows[0]?.pct ?? 0, tokens: rows[0]?.tokens ?? 0 };
  const bundle: CalcRow[] = bundleSols.map((s, i) => ({ label: `Buy ${i + 1}`, sol: s, supplyPct: rows[i + 1]?.pct ?? 0, tokens: rows[i + 1]?.tokens ?? 0 }));
  const total: CalcRow = { label: "Dev + bundle", sol: devSol + bundleSols.reduce((n, s) => n + s, 0), supplyPct: rows.reduce((n, r) => n + r.pct, 0), tokens: rows.reduce((n, r) => n + r.tokens, 0) };
  return { dev, bundle, total, marketCapSol: null, marketCapUsd: null, source: "local" };
}

export async function fetchCalc(devSol: number, bundleSols: number[]): Promise<LaunchCalc> {
  const local = localCalc(devSol, bundleSols);
  if (missing) return local;
  try {
    const q = new URLSearchParams({ devBuySol: String(devSol), buys: bundleSols.join(",") });
    const r = await get<LaunchCalcResponse>(`/api/launch/calc?${q}`);
    if (!Array.isArray(r.rows) || !r.rows.length) return local;
    const rows: CalcRow[] = r.rows.map((x, i) => ({ label: x.label ?? (i === 0 ? "Dev buy" : `Buy ${i}`), sol: Number(x.solIn) || 0, supplyPct: Number(x.supplyPct) || 0, tokens: Number(x.tokens) || 0 }));
    const [dev, ...bundle] = rows;
    const total: CalcRow = { label: "Dev + bundle", sol: Number(r.total?.solIn ?? local.total.sol) || 0, supplyPct: Number(r.total?.supplyPct ?? local.total.supplyPct) || 0, tokens: Number(r.total?.tokens ?? local.total.tokens) || 0 };
    return { dev, bundle, total, marketCapSol: r.marketCapSol ?? null, marketCapUsd: r.marketCapUsd ?? null, source: "server" };
  } catch (e) {
    if (isApiFailure(e) && (e.kind === "missing" || e.status === 404 || e.status === 405)) missing = true;
    return local;
  }
}

/** Debounced curve figures for a dev buy and the bundle buys (in order). */
export function useLaunchCalc(devSol: number, bundleSols: number[]): LaunchCalc {
  const key = `${devSol}|${bundleSols.join(",")}`;
  const [state, setState] = useState<{ key: string; calc: LaunchCalc }>(() => ({ key, calc: localCalc(devSol, bundleSols) }));
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchCalc(devSol, bundleSols).then((calc) => alive && setState({ key, calc }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key encodes devSol + bundleSols
  }, [key]);
  return state.key === key ? state.calc : localCalc(devSol, bundleSols);
}
