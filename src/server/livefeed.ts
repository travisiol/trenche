/* Live trade feed per open mint: ONE logsSubscribe (mentions = the bonding curve) per watched mint on one WebSocket
 * to the read RPC (Helius wss on the same key), every trade parsed the moment its transaction is confirmed and pushed
 * to the browsers watching it (SSE /api/token/[mint]/live). Block X shows a trade ~1 s after it lands; polling
 * pump.fun (budgeted 12/min) + getSignaturesForAddress every 2 s showed it 2–10 s late.
 *
 *  - parsing: the notification carries the logs, so a trade costs NO RPC call — pump.fun's "Program data:" events
 *    decode in place. A log list cut by the 10 KB budget ("Log truncated": a create + dev buy + inline bundle buys)
 *    falls back to getTransaction + parseTxEvents (emit_cpi inner instructions, never truncated);
 *  - `confirmed`, not `processed`: a processed row can still be dropped with its fork, and a ghost trade would stay in
 *    the list and in the PnL — confirmed costs ~0.4 s more and is final for our purpose;
 *  - lifetime: the subscription opens with the first watcher and is released 30 s after the last one leaves (a page
 *    reload keeps it); the socket closes with the last subscription. A dropped socket reconnects with back-off and
 *    re-subscribes; trades landed during the gap are still read by the 2 s polling (chain merge in token.ts), which
 *    stays the fallback whenever this feed is down;
 *  - the recent trades are kept (ring of 300) and merged into tradesOf(), so the polled list, the stats and the short
 *    candles have a trade as soon as the feed does. */
import { PublicKey } from "@solana/web3.js";
import { bondingCurvePda } from "@/engine/solana/pump/pdas.js";
import { getTransactionAnyVersion, parseEventLogs, parseTxEvents } from "@/engine/solana/pump/events.js";
import type { LiveStatus, LiveTrade } from "@/lib/liveTypes";
import { readConn } from "./engine";
import { wsUrlOf } from "./sigsub";
import { store } from "./store";

type Listener = { trades: (t: LiveTrade[]) => void; status: (s: LiveStatus) => void };
type Watch = {
  mint: string;
  curve: string;
  subId: number | null;
  reqId: number | null;
  ring: LiveTrade[];
  keys: Set<string>;
  listeners: Set<Listener>;
  release: ReturnType<typeof setTimeout> | null;
  /** latency samples: seenAt − blockTime·1000 (blockTime has 1 s resolution) */
  lat: number[];
  notes: number;
  fetched: number;
};
type FeedGlobal = {
  url: string | null;
  ws: WebSocket | null;
  status: LiveStatus;
  nextId: number;
  watches: Map<string, Watch>;
  bySub: Map<number, Watch>;
  byReq: Map<number, Watch>;
  retryMs: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  keepalive: ReturnType<typeof setInterval> | null;
  connects: number;
};
declare global {
  var __trenchLiveFeed: FeedGlobal | undefined;
}
function g(): FeedGlobal {
  if (!globalThis.__trenchLiveFeed)
    globalThis.__trenchLiveFeed = { url: null, ws: null, status: "connecting", nextId: 1, watches: new Map(), bySub: new Map(), byReq: new Map(), retryMs: 1000, retryTimer: null, keepalive: null, connects: 0 };
  return globalThis.__trenchLiveFeed;
}

const RING = 300;
const RELEASE_MS = 30_000;
const keyOf = (t: { signature: string; wallet: string; side: string }) => `${t.signature}:${t.wallet}:${t.side}`;

function setStatus(s: LiveStatus): void {
  const f = g();
  if (f.status === s) return;
  f.status = s;
  for (const w of f.watches.values()) for (const l of w.listeners) l.status(s);
}

