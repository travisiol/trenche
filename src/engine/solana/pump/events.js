import { PublicKey } from "@solana/web3.js";
import { base58Decode } from "../keys.js";

var EVENT_DISCRIMINATORS = {
    create: "1b72a94ddeeb6376",
    trade: "bddb7fd34ee661ee",
    collectCreatorFee: "7a027f010ebf0caf",
  },
  BorshReader = class {
    constructor(e) {
      this.b = e;
    }
    b;
    o = 0;
    get offset() {
      return this.o;
    }
    u64() {
      const e = this.b.readBigUInt64LE(this.o);
      return ((this.o += 8), e);
    }
    i64() {
      const e = this.b.readBigInt64LE(this.o);
      return ((this.o += 8), e);
    }
    bool() {
      return this.b[this.o++] === 1;
    }
    pubkey() {
      const e = new PublicKey(this.b.subarray(this.o, this.o + 32));
      return ((this.o += 32), e);
    }
    string() {
      const e = this.b.readUInt32LE(this.o);
      this.o += 4;
      const r = this.b.subarray(this.o, this.o + e).toString("utf8");
      return ((this.o += e), r);
    }
    has(e) {
      return this.o + e <= this.b.length;
    }
  };

function decodeEvent(t) {
  let e;
  try {
    e = Buffer.from(t, "base64");
  } catch {
    return null;
  }
  return decodeEventBytes(e);
}

function decodeEventBytes(e) {
  if (e.length < 8) return null;
  const r = e.subarray(0, 8).toString("hex"),
    n = new BorshReader(e.subarray(8));
  try {
    if (r === EVENT_DISCRIMINATORS.create) {
      const a = n.string(),
        o = n.string(),
        i = n.string();
      return {
        kind: "create",
        name: a,
        symbol: o,
        uri: i,
        mint: n.pubkey(),
        bondingCurve: n.pubkey(),
        user: n.pubkey(),
        creator: n.pubkey(),
        timestamp: n.i64(),
        virtualTokenReserves: n.u64(),
        virtualSolReserves: n.u64(),
        realTokenReserves: n.u64(),
        tokenTotalSupply: n.u64(),
      };
    }
    if (r === EVENT_DISCRIMINATORS.collectCreatorFee) {
      const a = n.i64(),
        o = n.pubkey(),
        i = n.u64();
      return {
        kind: "collectCreatorFee",
        timestamp: a,
        creator: o,
        amount: i,
      };
    }
    if (r === EVENT_DISCRIMINATORS.trade) {
      const a = n.pubkey(),
        o = n.u64(),
        i = n.u64(),
        s = n.bool(),
        c = n.pubkey(),
        d = n.i64(),
        l = n.u64(),
        u = n.u64(),
        p = n.u64(),
        f = n.u64();
      (n.pubkey(), n.u64());
      const h = n.u64(),
        g = n.pubkey();
      n.u64();
      let _ = n.u64(),
        S = 0n;
      try {
        (n.bool(), n.u64(), n.u64(), n.u64(), n.i64(), n.string(), n.bool(), n.u64(), (S = n.u64()));
      } catch {
        S = 0n;
      }
      return {
        kind: "trade",
        mint: a,
        solAmount: o,
        tokenAmount: i,
        isBuy: s,
        user: c,
        timestamp: d,
        virtualSolReserves: l,
        virtualTokenReserves: u,
        realSolReserves: p,
        realTokenReserves: f,
        fee: h,
        creator: g,
        creatorFee: _,
        cashback: S,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/* Anchor emit_cpi: pump.fun also emits every event as a self-CPI whose data = EVENT_IX_TAG + event. Unlike the
   "Program data:" logs, inner instructions are never truncated — a create carrying the dev buy + 2 bundle buys
   overflows the 10 KB log budget and loses the later trade events (2026-10-06, Cghynn…pump). */
var EVENT_IX_TAG = "e445a52e51cb9a1d";

/** every pump.fun event of a transaction (getTransaction result): inner instructions first, the logs as a fallback */
export function parseTxEvents(tx) {
  const out = [];
  for (const group of tx?.meta?.innerInstructions ?? [])
    for (const ix of group.instructions ?? []) {
      const raw = typeof ix.data === "string" ? ix.data : null;
      if (!raw || raw.length < 24) continue;
      let b;
      try {
        b = Buffer.from(base58Decode(raw));
      } catch {
        continue;
      }
      if (b.length < 16 || b.subarray(0, 8).toString("hex") !== EVENT_IX_TAG) continue;
      const ev = decodeEventBytes(b.subarray(8));
      ev && out.push(ev);
    }
  return out.length ? out : parseEventLogs(tx?.meta?.logMessages ?? []);
}

export function parseEventLogs(t) {
  const e = [];
  for (const r of t) {
    const n = r.indexOf("Program data: ");
    if (n === -1) continue;
    const a = decodeEvent(r.slice(n + 14).trim());
    a && e.push(a);
  }
  return e;
}

/* getTransaction for ANY transaction version, raw JSON (through the Connection's queued fetch). web3.js 1.x refuses
   version 1 (StructError "At path: version") and maxSupportedTransactionVersion 0 makes the node refuse it — on
   2026-10-06 a mainnet holder's 30 last buys were ALL v1: its cost read as 0 (+1474 % PnL) and those trades were
   missing from the curve history. parseTxEvents only needs meta.innerInstructions / meta.logMessages; slot and
   blockTime are top-level as usual. null = not found (yet). */
export async function getTransactionAnyVersion(conn, sig) {
  const res = await conn._rpcRequest("getTransaction", [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
  if (res?.error) throw new Error(res.error.message ?? "getTransaction failed");
  return res?.result ?? null;
}
