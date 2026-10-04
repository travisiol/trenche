/* Trenches feed — ONE websocket to PumpPortal (globalThis.__trenchFeed, survives HMR; PumpPortal bans
 * a second connection for an hour) + RPC polling of the bonding curves every 2 s.
 *
 * PumpPortal message shapes OBSERVED on wss://pumpportal.fun/api/data (probes of 12 s and 100 s on
 * 2026-10-04, 45 create messages):
 *   subscribe acks
 *     {"message":"Successfully subscribed to token creation events."}
 *     {"message":"Subscribed to 'migration' events."}
 *   create (subscribeNewToken)
 *     {"signature":"Nuky…","mint":"2q91…pump","traderPublicKey":"K6Eh…","txType":"create",
 *      "initialBuy":18217217.206124,            // tokens bought by the dev (6 decimals applied)
 *      "solAmount":0.518131814,                 // SOL of the dev buy
 *      "bondingCurveKey":"BwWK…","vTokensInBondingCurve":1054782782.793876,
 *      "vSolInBondingCurve":30.518131813581675,"marketCapSol":28.93309628428537,
 *      "name":"dogbaton","symbol":"dogbaton","uri":"https://ipfs.io/ipfs/Qmb1…",
 *      "is_mayhem_mode":true,"pool":"pump"}
 *     name/symbol/uri CAN BE ABSENT (seen on 65aZra…pump): the card is then resolved from the mint account.
 *   migration (subscribeMigration): NOT observed during the probes (rare event). PumpPortal's docs give
 *     {"signature":…,"mint":…,"txType":"migrate","pool":"pump-amm"} — the parser accepts txType
 *     "migrate" | "migration" and, defensively, any message with a mint whose pool is "pump-amm".
 *   trade (subscribeTokenTrade, needs an api key — not observed, docs):
 *     {"signature","mint","traderPublicKey","txType":"buy"|"sell","tokenAmount","solAmount",
 *      "newTokenBalance","bondingCurveKey","vTokensInBondingCurve","vSolInBondingCurve","marketCapSol","pool"}
 *
 * Without a key, volume/trade counts are APPROXIMATED from |Δ realSolReserves| between two polls
 * (several trades inside one 2 s window count as one): FeedCard.volumeApprox = true.
 */
import { PublicKey } from "@solana/web3.js";
import { INITIAL_VIRTUAL_TOKENS, INITIAL_REAL_TOKENS, TOKEN_2022_PROGRAM, associatedTokenAddress, bondingCurvePda, parseBondingCurve, tokenProgramFor } from "@/engine/solana/pump/pdas.js";
import type { FeedCard, FeedEvent, FeedSnapshot, FeedStatus, FeedTrade, TrendingEntry, TrendingWindow } from "@/lib/types";
import { curveMetrics, isPublicRpc, readConn, rpcChunk } from "./engine";
import { IMAGE_CDN, resolveMeta } from "./metadata";
import { solPrice } from "./price";
import { store } from "./store";

const WS_URL = "wss://pumpportal.fun/api/data";
const POLL_MS = 2000;
const NEW_MAX_AGE_MS = 30 * 60_000;
const ALMOST_PCT = 85;
const COL_MAX = 100;
const POLL_MAX = 150;
const HOLDERS_EVERY_MS = 20_000;

type Sample = { at: number; mc: number | null; vol: number; trades: number };

type Card = FeedCard & {
  _lastRealSol: bigint | null;
  _lastRealTok: bigint | null;
  _tokenProgram: PublicKey | null;
  _tradesLive: boolean;
  _samples: Sample[]; // every poll, last 10 min
  _minutes: Sample[]; // one per minute, last 24 h
  _migratedAt: number | null;
  _holdersAt: number;
};