function send(msg: object): boolean {
  const ws = g().ws;
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

function subscribeWatch(w: Watch): void {
  const f = g();
  if (w.subId !== null || w.reqId !== null) return;
  const id = f.nextId++;
  if (!send({ jsonrpc: "2.0", id, method: "logsSubscribe", params: [{ mentions: [w.curve] }, { commitment: "confirmed" }] })) return;
  w.reqId = id;
  f.byReq.set(id, w);
}

function unsubscribeWatch(w: Watch): void {
  const f = g();
  if (w.subId !== null) {
    f.bySub.delete(w.subId);
    send({ jsonrpc: "2.0", id: f.nextId++, method: "logsUnsubscribe", params: [w.subId] });
  }
  if (w.reqId !== null) f.byReq.delete(w.reqId);
  w.subId = null;
  w.reqId = null;
}

function closeSocket(): void {
  const f = g();
  if (f.keepalive) clearInterval(f.keepalive);
  f.keepalive = null;
  const ws = f.ws;
  f.ws = null;
  if (ws)
    try {
      ws.close();
    } catch {
      /* already closed */
    }
}

function scheduleReconnect(): void {
  const f = g();
  if (f.retryTimer || !f.watches.size) return;
  f.retryTimer = setTimeout(() => {
    f.retryTimer = null;
    connect();
  }, f.retryMs);
  f.retryMs = Math.min(15_000, f.retryMs * 2);
}

function connect(): void {
  const f = g();
  const url = wsUrlOf(store().sol.config.rpcUrl);
  if (!url || typeof WebSocket === "undefined") return setStatus("down");
  if (f.ws && f.url === url && f.ws.readyState <= 1) return;
  closeSocket();
  f.url = url;
  setStatus("connecting");
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    setStatus("down");
    return scheduleReconnect();
  }
  f.ws = ws;
  f.connects++;
  ws.onopen = () => {
    if (f.ws !== ws) return;
    f.retryMs = 1000;
    for (const w of f.watches.values()) {
      w.subId = null;
      w.reqId = null;
      subscribeWatch(w);
    }
    // Helius closes a socket that stays silent ~10 min (a quiet coin): a cheap request every 30 s keeps it open
    f.keepalive = setInterval(() => send({ jsonrpc: "2.0", id: f.nextId++, method: "getHealth" }), 30_000);
  };
  ws.onclose = () => {
    if (f.ws !== ws) return;
    f.ws = null;
    if (f.keepalive) clearInterval(f.keepalive);
    f.keepalive = null;
    f.bySub.clear();
    f.byReq.clear();
    for (const w of f.watches.values()) {
      w.subId = null;
      w.reqId = null;
    }
    setStatus("down");
    scheduleReconnect();
  };
  ws.onerror = () => {
    /* onclose follows */
  };
  ws.onmessage = (ev: MessageEvent) => {
    let msg: { id?: number; result?: unknown; method?: string; params?: { subscription?: number; result?: { context?: { slot?: number }; value?: { signature?: string; err?: unknown; logs?: string[] } } } };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString("utf8"));
    } catch {
      return;
    }
    if (typeof msg.id === "number" && f.byReq.has(msg.id)) {
      const w = f.byReq.get(msg.id)!;
      f.byReq.delete(msg.id);
      w.reqId = null;
      if (typeof msg.result === "number") {
        w.subId = msg.result;
        f.bySub.set(msg.result, w);
        if (f.watches.get(w.mint) !== w) unsubscribeWatch(w); // released while the answer was on its way
        else setStatus("live");
      }
      return;
    }
    if (msg.method !== "logsNotification" || typeof msg.params?.subscription !== "number") return;
    const w = f.bySub.get(msg.params.subscription);
    const v = msg.params.result?.value;
    if (!w || !v?.signature || v.err) return;
    w.notes++;
    onLogs(w, v.signature, msg.params.result?.context?.slot ?? 0, v.logs ?? []);
  };
}

type TradeEv = { kind: "trade"; mint: PublicKey; solAmount: bigint; tokenAmount: bigint; isBuy: boolean; user: PublicKey; timestamp: bigint; virtualSolReserves: bigint; virtualTokenReserves: bigint; realTokenReserves: bigint; fee: bigint; creator: PublicKey; creatorFee: bigint; cashback?: bigint };
const sol9 = (n: bigint) => (Number(n) / 1e9).toString();

function rowsOf(w: Watch, sig: string, slot: number, events: { kind: string }[]): LiveTrade[] {
  const now = Date.now();
  const out: LiveTrade[] = [];
  for (const e of events) {
    if (e.kind !== "trade") continue;
    const t = e as TradeEv;
    if (t.mint.toBase58() !== w.mint) continue;
    const solN = Number(t.solAmount) / 1e9;
    const tok = Number(t.tokenAmount) / 1e6;
    const extra = t.fee + t.creatorFee + (t.cashback ?? BigInt(0));
    out.push({
      side: t.isBuy ? "buy" : "sell",
      wallet: t.user.toBase58(),
      solAmount: String(solN),
      priceSol: String(tok > 0 ? solN / tok : 0),
      blockTime: Number(t.timestamp),
      slot,
      signature: sig,
      tokens: String(tok),
      walletSol: sol9(t.isBuy ? t.solAmount + extra : t.solAmount - extra),
      creator: t.creator.toBase58(),
      creatorFeeSol: sol9(t.creatorFee),
      vSol: t.virtualSolReserves.toString(),
      vTok: t.virtualTokenReserves.toString(),
      realTok: t.realTokenReserves.toString(),
      seenAt: now,
    });
  }
  return out;
}

