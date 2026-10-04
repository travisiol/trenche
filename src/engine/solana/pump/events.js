import { PublicKey } from "@solana/web3.js";

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
