"use client";
/** Block X chart of one mint (lightweight-charts v5): toolbar 1s…1D + MC / Price, candles, volume, last-price line,
 *  our own trades (and the dev's) as markers.
 *  Data: CandleBook = server candles for the history + the trade stream (lib/tradeStream) for the present. A trade
 *  received moves its candle at once (series.update on the changed bars only: no setData, no flicker, zoom kept);
 *  the server candles are refetched slowly (15 s ≤ 1m, 30 s above) to repair history. The chart canvas exists as soon
 *  as a mint is given — a fresh coin shows "Waiting for the first trade" over an empty chart, then paints in place. */
import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { CANDLE_TFS, type Candle, type CandleTf, type ChartMark, type TokenCandlesResponse } from "@/lib/types";
import { api, failureMessage } from "@/lib/api";
import { CandleBook, bucketMarks, type BookDiff } from "@/lib/candleBook";
import { subscribeTrades } from "@/lib/tradeStream";
import { cx } from "@/components/bx/ui";

export type ChartMode = "price" | "mc";

const TF_SEC: Record<CandleTf, number> = { "1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1D": 86400 };

/** Block X price label: 2.8e-8 for tiny SOL prices, 0.0123 above, $3.4K / $1.2M in market-cap mode */
export function formatChartPrice(p: number, mode: ChartMode): string {
  if (!Number.isFinite(p)) return "";
  if (mode === "mc") {
    const abs = Math.abs(p);
    // two decimals on K/M: a narrow range ($3.40K → $3.52K) must not print the same label on every tick
    if (abs >= 1e9) return `$${(p / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(p / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(p / 1e3).toFixed(abs >= 1e5 ? 1 : 2)}K`;
    return `$${p.toFixed(abs < 10 ? 2 : 0)}`;
  }
  if (p === 0) return "0";
  if (Math.abs(p) < 1e-3) return p.toExponential(2).replace(/\.?0+e/, "e");
  return p.toPrecision(4);
}

/** Block X theme colors, read from the page's CSS variables (fallback = the values captured on blockx.gg) */
function themeColors() {
  const css = typeof window === "undefined" ? null : getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => css?.getPropertyValue(name).trim() || fb;
  // canvas text cannot resolve var(--font-…): the body's computed family (Geist, as on Block X)
  const font = typeof document === "undefined" ? "" : getComputedStyle(document.body).fontFamily;
  return { up: v("--increase", "#0052ff"), down: v("--decrease", "#f6465d"), text: v("--text-200", "#c8ccce"), line: v("--line-100", "#1f2024"), cross: v("--line-200", "#2a2b30"), font: font || "system-ui, sans-serif" };
}

