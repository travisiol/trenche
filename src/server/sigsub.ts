/* Signature confirmation over the read RPC's WebSocket (signatureSubscribe), one multiplexed socket per URL.
 *
 * Each sent transaction gets two subscriptions on the same socket: `processed` (the leader executed it — the UI
 * flips the row to "landed" ~0.4–0.8 s after the send) and `confirmed` (supermajority vote — the job step settles).
 * A notification removes its subscription server-side, so nothing has to be cleaned up on success.
 *
 * Every function answers `null` when the socket is unavailable (no WebSocket in the runtime, the provider refuses
 * the upgrade, a close mid-flight, 90 s without notification): callers keep the coalesced getSignatureStatuses
 * polling of engine/solana/send.js as the fallback, so a dead socket only costs latency, never a lost result.
 * Provider URLs: https://mainnet.helius-rpc.com/?api-key=… → wss://mainnet.helius-rpc.com/?api-key=… (same key),
 * publicnode https → wss on the same host. */
import { simResult, simulateSends } from "./sender";

export type SigEvent = { err: unknown; at: number; simulated?: boolean };
type Commitment = "processed" | "confirmed";
type Resolver = (v: SigEvent | null) => void;

type Sock = {
  url: string;
  ws: WebSocket | null;
  opening: Promise<boolean> | null;
  nextId: number;
  /** request id → subscription callback (until the server answers the subscription id) */
  pending: Map<number, { resolve: Resolver; sig: string }>;
  /** subscription id → callback */
  subs: Map<number, Resolver>;
  deadUntil: number;
  lastUse: number;
  idle: ReturnType<typeof setInterval> | null;
};
type SubGlobal = { socks: Map<string, Sock>; notifications: number; lastMs: number | null; failures: number };
declare global {
  var __trenchSigsub: SubGlobal | undefined;
}
function g(): SubGlobal {
  if (!globalThis.__trenchSigsub) globalThis.__trenchSigsub = { socks: new Map(), notifications: 0, lastMs: null, failures: 0 };
  return globalThis.__trenchSigsub;
}

export function wsUrlOf(httpUrl: string): string | null {
  if (!/^https?:\/\//i.test(httpUrl)) return null;
  return httpUrl.replace(/^http/i, "ws");
}

function sockOf(url: string): Sock {
  const s = g();
  let k = s.socks.get(url);
  if (!k) {
    k = { url, ws: null, opening: null, nextId: 1, pending: new Map(), subs: new Map(), deadUntil: 0, lastUse: Date.now(), idle: null };
    s.socks.set(url, k);
  }
  return k;
}

function failAll(k: Sock): void {
  for (const p of k.pending.values()) p.resolve(null);
  for (const r of k.subs.values()) r(null);
  k.pending.clear();
  k.subs.clear();
}

function open(k: Sock): Promise<boolean> {
  if (k.ws && k.ws.readyState === 1) return Promise.resolve(true);
  if (k.opening) return k.opening;
  if (Date.now() < k.deadUntil || typeof WebSocket === "undefined") return Promise.resolve(false);
  k.opening = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      k.opening = null;
      resolve(ok);
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(k.url);
    } catch {
      k.deadUntil = Date.now() + 30_000;
      g().failures++;
      return done(false);
    }
    const timer = setTimeout(() => {
      k.deadUntil = Date.now() + 10_000;
      g().failures++;
      try {
        ws.close();
      } catch {
        /* closing a socket that never opened */
      }
      done(false);
    }, 4000);
    ws.onopen = () => {
      clearTimeout(timer);
      k.ws = ws;
      done(true);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      g().failures++;
      k.deadUntil = Date.now() + 5000;
      done(false);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (k.ws === ws) k.ws = null;
      failAll(k);
      done(false);
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: { id?: number; result?: unknown; error?: unknown; method?: string; params?: { subscription?: number; result?: { value?: { err?: unknown } | string } } };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString("utf8"));
      } catch {
        return;
      }
      if (typeof msg.id === "number" && k.pending.has(msg.id)) {
        const p = k.pending.get(msg.id)!;
        k.pending.delete(msg.id);
        if (typeof msg.result === "number") k.subs.set(msg.result, p.resolve);
        else p.resolve(null);
        return;
      }
      if (msg.method === "signatureNotification" && typeof msg.params?.subscription === "number") {
        const r = k.subs.get(msg.params.subscription);
        if (!r) return;
        k.subs.delete(msg.params.subscription);
        const value = msg.params.result?.value;
        g().notifications++;
        r({ err: typeof value === "object" && value ? (value.err ?? null) : null, at: Date.now() });
      }
    };
  });
  if (!k.idle)
    k.idle = setInterval(() => {
      // close an idle socket (no subscription for 60 s); keepWarm() reopens it while a token page is open
      if (k.subs.size === 0 && k.pending.size === 0 && Date.now() - k.lastUse > 60_000 && k.ws) {
        try {
          k.ws.close();
        } catch {
          /* already closed */
        }
        k.ws = null;
      }
    }, 15_000);
  return k.opening;
}

/** open (or keep open) the socket of this read RPC — called by the hot-state ticker so a click never pays the handshake */
export function warmSocket(readUrl: string): void {
  const url = wsUrlOf(readUrl);
  if (!url || simulateSends()) return;
  const k = sockOf(url);
  k.lastUse = Date.now();
  void open(k);
}

function subscribe(readUrl: string, sig: string, commitment: Commitment, timeoutMs: number): Promise<SigEvent | null> {
  const url = wsUrlOf(readUrl);
  if (!url) return Promise.resolve(null);
  const k = sockOf(url);
  k.lastUse = Date.now();
  return new Promise<SigEvent | null>((resolve) => {
    let settled = false;
    const t0 = Date.now();
    const finish: Resolver = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (v) g().lastMs = Date.now() - t0;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    open(k).then((ok) => {
      if (!ok || !k.ws) return finish(null);
      const id = k.nextId++;
      k.pending.set(id, { resolve: finish, sig });
      try {
        k.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "signatureSubscribe", params: [sig, { commitment }] }));
      } catch {
        k.pending.delete(id);
        finish(null);
      }
    });
  });
}

/** processed + confirmed notifications of one signature (each null when the socket cannot tell) */
export function watchSignature(readUrl: string, sig: string, timeoutMs = 90_000): { processed: Promise<SigEvent | null>; confirmed: Promise<SigEvent | null> } {
  if (simulateSends()) {
    // measurement mode: the "send" was a simulation, its outcome is known at once
    const r = simResult(sig);
    return {
      processed: r.then((x) => (x ? { err: x.err ?? null, at: Date.now(), simulated: true } : null)),
      confirmed: r.then((x) => (x ? { err: { simulated: x.err ? "failed" : "ok", detail: x.err ?? null, unitsConsumed: x.unitsConsumed }, at: Date.now(), simulated: true } : null)),
    };
  }
  return { processed: subscribe(readUrl, sig, "processed", timeoutMs), confirmed: subscribe(readUrl, sig, "confirmed", timeoutMs) };
}

export function sigsubHealth(): { sockets: number; open: number; subscriptions: number; notifications: number; lastMs: number | null; failures: number } {
  const s = g();
  let openN = 0;
  let subs = 0;
  for (const k of s.socks.values()) {
    if (k.ws && k.ws.readyState === 1) openN++;
    subs += k.subs.size + k.pending.size;
  }
  return { sockets: s.socks.size, open: openN, subscriptions: subs, notifications: s.notifications, lastMs: s.lastMs, failures: s.failures };
}
