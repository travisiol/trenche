/* The send path: Helius Sender (or any custom send RPC) + the read RPC, in parallel, for every signed transaction.
 *
 * Helius Sender (docs.helius.dev → Sending transactions → Sender, read 2026-10-05):
 *  - accepts ONLY `sendTransaction` (and `sendBundle`): blockhash, simulation, statuses, balances never go there;
 *  - every transaction must carry a SOL transfer to one of its tip accounts (the 10 Jito tip accounts, identical to
 *    engine/solana/config.js JITO_TIP_ACCOUNTS) — min 0.000005 SOL with `?swqos_only=true` (TRENCH always adds it),
 *    0.0002 SOL otherwise — and a `setComputeUnitPrice`; anything else is rejected;
 *  - skipPreflight true + maxRetries 0 is the low-latency mode (TRENCH confirms and re-broadcasts itself);
 *  - default limit 50 transactions / s (HTTP 429 above): a token bucket keeps us under 45/s without serializing a
 *    burst (10 wallets = 10 parallel POSTs); re-broadcasts only use Sender when the bucket is more than half full;
 *  - connection warming: GET /ping when there were gaps > 5 s (keepSenderWarm, called while a token page is open).
 *
 * `SenderConnection` is what store().sol.sendConnection() returns. It IS a Connection on the read RPC (any call other
 * than sendRawTransaction — blockhash, simulate, statuses… — goes to the read RPC through the queue), and its
 * sendRawTransaction posts the same signed bytes to Sender (only when the transaction carries the tip + priority fee;
 * otherwise Sender is skipped and the read RPC alone carries it) AND to the read RPC: one signature, so there is
 * nothing to dedup — the first acknowledgement wins.
 *
 * TRENCH_SIMULATE_SENDS=1 (measurement only, on an isolated TRENCH_DATA_DIR instance): nothing is broadcast — each "send" is a
 * simulateTransaction (sigVerify:false) on the read RPC and the confirmation resolves at once with the simulation
 * result (sigsub.ts reads simResult). */
import { Connection, VersionedTransaction, type FetchFn, type SendOptions } from "@solana/web3.js";
import { JITO_TIP_ACCOUNTS, isHeliusSender } from "@/engine/solana/config.js";
import { base58Encode } from "@/engine/solana/keys.js";
import { countRpcCall, maskRpcUrl, queuedFetch } from "./rpcqueue";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TIP_ACCOUNTS = new Set(JITO_TIP_ACCOUNTS);
/** Sender minimum tips (lamports) */
export const SENDER_MIN_TIP_SWQOS = BigInt(5_000);
export const SENDER_MIN_TIP_DUAL = BigInt(200_000);
const SENDER_TPS = 45;

export const simulateSends = (): boolean => process.env.TRENCH_SIMULATE_SENDS === "1";

export function senderMinTip(url: string): bigint {
  return /[?&]swqos_only=true/i.test(url) ? SENDER_MIN_TIP_SWQOS : SENDER_MIN_TIP_DUAL;
}

export type TxInspect = { signature: string; tipLamports: bigint; cuPrice: bigint; cuLimit: number | null };

/** tip transfers to a Sender/Jito tip account, compute unit price and limit, read from the signed bytes */
export function inspectTx(raw: Uint8Array): TxInspect {
  const tx = VersionedTransaction.deserialize(raw);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  let tip = BigInt(0);
  let cuPrice = BigInt(0);
  let cuLimit: number | null = null;
  for (const ix of tx.message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    if (program === SYSTEM_PROGRAM && data.length >= 12 && data.readUInt32LE(0) === 2) {
      const to = keys[ix.accountKeyIndexes[1]];
      if (to && TIP_ACCOUNTS.has(to)) tip += data.readBigUInt64LE(4);
    } else if (program === COMPUTE_BUDGET && data.length >= 1) {
      if (data[0] === 3 && data.length >= 9) cuPrice = data.readBigUInt64LE(1);
      else if (data[0] === 2 && data.length >= 5) cuLimit = data.readUInt32LE(1);
    }
  }
  return { signature: base58Encode(tx.signatures[0]), tipLamports: tip, cuPrice, cuLimit };
}