type Feed = {
  ws: WebSocket | null;
  connected: boolean;
  since: number | null;
  lastMessageAt: number | null;
  reconnects: number;
  error: string | null;
  backoffMs: number;
  keyUsed: string;
  cards: Map<string, Card>;
  subs: Set<(ev: FeedEvent) => void>;
  pollTimer: ReturnType<typeof setTimeout> | null;
  /** adaptive poll delay: grows on 429 (public RPC), shrinks back to 2 s on clean rounds */
  pollDelay: number;
  rawMigrations: Record<string, unknown>[];
  priceTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  polling: boolean;
  solUsd: number | null;
  tradeSubs: Set<string>;
  started: boolean;
  holdersAt: number;
  /** current module's functions — refreshed on every HMR evaluation so timers/ws handlers run new code */
  impl: { poll: () => Promise<void>; onMessage: (msg: Record<string, unknown>) => void; refreshPrice: () => Promise<void>; connect: () => void };
};

declare global {
  var __trenchFeed: Feed | undefined;
}

function feed(): Feed {
  if (!globalThis.__trenchFeed)
    globalThis.__trenchFeed = {
      ws: null,
      connected: false,
      since: null,
      lastMessageAt: null,
      reconnects: 0,
      error: null,
      backoffMs: 5000,
      keyUsed: "",
      cards: new Map(),
      subs: new Set(),
      pollTimer: null,
      pollDelay: POLL_MS,
      priceTimer: null,
      rawMigrations: [],
      reconnectTimer: null,
      polling: false,
      solUsd: null,
      tradeSubs: new Set(),
      started: false,
      holdersAt: 0,
      impl: { poll, onMessage, refreshPrice, connect },
    };
  globalThis.__trenchFeed.impl = { poll, onMessage, refreshPrice, connect };
  return globalThis.__trenchFeed;
}

function emit(ev: FeedEvent): void {
  for (const fn of feed().subs) {
    try {
      fn(ev);
    } catch {
      /* subscriber gone */
    }
  }
}

export function feedStatus(): FeedStatus {
  const f = feed();
  return { connected: f.connected, since: f.since, lastMessageAt: f.lastMessageAt, tracked: pollList().length, tradesLive: !!f.keyUsed, reconnects: f.reconnects, error: f.error };
}

const pub = (c: Card): FeedCard => {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(c)) if (!k.startsWith("_")) o[k] = (c as unknown as Record<string, unknown>)[k];
  return o as FeedCard;
};

function columnOf(c: Card): FeedCard["column"] | null {
  if (c.migrated || c.complete) return "migrated";
  if ((c.progress ?? 0) >= ALMOST_PCT) return "almost";
  if (Date.now() - c.createdAt < NEW_MAX_AGE_MS) return "new";
  return null;
}

export function snapshot(): FeedSnapshot {
  const f = feed();
  const cols: FeedSnapshot["columns"] = { new: [], almost: [], migrated: [] };
  for (const c of f.cards.values()) {
    const col = columnOf(c);
    if (col) cols[col].push(pub({ ...c, column: col }));
  }
  cols.new.sort((a, b) => b.createdAt - a.createdAt);
  cols.almost.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  cols.migrated.sort((a, b) => b.updatedAt - a.updatedAt);
  return { columns: cols, solPrice: f.solUsd, status: feedStatus() };
}

/* ------------------------------------------------------------------ websocket */

