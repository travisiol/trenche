"use client";
/**
 * Pump.fun curve figures for the Launch Token modal ("3.42% supply") and the Bundle calculator table.
 * Read from GET /api/launch/calc?dev=<sol>&bundle=<sol,sol,…> (server constants of the active cluster); the local
 * fresh-curve formula fills the same numbers while the request is in flight or when the route is not served.
 */
import { useEffect, useState } from "react";
import { get, isApiFailure } from "@/lib/api";
import { sequentialSupplyPct } from "./model";

export type CalcRow = { sol: number; supplyPct: number; tokens: number };
export type LaunchCalc = {
  dev: CalcRow;
  bundle: CalcRow[];
  total: CalcRow;
  /** "server" = figures from /api/launch/calc, "local" = fresh-curve formula in the browser */
  source: "server" | "local";
};
/** GET /api/launch/calc response (server contract) */
export type LaunchCalcResponse = {
  dev?: { sol?: string | number; supplyPct?: number; tokens?: string | number };
  bundle?: { sol?: string | number; supplyPct?: number; tokens?: string | number }[];
  total?: { sol?: string | number; supplyPct?: number; tokens?: string | number };
  /** alternative flat shape: one row per buy in order (dev first) */
  rows?: { sol?: string | number; supplyPct?: number; tokens?: string | number }[];
};

let missing = false;

export function localCalc(devSol: number, bundleSols: number[]): LaunchCalc {
  const rows = sequentialSupplyPct([devSol, ...bundleSols]);
  const all = [devSol, ...bundleSols];
  const dev: CalcRow = { sol: devSol, supplyPct: rows[0]?.pct ?? 0, tokens: rows[0]?.tokens ?? 0 };
  const bundle: CalcRow[] = bundleSols.map((s, i) => ({ sol: s, supplyPct: rows[i + 1]?.pct ?? 0, tokens: rows[i + 1]?.tokens ?? 0 }));
  const total: CalcRow = { sol: all.reduce((n, s) => n + s, 0), supplyPct: rows.reduce((n, r) => n + r.pct, 0), tokens: rows.reduce((n, r) => n + r.tokens, 0) };
  return { dev, bundle, total, source: "local" };
}

function row(r: { sol?: string | number; supplyPct?: number; tokens?: string | number } | undefined, fallback: CalcRow): CalcRow {
  if (!r) return fallback;
  return { sol: Number(r.sol ?? fallback.sol) || 0, supplyPct: Number(r.supplyPct ?? fallback.supplyPct) || 0, tokens: Number(r.tokens ?? fallback.tokens) || 0 };
}

export async function fetchCalc(devSol: number, bundleSols: number[]): Promise<LaunchCalc> {
  const local = localCalc(devSol, bundleSols);
  if (missing) return local;
  try {
    const q = new URLSearchParams({ dev: String(devSol), bundle: bundleSols.join(",") });
    const r = await get<LaunchCalcResponse>(`/api/launch/calc?${q}`);
    if (r.rows?.length) {
      const [d, ...b] = r.rows;
      const dev = row(d, local.dev);
      const bundle = b.map((x, i) => row(x, local.bundle[i] ?? { sol: 0, supplyPct: 0, tokens: 0 }));
      const total = row(r.total, { sol: dev.sol + bundle.reduce((n, x) => n + x.sol, 0), supplyPct: dev.supplyPct + bundle.reduce((n, x) => n + x.supplyPct, 0), tokens: dev.tokens + bundle.reduce((n, x) => n + x.tokens, 0) });
      return { dev, bundle, total, source: "server" };
    }
    const dev = row(r.dev, local.dev);
    const bundle = (r.bundle ?? []).map((x, i) => row(x, local.bundle[i] ?? { sol: 0, supplyPct: 0, tokens: 0 }));
    const total = row(r.total, { sol: dev.sol + bundle.reduce((n, x) => n + x.sol, 0), supplyPct: dev.supplyPct + bundle.reduce((n, x) => n + x.supplyPct, 0), tokens: dev.tokens + bundle.reduce((n, x) => n + x.tokens, 0) });
    return { dev, bundle: bundle.length ? bundle : local.bundle, total, source: "server" };
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
