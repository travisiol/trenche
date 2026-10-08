"use client";
/** Robinhood token chart (lightweight-charts v5): candles built from the curve's own trades (CurveBuy / CurveSell),
 *  market cap in USD (or ETH), your wallets' trades as markers. Redrawn only when a new trade arrives (zoom kept). */
import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { cx } from "@/components/bx/ui";
import type { RhTrade } from "./common";

const TFS = [
  { id: "1s", sec: 1 },
  { id: "5s", sec: 5 },
  { id: "15s", sec: 15 },
  { id: "1m", sec: 60 },
  { id: "5m", sec: 300 },
  { id: "15m", sec: 900 },
  { id: "1h", sec: 3600 },
] as const;

function colors() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
  return { up: v("--increase", "#0052ff"), down: v("--decrease", "#f6465d"), text: v("--text-200", "#c8ccce"), line: v("--line-100", "#1f2024"), font: getComputedStyle(document.body).fontFamily || "system-ui" };
}

const fmt = (p: number, usd: boolean) => {
  const a = Math.abs(p);
  const pre = usd ? "$" : "";
  if (a >= 1e6) return `${pre}${(p / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${pre}${(p / 1e3).toFixed(2)}K`;
  return `${pre}${p.toFixed(a < 10 ? 3 : 1)}`;
};

export function RhChart({ trades, ethUsd, mine, className }: { trades: RhTrade[]; ethUsd: number | null; mine: Set<string>; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vol = useRef<ISeriesApi<"Histogram"> | null>(null);
  const marks = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [tf, setTf] = useState<number>(5);
  const [unit, setUnit] = useState<"usd" | "eth">("usd");
  const usd = unit === "usd" && !!ethUsd;

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const c = colors();
    const ch = createChart(node, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontFamily: c.font, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(127,127,127,0.08)" }, horzLines: { color: "rgba(127,127,127,0.08)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true },
    });
    candles.current = ch.addSeries(CandlestickSeries, { upColor: c.up, downColor: c.down, borderVisible: false, wickUpColor: c.up, wickDownColor: c.down });
    vol.current = ch.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    marks.current = createSeriesMarkers(candles.current, []);
    chart.current = ch;
    return () => {
      ch.remove();
      chart.current = null;
    };
  }, []);

  const bars = useMemo(() => {
    const out = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
    let prev: number | null = null;
    for (const t of trades) {
      const tok = Number(t.tokens) / 1e18;
      const e = Number(t.eth) / 1e18;
      if (!(tok > 0) || !(e > 0)) continue;
      const mc = (e / tok) * 1e9 * (usd ? ethUsd! : 1);
      const k = Math.floor(t.ts / 1000 / tf) * tf;
      const b = out.get(k);
      if (!b) out.set(k, { o: prev ?? mc, h: Math.max(prev ?? mc, mc), l: Math.min(prev ?? mc, mc), c: mc, v: e });
      else {
        b.h = Math.max(b.h, mc);
        b.l = Math.min(b.l, mc);
        b.c = mc;
        b.v += e;
      }
      prev = mc;
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0]);
  }, [trades, tf, usd, ethUsd]);

  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    const c = colors();
    s.applyOptions({ priceFormat: { type: "custom", formatter: (p: number) => fmt(p, usd), minMove: 1e-6 } });
    s.setData(bars.map(([k, b]) => ({ time: k as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
    vol.current?.setData(bars.map(([k, b]) => ({ time: k as UTCTimestamp, value: b.v, color: b.c >= b.o ? "rgba(38,166,154,0.35)" : "rgba(239,83,80,0.35)" })));
    const m: SeriesMarker<Time>[] = trades
      .filter((t) => mine.has(t.wallet.toLowerCase()))
      .slice(-150)
      .map((t) => ({ time: (Math.floor(t.ts / 1000 / tf) * tf) as UTCTimestamp, position: t.side === "buy" ? "belowBar" : "aboveBar", color: t.side === "buy" ? c.up : c.down, shape: t.side === "buy" ? "arrowUp" : "arrowDown", text: t.side === "buy" ? "B" : "S" }));
    marks.current?.setMarkers(m.sort((a, b) => Number(a.time) - Number(b.time)));
  }, [bars, trades, mine, tf, usd]);

  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-line-50 px-3 py-1.5 text-xs">
        {TFS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTf(t.sec)} className={cx("rounded px-1.5 py-0.5 transition-colors", tf === t.sec ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100")}>
            {t.id}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-line-100" />
        <button type="button" onClick={() => setUnit((u) => (u === "usd" ? "eth" : "usd"))} className="rounded px-1.5 py-0.5 text-text-300 hover:text-text-100" title="Market cap in USD or ETH">
          MC {usd ? "USD" : "ETH"}
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={box} className="absolute inset-0" />
        {!bars.length ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-300">Waiting for the first trade…</div> : null}
      </div>
    </div>
  );
}