function connect(): void {
  const f = feed();
  if (f.ws && (f.ws.readyState === WebSocket.CONNECTING || f.ws.readyState === WebSocket.OPEN)) return;
  const key = store().settings.pumpportalKey.trim();
  f.keyUsed = key;
  const url = key ? `${WS_URL}?api-key=${encodeURIComponent(key)}` : WS_URL;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    f.error = e instanceof Error ? e.message : String(e);
    scheduleReconnect();
    return;
  }
  f.ws = ws;
  ws.addEventListener("open", () => {
    f.connected = true;
    f.since = Date.now();
    f.error = null;
    f.backoffMs = 5000;
    f.tradeSubs.clear();
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeMigration" }));
    emit({ type: "status", data: feedStatus() });
  });
  ws.addEventListener("message", (ev) => {
    f.lastMessageAt = Date.now();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    try {
      f.impl.onMessage(msg);
    } catch (e) {
      f.error = `parser: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
  ws.addEventListener("error", () => {
    f.error = "websocket error";
  });
  ws.addEventListener("close", (ev) => {
    if (f.ws === ws) f.ws = null;
    f.connected = false;
    f.error = f.error ?? `closed (${ev.code})`;
    emit({ type: "status", data: feedStatus() });
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  const f = feed();
  if (f.reconnectTimer) return;
  f.reconnectTimer = setTimeout(() => {
    f.reconnectTimer = null;
    f.reconnects++;
    f.backoffMs = Math.min(60_000, f.backoffMs * 2);
    f.impl.connect();
  }, f.backoffMs);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function newCard(mint: string, msg: Record<string, unknown>): Card {
  const vSol = num(msg.vSolInBondingCurve);
  const vTok = num(msg.vTokensInBondingCurve);
  // realTokenReserves = vTokens − (initial virtual − initial real) until the first RPC read
  const realTok = vTok !== null ? BigInt(Math.round(vTok * 1e6)) - (INITIAL_VIRTUAL_TOKENS - INITIAL_REAL_TOKENS) : null;
  const metrics = vSol !== null && vTok !== null && realTok !== null ? curveMetrics({ virtualSolReserves: BigInt(Math.round(vSol * 1e9)), virtualTokenReserves: BigInt(Math.round(vTok * 1e6)), realTokenReserves: realTok < BigInt(0) ? BigInt(0) : realTok }) : null;
  const f = feed();
  const now = Date.now();
  return {
    mint,
    name: str(msg.name),
    symbol: str(msg.symbol),
    image: null,
    imageCdn: IMAGE_CDN(mint),
    uri: str(msg.uri),
    description: null,
    creator: str(msg.traderPublicKey),
    createdAt: now,
    createSignature: str(msg.signature),
    bondingCurve: str(msg.bondingCurveKey),
    pool: str(msg.pool),
    isMayhem: msg.is_mayhem_mode === true,
    progress: metrics?.progress ?? null,
    complete: false,
    migrated: false,
    marketCapSol: num(msg.marketCapSol) ?? metrics?.marketCapSol ?? null,
    marketCapUsd: f.solUsd && (num(msg.marketCapSol) ?? metrics?.marketCapSol) ? (num(msg.marketCapSol) ?? metrics!.marketCapSol) * f.solUsd : null,
    priceSol: metrics?.priceSol ?? null,
    virtualSolReserves: vSol !== null ? BigInt(Math.round(vSol * 1e9)).toString() : null,
    virtualTokenReserves: vTok !== null ? BigInt(Math.round(vTok * 1e6)).toString() : null,
    realSolReserves: null,
    realTokenReserves: realTok !== null && realTok >= BigInt(0) ? realTok.toString() : null,
    volumeSol: num(msg.solAmount) ?? 0,
    trades: num(msg.solAmount) ? 1 : 0,
    volumeApprox: !f.keyUsed,
    feesSol: null,
    devBuySol: num(msg.solAmount),
    devPct: null,
    top10Pct: null,
    bundlePct: null,
    holders: null,
    lastTradeAt: num(msg.solAmount) ? now : null,
    updatedAt: now,
    column: "new",
    _lastRealSol: null,
    _lastRealTok: null,
    _tokenProgram: null,
    _tradesLive: !!f.keyUsed,
    _samples: [],
    _minutes: [],
    _migratedAt: null,
    _holdersAt: 0,
  };
}

function onMessage(msg: Record<string, unknown>): void {
  const f = feed();
  const mint = str(msg.mint);
  if (!mint) return; // subscription acks
  const tx = str(msg.txType);
  if (tx === "create") {
    if (f.cards.has(mint)) return;
    const card = newCard(mint, msg);
    f.cards.set(mint, card);
    emit({ type: "create", data: pub(card) });
    void resolveMeta(mint, { name: card.name, symbol: card.symbol, uri: card.uri }, card.uri ? undefined : readConn())
      .then((m) => {
        const c = f.cards.get(mint);
        if (!c) return;
        c.name = c.name ?? m.name;
        c.symbol = c.symbol ?? m.symbol;
        c.uri = c.uri ?? m.uri;
        c.image = m.image;
        c.description = m.description;
        if (m.tokenProgram && !c._tokenProgram) c._tokenProgram = tokenProgramFor(m.tokenProgram);
        c.updatedAt = Date.now();
        emit({ type: "update", data: [pub({ ...c, column: columnOf(c) ?? "new" })] });
      })
      .catch(() => undefined);
    return;
  }
  if (tx === "migrate" || tx === "migration" || (str(msg.pool) === "pump-amm" && tx !== "buy" && tx !== "sell")) {
    const c = f.cards.get(mint);
    if (f.rawMigrations.length < 5) {
      f.rawMigrations.push(msg);
      console.log("[trench feed] migration message:", JSON.stringify(msg));
    }
    if (c) {
      c.migrated = true;
      c.complete = true;
      c.pool = str(msg.pool) ?? c.pool;
      c._migratedAt = Date.now();
      c.updatedAt = Date.now();
    }
    emit({ type: "migrate", data: { mint, signature: str(msg.signature), pool: str(msg.pool), at: Date.now(), card: c ? pub({ ...c, column: "migrated" }) : null } });
    return;
  }
  if (tx === "buy" || tx === "sell") {
    const c = f.cards.get(mint);
    const sol = num(msg.solAmount) ?? 0;
    const trade: FeedTrade = { mint, signature: str(msg.signature), trader: str(msg.traderPublicKey), side: tx, solAmount: sol, tokenAmount: num(msg.tokenAmount), marketCapSol: num(msg.marketCapSol), at: Date.now(), source: "pumpportal" };
    if (c) {
      c._tradesLive = true;
      c.volumeApprox = false;
      c.volumeSol = (c.volumeSol ?? 0) + sol;
      c.trades = (c.trades ?? 0) + 1;
      c.feesSol = (c.feesSol ?? 0) + sol * 0.003; // pump.fun creator fee 0.30 % (nominal; 0 on cashback coins)
      c.lastTradeAt = trade.at;
      const mc = num(msg.marketCapSol);
      if (mc !== null) {
        c.marketCapSol = mc;
        c.marketCapUsd = f.solUsd ? mc * f.solUsd : null;
      }
      const vSol = num(msg.vSolInBondingCurve);
      const vTok = num(msg.vTokensInBondingCurve);
      if (vSol !== null) c.virtualSolReserves = BigInt(Math.round(vSol * 1e9)).toString();
      if (vTok !== null) c.virtualTokenReserves = BigInt(Math.round(vTok * 1e6)).toString();
      c.updatedAt = trade.at;
    }
    emit({ type: "trade", data: trade });
  }
}

/* ------------------------------------------------------------------ RPC polling */

function pollList(): Card[] {
  const f = feed();
  return [...f.cards.values()]
    .filter((c) => !c.migrated && !c.complete && columnOf(c) !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, isPublicRpc() ? 100 : POLL_MAX);
}

function evict(): void {
  const f = feed();
  const cols: Record<string, Card[]> = { new: [], almost: [], migrated: [] };
  for (const c of f.cards.values()) {
    const col = columnOf(c);
    if (!col) {
      f.cards.delete(c.mint);
      continue;
    }
    c.column = col;
    cols[col].push(c);
  }
  cols.new.sort((a, b) => b.createdAt - a.createdAt);
  cols.almost.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  cols.migrated.sort((a, b) => (b._migratedAt ?? b.updatedAt) - (a._migratedAt ?? a.updatedAt));
  for (const list of Object.values(cols)) for (const c of list.slice(COL_MAX)) f.cards.delete(c.mint);
}

function sample(c: Card, now: number): void {
  const s: Sample = { at: now, mc: c.marketCapSol, vol: c.volumeSol ?? 0, trades: c.trades ?? 0 };
  c._samples.push(s);
  while (c._samples.length && now - c._samples[0].at > 10 * 60_000) c._samples.shift();
  const lastMin = c._minutes[c._minutes.length - 1];
  if (!lastMin || now - lastMin.at >= 60_000) {
    c._minutes.push(s);
    while (c._minutes.length && now - c._minutes[0].at > 24 * 3_600_000) c._minutes.shift();
  }
}

async function poll(): Promise<void> {
  const f = feed();
  if (f.polling) return;
  f.polling = true;
  try {
    // key changed in Settings → reconnect with/without the key
    if (f.ws && f.keyUsed !== store().settings.pumpportalKey.trim()) {
      f.ws.close();
      f.ws = null;
    }
    const list = pollList();
    if (list.length === 0) return;
    const conn = readConn();
    const keys: PublicKey[] = [];
    const slots: { card: Card; kind: "curve" | "mint" | "devAta" }[] = [];
    // the free public RPC takes 10 keys per call: extra reads (mint owner, dev ATA) only for the 20 newest cards
    const extraMax = isPublicRpc() ? 20 : list.length;
    list.forEach((c, idx) => {
      keys.push(c.bondingCurve ? new PublicKey(c.bondingCurve) : bondingCurvePda(new PublicKey(c.mint)));
      slots.push({ card: c, kind: "curve" });
      if (idx >= extraMax) return;
      if (!c._tokenProgram) {
        keys.push(new PublicKey(c.mint));
        slots.push({ card: c, kind: "mint" });
      } else if (c.creator) {
        keys.push(associatedTokenAddress(new PublicKey(c.creator), new PublicKey(c.mint), c._tokenProgram));
        slots.push({ card: c, kind: "devAta" });
      }
    });
    // chunked reads, ≤ 6 in flight; a failed chunk only skips its cards for this round
    const size = rpcChunk();
    const infos = new Array<import("@solana/web3.js").AccountInfo<Buffer> | null | undefined>(keys.length).fill(undefined);
    const chunks: number[] = [];
    for (let i = 0; i < keys.length; i += size) chunks.push(i);
    let next = 0;
    let rpcError: string | null = null;
    await Promise.all(
      Array.from({ length: Math.min(isPublicRpc() ? 3 : 6, chunks.length) }, async () => {
        while (next < chunks.length) {
          const start = chunks[next++];
          try {
            const res = await conn.getMultipleAccountsInfo(keys.slice(start, start + size), "confirmed");
            res.forEach((r, i) => {
              infos[start + i] = r;
            });
          } catch (e) {
            rpcError = `rpc: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
          }
        }
      }),
    );
    f.error = rpcError;
    f.pollDelay = rpcError && /429|Too Many/i.test(rpcError) ? Math.min(10_000, f.pollDelay + 2000) : Math.max(POLL_MS, f.pollDelay - 500);
    const now = Date.now();
    const changed = new Set<Card>();
    slots.forEach((slot, i) => {
      const info = infos[i];
      if (info === undefined) return; // chunk failed this round
      const c = slot.card;
      if (slot.kind === "mint") {
        if (info) {
          c._tokenProgram = tokenProgramFor(info.owner.toBase58());
        }
        return;
      }
      if (slot.kind === "devAta") {
        let pct: number | null = null;
        if (info?.data && info.data.length >= 72) {
          try {
            pct = Number((Buffer.from(info.data).readBigUInt64LE(64) * BigInt(10000)) / BigInt(1_000_000_000_000_000)) / 100;
          } catch {
            pct = null;
          }
        } else if (info === null) pct = 0;
        if (pct !== c.devPct) {
          c.devPct = pct;
          changed.add(c);
        }
        return;
      }
      if (!info) return; // curve not yet visible (or closed after migration)
      let curve;
      try {
        curve = parseBondingCurve(info.data);
      } catch {
        return;
      }
      const m = curveMetrics(curve);
      const before = `${c.progress}|${c.marketCapSol}|${c.complete}`;
      c.progress = m.progress;
      c.marketCapSol = m.marketCapSol;
      c.marketCapUsd = f.solUsd ? m.marketCapSol * f.solUsd : null;
      c.priceSol = m.priceSol;
      c.virtualSolReserves = curve.virtualSolReserves.toString();
      c.virtualTokenReserves = curve.virtualTokenReserves.toString();
      c.realSolReserves = curve.realSolReserves.toString();
      c.realTokenReserves = curve.realTokenReserves.toString();
      c.creator = c.creator ?? curve.creator.toBase58();
      if (curve.complete && !c.complete) {
        c.complete = true;
        c.migrated = true;
        c._migratedAt = now;
        emit({ type: "migrate", data: { mint: c.mint, signature: null, pool: c.pool, at: now, card: pub({ ...c, column: "migrated" }) } });
      }
      if (c._lastRealSol !== null && !c._tradesLive) {
        const d = curve.realSolReserves - c._lastRealSol;
        if (d !== BigInt(0)) {
          const sol = Math.abs(Number(d)) / 1e9;
          c.volumeSol = (c.volumeSol ?? 0) + sol;
          c.trades = (c.trades ?? 0) + 1;
          c.lastTradeAt = now;
          const dt = c._lastRealTok !== null ? curve.realTokenReserves - c._lastRealTok : null;
          emit({ type: "trade", data: { mint: c.mint, signature: null, trader: null, side: d > BigInt(0) ? "buy" : "sell", solAmount: sol, tokenAmount: dt !== null ? Math.abs(Number(dt)) / 1e6 : null, marketCapSol: m.marketCapSol, at: now, source: "rpc" } });
        }
      }
      c._lastRealSol = curve.realSolReserves;
      c._lastRealTok = curve.realTokenReserves;
      sample(c, now);
      if (before !== `${c.progress}|${c.marketCapSol}|${c.complete}`) changed.add(c);
      c.updatedAt = now;
    });
    evict();
    if (f.keyUsed && f.ws && f.ws.readyState === WebSocket.OPEN) syncTradeSubs(list.map((c) => c.mint));
    if (now - f.holdersAt > HOLDERS_EVERY_MS) {
      f.holdersAt = now;
      void enrichHolders(conn, list);
    }
    if (changed.size) emit({ type: "update", data: [...changed].filter((c) => f.cards.has(c.mint)).map((c) => pub({ ...c, column: columnOf(c) ?? "new" })) });
  } finally {
    f.polling = false;
  }
}