/** #rrggbb + alpha → rgba() (lightweight-charts parses rgba; 8-digit hex is not portable across its versions) */
function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** local wall-clock time (lightweight-charts prints UTC by default; Block X shows the viewer's time) */
function localTime(t: number, withSec: boolean): string {
  const d = new Date(t * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${withSec ? `:${pad(d.getSeconds())}` : ""}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Status = { key: string; loaded: boolean; error: unknown; source: TokenCandlesResponse["source"] | null; count: number };

export function TokenChart({
  mint,
  solUsd,
  supplyTokens,
  mine,
  creator,
  className,
}: {
  mint: string;
  /** SOL/USD for the MC axis (null → price axis only) */
  solUsd: number | null;
  /** total supply in whole tokens (pump.fun: 1e9) */
  supplyTokens: number;
  /** our wallets: their trades from the live stream become markers (the server marks the history) */
  mine: Set<string>;
  creator?: string | null;
  className?: string;
}) {
  const [tf, setTf] = useState<CandleTf>("1s");
  const [modeSel, setModeSel] = useState<"MC" | "Price">("MC");
  const mode: ChartMode = modeSel === "MC" && solUsd ? "mc" : "price";
  const key = `${mint}|${tf}`;
  const [status, setStatus] = useState<Status>({ key: "", loaded: false, error: null, source: null, count: 0 });
  const cur = status.key === key ? status : { key, loaded: false, error: null, source: null, count: 0 };

  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleS = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volS = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const colors = useRef(themeColors());
  const book = useRef<CandleBook | null>(null);
  const serverMarks = useRef<ChartMark[]>([]);
  const markSig = useRef("");
  // MC multiplier (supply × SOL/USD) frozen until it moves > 0.5 %: a SOL tick must not re-set the whole series
  const mult = useRef(1);
  const modeRef = useRef<ChartMode>(mode);
  const fitted = useRef(false);
  const ownRef = useRef({ mine, creator: creator ?? null });
  useEffect(() => {
    ownRef.current = { mine, creator: creator ?? null };
  });

  // one chart for the component's life: timeframe / mint changes only swap its data
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const c = colors.current;
    const ch = createChart(node, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontFamily: c.font, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: alpha(c.line, 0.5) }, horzLines: { color: alpha(c.line, 0.5) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.22 }, entireTextOnly: true, minimumWidth: 58 },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 6,
        barSpacing: 9,
        minBarSpacing: 1.5,
        shiftVisibleRangeOnNewBar: true,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const t = Number(time);
          const d = new Date(t * 1000);
          if (type === TickMarkType.Year) return String(d.getFullYear());
          if (type === TickMarkType.Month) return MONTHS[d.getMonth()];
          if (type === TickMarkType.DayOfMonth) return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
          return localTime(t, type === TickMarkType.TimeWithSeconds);
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: alpha("#ffffff", 0.25), style: LineStyle.Dashed, labelBackgroundColor: c.cross },
        horzLine: { color: alpha("#ffffff", 0.25), style: LineStyle.Dashed, labelBackgroundColor: c.cross },
      },
      localization: {
        priceFormatter: (p: number) => formatChartPrice(p, modeRef.current),
        timeFormatter: (time: Time) => {
          const t = Number(time);
          const d = new Date(t * 1000);
          return `${d.getDate()} ${MONTHS[d.getMonth()]} ${localTime(t, true)}`;
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
    });
    const s = ch.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      borderVisible: false,
      wickUpColor: c.up,
      wickDownColor: c.down,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "", // follows the last bar (blue up / red down, as on Block X)
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
      priceFormat: { type: "custom", formatter: (p: number) => formatChartPrice(p, modeRef.current), minMove: 1e-12 },
    });
    const v = ch.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = ch;
    candleS.current = s;
    volS.current = v;
    markers.current = createSeriesMarkers(s, [], { autoScale: true });
    return () => {
      markers.current = null;
      ch.remove();
      chart.current = null;
      candleS.current = null;
      volS.current = null;
    };
  }, []);

  /** bar in display units (price or MC) */
  const bar = (k: Candle) => {
    const m = mult.current;
    return { time: k.time as UTCTimestamp, open: k.open * m, high: k.high * m, low: k.low * m, close: k.close * m };
  };
  const vbar = (k: Candle) => ({ time: k.time as UTCTimestamp, value: k.volume, color: alpha(k.close >= k.open ? colors.current.up : colors.current.down, 0.42) });

  const resetSeries = (rows: Candle[]) => {
    const s = candleS.current, v = volS.current, ch = chart.current;
    if (!s || !v || !ch) return;
    s.setData(rows.map(bar));
    v.setData(rows.map(vbar));
    if (!fitted.current && rows.length) {
      fitted.current = true;
      // Block X: a fixed bar width anchored on the newest bar (a fitContent() stretches 5 bars across the pane or
      // crushes 2 000 into hairlines); the user's zoom is kept after this first placement
      ch.timeScale().applyOptions({ barSpacing: 9 });
      ch.timeScale().scrollToRealTime();
    }
  };

  const apply = (d: BookDiff) => {
    const s = candleS.current, v = volS.current;
    if (!s || !v || d.kind === "none") return;
    if (d.kind === "reset") return resetSeries(d.candles);
    const last = s.data().length ? Number(s.data()[s.data().length - 1].time) : -Infinity;
    for (const k of d.bars) {
      const old = k.time < last; // a late trade on an older bar: historical update (slower, rare)
      s.update(bar(k), old);
      v.update(vbar(k), old);
    }
  };

  const refreshMarkers = () => {
    const b = book.current, mk = markers.current;
    if (!b || !mk) return;
    const { mine: own, creator: dev } = ownRef.current;
    const live: ChartMark[] = b
      .liveTrades()
      .filter((t) => own.has(t.wallet) || (!!dev && t.wallet === dev))
      .map((t) => ({ time: t.t, side: t.side, solAmount: String(t.sol), wallet: t.wallet, dev: !!dev && t.wallet === dev, signature: t.key.split(":")[0] }));
    const rows = bucketMarks([...serverMarks.current, ...live], b.sec);
    const sig = rows.map((r) => `${r.time}${r.side}${r.dev ? 1 : 0}`).join("|");
    if (sig === markSig.current) return;
    markSig.current = sig;
    const c = colors.current;
    const out: SeriesMarker<Time>[] = rows.map((r) => ({
      time: r.time as UTCTimestamp,
      position: r.side === "buy" ? "belowBar" : "aboveBar",
      shape: r.side === "buy" ? "arrowUp" : "arrowDown",
      color: r.dev ? "#f8b951" : r.side === "buy" ? c.up : c.down,
      // letters only: amounts on adjacent 1s bars piled into an unreadable column (the Activity list has them)
      text: `${r.dev ? "D" : ""}${r.side === "buy" ? "B" : "S"}`,
      size: 0.8,
    }));
    mk.setMarkers(out);
  };

  // data of (mint, tf): server history + live stream into one book
  useEffect(() => {
    const b = new CandleBook(TF_SEC[tf]);
    book.current = b;
    fitted.current = false;
    serverMarks.current = [];
    markSig.current = "";
    markers.current?.setMarkers([]);
    resetSeries([]);
    chart.current?.applyOptions({ timeScale: { secondsVisible: TF_SEC[tf] < 60, timeVisible: TF_SEC[tf] < 86400 } });
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight = false;
    const every = TF_SEC[tf] <= 60 ? 15_000 : 30_000;
    const loadBase = async () => {
      if (inflight) return;
      if (timer) clearTimeout(timer);
      inflight = true;
      try {
        if (typeof document !== "undefined" && document.visibilityState === "hidden" && b.baseLoaded) return;
        const r = await api<TokenCandlesResponse>(`/api/token/${mint}/candles?tf=${tf}`);
        if (!alive) return;
        serverMarks.current = r.marks ?? [];
        apply(b.setBase(r.candles));
        refreshMarkers();
        setStatus({ key, loaded: true, error: null, source: r.source, count: b.candles().length });
      } catch (e) {
        if (alive) setStatus((s) => ({ key, loaded: true, error: e, source: s.key === key ? s.source : null, count: b.candles().length }));
      } finally {
        inflight = false;
        if (alive) timer = setTimeout(loadBase, every);
      }
    };
    void loadBase();
    const off = subscribeTrades(mint, ({ trades, snapshot }) => {
      if (!alive) return;
      const { diff, hole } = b.addTrades(trades, snapshot);
      apply(diff);
      if (diff.kind !== "none") {
        refreshMarkers();
        // re-render only when the chart goes from empty to painted (not on every trade)
        const n = b.candles().length;
        setStatus((s) => (s.key === key && s.count > 0 === n > 0 ? s : { key, loaded: s.key === key ? s.loaded : false, error: null, source: s.key === key ? s.source : null, count: n }));
      }
      if (hole) void loadBase(); // trades were missed between two polls: the server's candles fill the gap
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply/resetSeries/refreshMarkers only read refs
  }, [mint, tf, key]);

  // MC ⇄ price, or the MC multiplier moved: same bars, new units
  useEffect(() => {
    const next = mode === "mc" && solUsd ? supplyTokens * solUsd : 1;
    const moved = Math.abs(next - mult.current) / Math.max(1e-9, mult.current) > 0.005;
    if (modeRef.current === mode && !moved) return;
    modeRef.current = mode;
    mult.current = next;
    candleS.current?.applyOptions({ priceFormat: { type: "custom", formatter: (p: number) => formatChartPrice(p, mode), minMove: mode === "mc" ? 0.01 : 1e-12 } });
    const b = book.current;
    if (b) resetSeries(b.candles());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetSeries only reads refs
  }, [mode, solUsd, supplyTokens]);

  // wallets list arrived / changed: markers of trades already received
  useEffect(() => {
    markSig.current = "";
    refreshMarkers();
  }, [mine, creator]);

  const seg = (on: boolean) => cx("h-5 rounded px-1.5 text-[10px] font-medium transition-colors", on ? "bg-bg-100 text-text-100" : "text-text-300 hover:text-text-100");
  const empty = cur.count === 0;
  return (
    <section className={cx("relative h-full min-h-0 w-full", className)} aria-label="Price chart">
      <div className="absolute left-2 top-2 z-10 flex flex-wrap items-center gap-1">
        <div className="inline-flex items-center rounded border border-line-100 bg-bg-50 p-px">
          {CANDLE_TFS.map((x) => (
            <button key={x} type="button" onClick={() => setTf(x)} className={seg(tf === x)}>
              {x}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center rounded border border-line-100 bg-bg-50 p-px">
          {(["MC", "Price"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setModeSel(m)} className={seg(modeSel === m)} title={m === "MC" && !solUsd ? "Market cap needs the SOL/USD price (loading)" : undefined}>
              {m}
            </button>
          ))}
        </div>
        {cur.source === "rpc" && !empty ? (
          <span className="rounded border border-yellow-100/40 bg-yellow-100/10 px-1.5 text-[10px] text-yellow-100" title="pump.fun did not answer: history built from the bonding-curve transactions read on the RPC">
            RPC
          </span>
        ) : null}
      </div>
      <div ref={el} className="absolute inset-0" />
      {empty ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
          {cur.error && cur.loaded ? (
            <p className="text-xs text-decrease">{failureMessage(cur.error)}</p>
          ) : cur.loaded ? (
            <>
              <p className="text-sm text-text-200">Waiting for the first trade</p>
              <p className="text-xs text-text-300">Candles appear the moment a trade lands on the curve.</p>
            </>
          ) : (
            <p className="text-xs text-text-300">Loading chart…</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
