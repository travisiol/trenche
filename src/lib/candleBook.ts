/* Client-side candle book of one mint × timeframe: server candles for the history, live trades for the present.
 * - base = GET /candles (trade-derived ≤ 1m, pump.fun ≥ 5m), refreshed slowly;
 * - live = every trade the stream delivered; from `liveStart` on, buckets are rebuilt from those trades, so a new
 *   trade moves the chart the moment it is received, with no candle round-trip and no double counting;
 * - a snapshot batch that shares nothing with what we hold = a hole (> N trades between two polls): the live trades
 *   restart from that batch and the base (refetched) covers what came before.
 * Output = a diff the chart can apply bar by bar (update) instead of a setData of everything (flicker, lost zoom). */
import type { Candle, ChartMark, TokenTrade } from "./types";

type LiveTrade = { t: number; slot: number; price: number; sol: number; side: "buy" | "sell"; wallet: string; key: string };
export type BookDiff = { kind: "reset"; candles: Candle[] } | { kind: "update"; bars: Candle[] } | { kind: "none" };

const MAX_LIVE = 4000;
const keyOf = (t: { signature: string; wallet: string; side: string }) => `${t.signature}:${t.wallet}:${t.side}`;

export class CandleBook {
  readonly sec: number;
  private base: Candle[] = [];
  private live = new Map<string, LiveTrade>();
  private out: Candle[] = [];
  /** set once a hole was seen: older live trades are no longer trusted to be contiguous */
  private holeFloor = 0;
  baseLoaded = false;

  constructor(sec: number) {
    this.sec = sec;
  }

  candles(): Candle[] {
    return this.out;
  }

  /** last trades received, newest first (markers of our own trades, last price) */
  liveTrades(): LiveTrade[] {
    return [...this.live.values()].sort((a, b) => b.t - a.t || b.slot - a.slot);
  }

  setBase(rows: Candle[]): BookDiff {
    this.base = rows;
    this.baseLoaded = true;
    return this.rebuild();
  }

  /** diff "none" when nothing new arrived; hole = the caller should refetch the server candles */
  addTrades(trades: TokenTrade[], snapshot: boolean): { diff: BookDiff; hole: boolean } {
    let added = 0;
    let known = 0;
    const fresh: LiveTrade[] = [];
    for (const t of trades) {
      const price = Number(t.priceSol);
      if (!(t.blockTime > 0) || !(price > 0) || !Number.isFinite(price)) continue;
      const key = keyOf(t);
      if (this.live.has(key)) {
        known++;
        continue;
      }
      fresh.push({ t: t.blockTime, slot: t.slot, price, sol: Number(t.solAmount) || 0, side: t.side, wallet: t.wallet, key });
    }
    // hole: a full snapshot with no overlap while we already held trades
    const hole = snapshot && this.live.size > 0 && known === 0 && trades.length >= 100;
    if (hole) {
      this.live.clear();
      this.holeFloor = Math.min(...fresh.map((x) => x.t));
    }
    for (const x of fresh) {
      if (x.t < this.holeFloor) continue;
      this.live.set(x.key, x);
      added++;
    }
    if (this.live.size > MAX_LIVE) {
      const keep = this.liveTrades().slice(0, MAX_LIVE);
      this.live = new Map(keep.map((x) => [x.key, x]));
    }
    if (!added && !hole) return { diff: { kind: "none" }, hole };
    return { diff: this.rebuild(), hole };
  }

  /** first bucket rebuilt from live trades: the oldest live bucket is partial unless the base cannot cover it */
  private liveStart(): number | null {
    if (!this.live.size) return null;
    let oldest = Infinity;
    for (const x of this.live.values()) oldest = Math.min(oldest, x.t);
    const b = Math.floor(oldest / this.sec) * this.sec;
    const lastBase = this.base[this.base.length - 1];
    return lastBase && lastBase.time >= b ? b + this.sec : b;
  }

  private rebuild(): BookDiff {
    const sec = this.sec;
    const start = this.liveStart();
    const next: Candle[] = [];
    for (const c of this.base) if (start === null || c.time < start) next.push({ ...c });
    if (start !== null) {
      const rows = [...this.live.values()].filter((x) => x.t >= start).sort((a, b) => a.t - b.t || a.slot - b.slot);
      for (const x of rows) {
        const bucket = Math.floor(x.t / sec) * sec;
        const last = next[next.length - 1];
        if (last && last.time === bucket) {
          last.high = Math.max(last.high, x.price);
          last.low = Math.min(last.low, x.price);
          last.close = x.price;
          last.volume += x.sol;
        } else {
          // continuous like Block X / pump.fun: a bucket opens at the previous close
          const open = last?.close ?? x.price;
          next.push({ time: bucket, open, high: Math.max(open, x.price), low: Math.min(open, x.price), close: x.price, volume: x.sol });
        }
      }
    }
    const prev = this.out;
    this.out = next;
    return diffCandles(prev, next);
  }
}

const same = (a: Candle, b: Candle) => a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;

/** bar-by-bar diff when `next` only changed a few bars / appended at the end; a reset otherwise */
export function diffCandles(prev: Candle[], next: Candle[]): BookDiff {
  if (!prev.length || !next.length) return prev.length || next.length ? { kind: "reset", candles: next } : { kind: "none" };
  // a removed or inserted bucket (anything that is not an append) shifts indexes → full reset
  if (next.length < prev.length) return { kind: "reset", candles: next };
  for (let i = 0; i < prev.length; i++) if (prev[i].time !== next[i].time) return { kind: "reset", candles: next };
  const bars: Candle[] = [];
  for (let i = 0; i < next.length; i++) if (i >= prev.length || !same(prev[i], next[i])) bars.push(next[i]);
  if (!bars.length) return { kind: "none" };
  if (bars.length > 50) return { kind: "reset", candles: next };
  return { kind: "update", bars };
}

/** our trades on the chart: one marker per bucket × side × dev/wallet, aggregated SOL in the tooltip text */
export function bucketMarks(marks: ChartMark[], sec: number): ChartMark[] {
  const m = new Map<string, ChartMark>();
  const seen = new Set<string>(); // the server's marks and the live stream overlap
  for (const x of marks) {
    const id = `${x.signature}:${x.wallet}:${x.side}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const time = Math.floor(x.time / sec) * sec;
    const k = `${time}:${x.side}:${x.dev ? 1 : 0}`;
    const have = m.get(k);
    if (have) have.solAmount = String((Number(have.solAmount) || 0) + (Number(x.solAmount) || 0));
    else m.set(k, { ...x, time });
  }
  return [...m.values()].sort((a, b) => a.time - b.time);
}