/** with a key: keep subscribeTokenTrade in sync with the polled mints */
function syncTradeSubs(mints: string[]): void {
  const f = feed();
  const want = new Set(mints.slice(0, 200));
  const add = [...want].filter((m) => !f.tradeSubs.has(m));
  const del = [...f.tradeSubs].filter((m) => !want.has(m));
  if (add.length) f.ws!.send(JSON.stringify({ method: "subscribeTokenTrade", keys: add }));
  if (del.length) f.ws!.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: del }));
  for (const m of add) f.tradeSubs.add(m);
  for (const m of del) f.tradeSubs.delete(m);
}

/** top-10 holders % (curve excluded) for the "almost bonded" cards + the 10 newest, 1 RPC call each, every 20 s */
async function enrichHolders(conn: import("@solana/web3.js").Connection, list: Card[]): Promise<void> {
  const f = feed();
  const targets = [...list.filter((c) => (c.progress ?? 0) >= ALMOST_PCT).slice(0, 20), ...list.filter((c) => (c.progress ?? 0) < ALMOST_PCT).slice(0, 10)].filter((c) => Date.now() - c._holdersAt > HOLDERS_EVERY_MS);
  const changed: Card[] = [];
  for (const c of targets) {
    c._holdersAt = Date.now();
    try {
      const mintPk = new PublicKey(c.mint);
      const tp = c._tokenProgram ?? new PublicKey(TOKEN_2022_PROGRAM);
      const curveAta = associatedTokenAddress(c.bondingCurve ? new PublicKey(c.bondingCurve) : bondingCurvePda(mintPk), mintPk, tp).toBase58();
      const r = await conn.getTokenLargestAccounts(mintPk, "confirmed");
      const others = r.value.filter((v) => v.address.toBase58() !== curveAta).slice(0, 10);
      const top = others.reduce((s, v) => s + Number(v.amount), 0);
      const pct = Math.round((top / 1e15) * 10000) / 100;
      if (pct !== c.top10Pct) {
        c.top10Pct = pct;
        changed.push(c);
      }
    } catch {
      /* rate-limited: keep the previous value */
    }
  }
  if (changed.length) emit({ type: "update", data: changed.filter((c) => f.cards.has(c.mint)).map((c) => pub({ ...c, column: columnOf(c) ?? "new" })) });
}