type SenderStats = {
  sends: number;
  ok: number;
  rateLimitedAt: number[];
  errors: number;
  skippedNoTip: number;
  rebroadcastsSkipped: number;
  lastError: string | null;
  lastErrorAt: number | null;
  latencies: number[];
  lastContact: number;
  pingOk: number | null;
};
type SimResult = { err: unknown; unitsConsumed: number | null; logs: string[] };
type SenderGlobal = { tokens: number; refillAt: number; waiters: (() => void)[]; stats: SenderStats; sim: Map<string, SimResult>; url: string };
declare global {
  var __trenchSender: SenderGlobal | undefined;
}
function g(): SenderGlobal {
  if (!globalThis.__trenchSender)
    globalThis.__trenchSender = {
      tokens: SENDER_TPS,
      refillAt: Date.now(),
      waiters: [],
      sim: new Map(),
      url: "",
      stats: { sends: 0, ok: 0, rateLimitedAt: [], errors: 0, skippedNoTip: 0, rebroadcastsSkipped: 0, lastError: null, lastErrorAt: null, latencies: [], lastContact: 0, pingOk: null },
    };
  return globalThis.__trenchSender;
}

function refill(s: SenderGlobal): void {
  const now = Date.now();
  s.tokens = Math.min(SENDER_TPS, s.tokens + ((now - s.refillAt) / 1000) * SENDER_TPS);
  s.refillAt = now;
}
/** one token now (non-blocking) when more than `reserve` are left */
function tryTake(reserve = 0): boolean {
  const s = g();
  refill(s);
  if (s.tokens - 1 < reserve) return false;
  s.tokens -= 1;
  return true;
}
/** one token, waiting for the refill when the bucket is empty (≤ ~22 ms per missing token at 45/s) */
async function take(): Promise<void> {
  for (;;) {
    if (tryTake()) return;
    const s = g();
    await new Promise((r) => setTimeout(r, Math.ceil(((1 - s.tokens) / SENDER_TPS) * 1000) + 1));
  }
}

function noteSenderError(msg: string): void {
  const st = g().stats;
  st.errors++;
  st.lastError = msg.slice(0, 200);
  st.lastErrorAt = Date.now();
}

/** direct JSON-RPC POST (keep-alive, no queue: a burst of N sends goes out in parallel, nothing retries a send) */
async function postRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  countRpcCall(method);
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }), signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let json: { result?: T; error?: { message?: string } } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.error || json.result === undefined) throw new Error(json?.error?.message ?? `${res.status} ${text.slice(0, 120)}`);
  return json.result;
}

/** POST one sendTransaction to Sender / a custom send RPC (direct fetch: no read-queue limiter, keep-alive) */
async function postSend(url: string, base64: string): Promise<string> {
  const s = g();
  const st = s.stats;
  st.sends++;
  countRpcCall("sendTransaction@sender");
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: t0, method: "sendTransaction", params: [base64, { encoding: "base64", skipPreflight: true, maxRetries: 0 }] }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    noteSenderError(`unreachable: ${msg}`);
    throw new Error(`send RPC unreachable: ${msg}`);
  }
  st.lastContact = Date.now();
  st.latencies.push(Date.now() - t0);
  if (st.latencies.length > 20) st.latencies.shift();
  const text = await res.text();
  if (res.status === 429) {
    st.rateLimitedAt.push(Date.now());
    noteSenderError(`429 rate limited by ${new URL(url).host}`);
    throw new Error(`429 rate limited by ${new URL(url).host}`);
  }
  let json: { result?: string; error?: { message?: string } } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.error || typeof json.result !== "string") {
    const msg = json?.error?.message ?? `${res.status} ${text.slice(0, 120)}`;
    if (!/already been processed|AlreadyProcessed/i.test(msg)) noteSenderError(msg);
    throw new Error(msg);
  }
  st.ok++;
  return json.result;
}

export class SenderConnection extends Connection {
  readonly sendUrl: string | null;
  readonly requiresTip: boolean;
  readonly minTip: bigint;
  /** last reason a transaction did not go through Sender (missing tip / priority fee) — engine notes it once per job */
  lastSkip: string | null = null;

