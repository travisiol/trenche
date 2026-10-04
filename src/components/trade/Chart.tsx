"use client";
/** Candlestick chart (lightweight-charts v5) fed by GET /api/token/[mint]/candles?tf= and live trades. */
import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, createChart, type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/types";

export function CandleChart({ candles, live, height = 380, unitLabel }: { candles: Candle[]; live: Candle | null; height?: number; unitLabel?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vol = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#aab2c0", fontFamily: "var(--font-jetbrains), monospace", fontSize: 12, attributionLogo: false },
      grid: { vertLines: { color: "#1c2230" }, horzLines: { color: "#1c2230" } },
      rightPriceScale: { borderColor: "#1c2230", scaleMargins: { top: 0.08, bottom: 0.25 } },
      timeScale: { borderColor: "#1c2230", timeVisible: true, secondsVisible: true, rightOffset: 4 },
      crosshair: { vertLine: { color: "#3b82f6", labelBackgroundColor: "#3b82f6" }, horzLine: { color: "#3b82f6", labelBackgroundColor: "#3b82f6" } },
      localization: { priceFormatter: (p: number) => (p < 0.0001 ? p.toExponential(2) : p.toPrecision(4)) },
    });
    const s = c.addSeries(CandlestickSeries, { upColor: "#22c55e", downColor: "#ef4444", borderUpColor: "#22c55e", borderDownColor: "#ef4444", wickUpColor: "#22c55e", wickDownColor: "#ef4444", priceFormat: { type: "price", precision: 10, minMove: 1e-10 } });
    const v = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#3b82f655" });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    series.current = s;
    vol.current = v;
    const ro = new ResizeObserver(() => c.applyOptions({ width: el.current?.clientWidth ?? 0 }));
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.remove();
      chart.current = null;
      series.current = null;
      vol.current = null;
    };
  }, [height]);

  useEffect(() => {
    const s = series.current;
    const v = vol.current;
    if (!s || !v) return;
    const data: CandlestickData<Time>[] = candles.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close }));
    const vdata: HistogramData<Time>[] = candles.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "#22c55e55" : "#ef444455" }));
    s.setData(data);
    v.setData(vdata);
    chart.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    if (!live || !series.current || !vol.current) return;
    series.current.update({ time: live.time as UTCTimestamp, open: live.open, high: live.high, low: live.low, close: live.close });
    vol.current.update({ time: live.time as UTCTimestamp, value: live.volume, color: live.close >= live.open ? "#22c55e55" : "#ef444455" });
  }, [live]);

  return (
    <div className="relative">
      <div ref={el} style={{ height }} />
      {unitLabel ? <span className="absolute left-2 top-2 label pointer-events-none">{unitLabel}</span> : null}
    </div>
  );
}