async function refreshPrice(): Promise<void> {
  const f = feed();
  const p = await solPrice().catch(() => null);
  if (p && p.usd !== f.solUsd) {
    f.solUsd = p.usd;
    for (const c of f.cards.values()) if (c.marketCapSol !== null) c.marketCapUsd = c.marketCapSol * p.usd;
    emit({ type: "solPrice", data: { usd: p.usd, at: p.at } });
  }
}

/* ------------------------------------------------------------------ public */

export function feedStart(): void {
  const f = feed();
  if (f.started) return;
  f.started = true;
  connect();
  const tick = () => {
    const ff = feed();
    ff.pollTimer = setTimeout(() => void ff.impl.poll().finally(tick), ff.pollDelay);
  };
  tick();
  f.priceTimer = setInterval(() => void feed().impl.refreshPrice(), 30_000);
  void refreshPrice();
}

export function feedSubscribe(fn: (ev: FeedEvent) => void): () => void {
  feedStart();
  const f = feed();
  f.subs.add(fn);
  fn({ type: "snapshot", data: snapshot() });
  return () => f.subs.delete(fn);
}

export function feedCard(mint: string): FeedCard | null {
  const c = feed().cards.get(mint);
  return c ? pub({ ...c, column: columnOf(c) ?? "new" }) : null;
}