  constructor(readUrl: string, sendUrl: string | null) {
    super(readUrl, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: queuedFetch as unknown as FetchFn });
    this.sendUrl = sendUrl && sendUrl.trim() && sendUrl.trim() !== readUrl.trim() ? sendUrl.trim() : null;
    this.requiresTip = !!this.sendUrl && isHeliusSender(this.sendUrl);
    this.minTip = this.sendUrl ? senderMinTip(this.sendUrl) : BigInt(0);
    if (this.sendUrl) g().url = this.sendUrl;
  }

  /** does this transaction qualify for Sender (tip ≥ minimum to a tip account + a priority fee)? */
  qualifies(info: TxInspect): string | null {
    if (!this.requiresTip) return null;
    if (info.tipLamports < this.minTip) return `no Sender tip (${info.tipLamports} < ${this.minTip} lamports to a tip account)`;
    if (info.cuPrice <= BigInt(0)) return "no compute unit price";
    return null;
  }

  override async sendRawTransaction(raw: Buffer | Uint8Array | number[], options?: SendOptions & { rebroadcast?: boolean }): Promise<string> {
    const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
    const info = inspectTx(bytes);
    if (simulateSends()) return this.simulateInstead(bytes, info);
    const paths: Promise<string>[] = [];
    if (this.sendUrl) {
      const skip = this.qualifies(info);
      if (skip) {
        this.lastSkip = skip;
        if (!options?.rebroadcast) g().stats.skippedNoTip++;
      } else if (!options?.rebroadcast) {
        await take();
        paths.push(postSend(this.sendUrl, Buffer.from(bytes).toString("base64")));
      } else if (tryTake(SENDER_TPS / 2)) paths.push(postSend(this.sendUrl, Buffer.from(bytes).toString("base64")));
      else g().stats.rebroadcastsSkipped++;
    }
    // second path: the read RPC (same signature — the cluster drops the duplicate); direct POST, not the read queue,
    // so 10 wallets are 10 parallel requests instead of waiting for the queue's concurrency slots
    paths.push(postRpc<string>(this.rpcEndpoint, "sendTransaction", [Buffer.from(bytes).toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 0 }]));
    try {
      return await Promise.any(paths);
    } catch (e) {
      const errs = e instanceof AggregateError ? e.errors : [e];
      const msgs = errs.map((x) => (x instanceof Error ? x.message : String(x)));
      // "already processed" from any path = it landed
      const done = msgs.find((m) => /already been processed|AlreadyProcessed/i.test(m));
      throw new Error(done ?? msgs.join(" · "));
    }
  }

  private async simulateInstead(bytes: Uint8Array, info: TxInspect): Promise<string> {
    const skip = this.qualifies(info);
    if (skip) this.lastSkip = skip;
    try {
      // same transport as a real send (direct POST in parallel), simulateTransaction instead of sendTransaction
      const r = await postRpc<{ value: { err: unknown; unitsConsumed?: number; logs?: string[] } }>(this.rpcEndpoint, "simulateTransaction", [
        Buffer.from(bytes).toString("base64"),
        { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "processed" },
      ]);
      g().sim.set(info.signature, { err: r.value.err, unitsConsumed: r.value.unitsConsumed ?? null, logs: (r.value.logs ?? []).slice(-3) });
    } catch (e) {
      g().sim.set(info.signature, { err: e instanceof Error ? e.message : String(e), unitsConsumed: null, logs: [] });
    }
    if (g().sim.size > 500) g().sim.delete(g().sim.keys().next().value!);
    return info.signature;
  }
}

/** simulation outcome of a signature "sent" in TRENCH_SIMULATE_SENDS mode (waits until its simulation answered) */
export async function simResult(sig: string, timeoutMs = 15_000): Promise<SimResult | null> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = g().sim.get(sig);
    if (r || Date.now() > until) return r ?? null;
    await new Promise((res) => setTimeout(res, 5));
  }
}

/** GET <sender>/ping when the last contact is older than 4.5 s (keeps the TLS connection warm between clicks) */
export function warmSender(url: string | null): void {
  if (!url || !isHeliusSender(url) || simulateSends()) return;
  const st = g().stats;
  if (Date.now() - st.lastContact < 4500) return;
  st.lastContact = Date.now();
  let ping: string;
  try {
    const u = new URL(url);
    ping = `${u.protocol}//${u.host}/ping`;
  } catch {
    return;
  }
  const t0 = Date.now();
  fetch(ping, { signal: AbortSignal.timeout(4000) })
    .then((r) => {
      st.pingOk = r.ok ? Date.now() - t0 : null;
    })
    .catch(() => {
      st.pingOk = null;
    });
}

export type SenderHealth = {
  url: string | null;
  sends: number;
  ok: number;
  rateLimited: number;
  errors: number;
  skippedNoTip: number;
  rebroadcastsSkipped: number;
  latencyMs: number | null;
  pingMs: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
};

export function senderHealth(): SenderHealth {
  const s = g();
  const st = s.stats;
  const now = Date.now();
  while (st.rateLimitedAt.length && st.rateLimitedAt[0] < now - 60_000) st.rateLimitedAt.shift();
  const sorted = [...st.latencies].sort((a, b) => a - b);
  return {
    url: s.url ? maskRpcUrl(s.url) : null,
    sends: st.sends,
    ok: st.ok,
    rateLimited: st.rateLimitedAt.length,
    errors: st.errors,
    skippedNoTip: st.skippedNoTip,
    rebroadcastsSkipped: st.rebroadcastsSkipped,
    latencyMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    pingMs: st.pingOk,
    lastError: st.lastError,
    lastErrorAt: st.lastErrorAt,
  };
}
