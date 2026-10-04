"use client";
/** Candlestick chart (lightweight-charts v5) fed by GET /api/token/[mint]/candles?tf= (+ optional live candle).
 *  - price scale: SOL per token in Block X style (2.8e-8) or market cap in USD ($3.4K) via `mode`;
 *  - volume histogram (SOL) on its own scale at the bottom, last-price line, auto-fit on the first load / when the
 *    series changes (`fitKey`), then the user's zoom and scroll are kept; a chart sitting at the right edge follows
 *    new candles. Data is sorted, de-duplicated and cleaned here too (lightweight-charts throws on unsorted times). */
import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, createChart, type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/types";

export type ChartMode = "price" | "mc";

/** Block X price label: 2.8e-8 for tiny SOL prices, 0.0123 above, $3.4K / $1.2M in market-cap mode */
export function formatChartPrice(p: number, mode: ChartMode): string {
  if (!Number.isFinite(p)) return "";
  if (mode === "mc") {
    const abs = Math.abs(p);
    if (abs >= 1e9) return `$${(p / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(p / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(p / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
    return `$${p.toFixed(abs < 10 ? 2 : 0)}`;
  }
  if (p === 0) return "0";
  if (Math.abs(p) < 1e-3) return p.toExponential(2).replace("e-", "e-").replace(/\.?0+e/, "e");
  return p.toPrecision(4);
}

/** sort + merge duplicate buckets + drop non-finite rows (the server does it too; the MC multiply can re-break it) */
function clean(candles: Candle[]): Candle[] {
  const ok = candles.filter((c) => Number.isFinite(c.time) && [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0));
  ok.sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  for (const c of ok) {
    const last = out[out.length - 1];
    if (last && last.time === c.time) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else out.push({ ...c });
  }
  return out;
}

export function CandleChart({
  candles,
  live,
  height = 380,
  unitLabel,
  mode = "price",
  fitKey = "",
  fill = false,
}: {
  candles: Candle[];
  live: Candle | null;
  height?: number;
  unitLabel?: string;
  mode?: ChartMode;
  /** changes → auto-fit again (mint / timeframe / mode); otherwise the user's zoom is kept */
  fitKey?: string;
  /** fill the parent (height follows the container) */
  fill?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vol = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fitted = useRef<string | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!el.current) return;
    const node = el.current;
    const c = createChart(node, {
      height: fill ? node.clientHeight || height : height,
      autoSize: fill,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#aab2c0", fontFamily: "var(--font-jetbrains), monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#1c2230" }, horzLines: { color: "#1c2230" } },
      rightPriceScale: { borderColor: "#1c2230", scaleMargins: { top: 0.08, bottom: 0.28 }, entireTextOnly: true },
      timeScale: { borderColor: "#1c2230", timeVisible: true, secondsVisible: true, rightOffset: 3, barSpacing: 7, minBarSpacing: 2 },
      crosshair: { vertLine: { color: "#3b82f6", labelBackgroundColor: "#3b82f6" }, horzLine: { color: "#3b82f6", labelBackgroundColor: "#3b82f6" } },
      localization: { priceFormatter: (p: number) => formatChartPrice(p, modeRef.current) },
      handleScroll: true,
      handleScale: true,
    });
    const s = c.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#3b82f6",
      priceLineWidth: 1,
      priceFormat: { type: "custom", formatter: (p: number) => formatChartPrice(p, modeRef.current), minMove: 1e-12 },
    });
    const v = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#3b82f655", lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    series.current = s;
    vol.current = v;
    fitted.current = null;
    const ro = fill ? null : new ResizeObserver(() => c.applyOptions({ width: node.clientWidth || 0 }));
    ro?.observe(node);
    return () => {
      ro?.disconnect();
      c.remove();
      chart.current = null;
      series.current = null;
      vol.current = null;
    };
  }, [height, fill]);

  useEffect(() => {
    const s = series.current;
    const v = vol.current;
    const c = chart.current;
    if (!s || !v || !c) return;
    const rows = clean(candles);
    // mc mode: the format changes but the scale's minMove must follow (1e-12 would make USD ticks unreadable)
    s.applyOptions({ priceFormat: { type: "custom", formatter: (p: number) => formatChartPrice(p, mode), minMove: mode === "mc" ? 0.01 : 1e-12 } });
    const ts = c.timeScale();
    const range = ts.getVisibleLogicalRange();
    const atRightEdge = !range || range.to >= rows.length - 1.5;
    const data: CandlestickData<Time>[] = rows.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close }));
    const vdata: HistogramData<Time>[] = rows.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "#22c55e55" : "#ef444455" }));
    s.setData(data);
    v.setData(vdata);
    const key = `${fitKey}|${mode}`;
    if (fitted.current !== key || rows.length <= 2) {
      fitted.current = key;
      // few candles: a fitContent() would stretch one bar across the whole pane — show a 40-bar window instead
      if (rows.length < 40) ts.setVisibleLogicalRange({ from: rows.length - 40, to: rows.length + 3 });
      else ts.fitContent();
    } else if (atRightEdge) ts.scrollToRealTime();
  }, [candles, mode, fitKey]);

  useEffect(() => {
    if (!live || !series.current || !vol.current) return;
    if (![live.open, live.high, live.low, live.close].every((x) => Number.isFinite(x) && x > 0)) return;
    series.current.update({ time: live.time as UTCTimestamp, open: live.open, high: live.high, low: live.low, close: live.close });
    vol.current.update({ time: live.time as UTCTimestamp, value: live.volume, color: live.close >= live.open ? "#22c55e55" : "#ef444455" });
  }, [live]);

  return (
    <div className={fill ? "relative h-full min-h-0 w-full" : "relative"}>
      <div ref={el} style={fill ? { position: "absolute", inset: 0 } : { height }} />
      {unitLabel ? <span className="label pointer-events-none absolute left-2 top-2">{unitLabel}</span> : null}
    </div>
  );
}