export function feedSolUsd(): number | null {
  return feed().solUsd;
}

const WINDOW_MS: Record<TrendingWindow, number> = { "1m": 60_000, "5m": 5 * 60_000, "1h": 3_600_000, "6h": 6 * 3_600_000, "24h": 24 * 3_600_000 };

export function trending(window: TrendingWindow, limit = 50): TrendingEntry[] {
  feedStart();
  const f = feed();
  const now = Date.now();
  const w = WINDOW_MS[window];
  const out: TrendingEntry[] = [];
  for (const c of f.cards.values()) {
    const series = w <= 10 * 60_000 ? c._samples : c._minutes;
    if (series.length === 0) continue;
    const start = now - w;
    let base = series[0];
    for (const s of series) {
      if (s.at <= start) base = s;
      else break;
    }
    const latest = series[series.length - 1];
    const volumeSol = Math.max(0, latest.vol - base.vol + (base === series[0] && c.createdAt > start ? (c.devBuySol ?? 0) : 0));
    const trades = Math.max(0, latest.trades - base.trades);
    const mcChangePct = base.mc && latest.mc ? ((latest.mc - base.mc) / base.mc) * 100 : null;
    if (volumeSol <= 0 && trades <= 0) continue;
    out.push({ card: pub({ ...c, column: columnOf(c) ?? "new" }), volumeSol, trades, mcChangePct, coverageSec: Math.round((now - base.at) / 1000), score: volumeSol * (1 + Math.max(0, mcChangePct ?? 0) / 100) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