function publish(w: Watch, rows: LiveTrade[]): void {
  const fresh = rows.filter((r) => !w.keys.has(keyOf(r)));
  if (!fresh.length) return;
  for (const r of fresh) {
    w.keys.add(keyOf(r));
    if (r.blockTime > 0) w.lat.push(r.seenAt - r.blockTime * 1000);
  }
  if (w.lat.length > 500) w.lat.splice(0, w.lat.length - 500);
  w.ring = [...fresh.reverse(), ...w.ring];
  if (w.ring.length > RING) {
    for (const r of w.ring.slice(RING)) w.keys.delete(keyOf(r));
    w.ring = w.ring.slice(0, RING);
  }
  for (const l of w.listeners) l.trades(fresh);
}

function onLogs(w: Watch, sig: string, slot: number, logs: string[]): void {
  const truncated = logs.some((l) => /Log truncated/i.test(l));
  if (!truncated) {
    const rows = rowsOf(w, sig, slot, parseEventLogs(logs));
    if (rows.length) return publish(w, rows);
    // no trade event and complete logs: not a trade (curve rent top-up, migration, a failed inner call…)
    if (!logs.some((l) => l.includes("Program data:"))) return;
  }
  // logs cut by the 10 KB budget: the transaction's inner instructions hold every event (emit_cpi)
  void (async () => {
    for (const wait of [0, 400, 1200, 3000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const tx = await getTransactionAnyVersion(readConn(), sig).catch(() => null); // v1 transactions included
      if (!tx?.meta) continue;
      w.fetched++;
      const rows = rowsOf(w, sig, tx.slot ?? slot, parseTxEvents(tx));
      if (rows.length) publish(w, rows);
      return;
    }
  })();
}

/** watch `mint`'s trades: `trades` gets every new batch (one transaction), `status` the socket state */
export function watchMint(mint: string, l: Listener): () => void {
  const f = g();
  let w = f.watches.get(mint);
  if (!w) {
    w = { mint, curve: bondingCurvePda(new PublicKey(mint)).toBase58(), subId: null, reqId: null, ring: [], keys: new Set(), listeners: new Set(), release: null, lat: [], notes: 0, fetched: 0 };
    f.watches.set(mint, w);
  }
  if (w.release) clearTimeout(w.release);
  w.release = null;
  w.listeners.add(l);
  if (f.ws && f.ws.readyState === 1) subscribeWatch(w);
  else connect();
  const watch = w;
  return () => {
    watch.listeners.delete(l);
    if (watch.listeners.size || watch.release) return;
    watch.release = setTimeout(() => {
      watch.release = null;
      if (watch.listeners.size || f.watches.get(mint) !== watch) return;
      unsubscribeWatch(watch);
      f.watches.delete(mint);
      if (!f.watches.size) {
        if (f.retryTimer) clearTimeout(f.retryTimer);
        f.retryTimer = null;
        closeSocket();
        f.status = "connecting";
      }
    }, RELEASE_MS);
  };
}

export function liveStatus(): LiveStatus {
  return g().status;
}

/** the feed's recent trades of `mint`, newest first (empty when nobody watches it) */
export function liveTrades(mint: string): LiveTrade[] {
  return g().watches.get(mint)?.ring ?? [];
}

export function liveHealth(mint?: string): object {
  const f = g();
  const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
  return {
    status: f.status,
    connects: f.connects,
    watches: [...f.watches.values()]
      .filter((w) => !mint || w.mint === mint)
      .map((w) => ({ mint: w.mint, subscribed: w.subId !== null, listeners: w.listeners.size, notifications: w.notes, trades: w.ring.length, txFetches: w.fetched, latencyMs: { samples: w.lat.length, p50: pct(w.lat, 0.5), p90: pct(w.lat, 0.9) } })),
  };
}
