import { PublicKey } from "@solana/web3.js";
import {
  INITIAL_REAL_TOKENS,
  TOKEN_2022_PROGRAM,
  TOKEN_TOTAL_SUPPLY,
  associatedTokenAddress,
  bondingCurvePda,
  parseBondingCurve,
  tokenProgramFor,
} from "./pdas.js";
import { readSolanaBalances } from "../rpc.js";
import { solOutForTokens } from "./math.js";
import { getTransactionAnyVersion, parseTxEvents } from "./events.js";
import { parseMintMetadata } from "./metadata.js";

var GRADUATION_SOL = 85000000000n,
  historyCache = new Map(),
  historyInFlight = new Map();

async function mapLimit(t, e, r) {
  let n = new Array(t.length),
    a = 0;
  return (
    await Promise.all(
      Array.from(
        {
          length: Math.min(e, t.length),
        },
        async () => {
          for (; a < t.length;) {
            const o = a++;
            n[o] = await r(t[o]);
          }
        },
      ),
    ),
    n
  );
}

async function walletTradeHistory(t, e, r, n = {}) {
  const a = e.toBase58(),
    o = historyInFlight.get(a);
  o && (await o.catch(() => {}));
  const i = historyCache.get(a) ?? {
    trades: [],
    newestByWallet: new Map(),
    complete: !0,
    seen: new Set(),
    balanceKey: null,
  };
  (i.seen || (i.seen = new Set()), i.newestByWallet || (i.newestByWallet = new Map()), i.retry || (i.retry = new Set()));
  /* balances unchanged → no rescan, EXCEPT: for 30 s after they changed (the ATA's signature index can lag the balance
     read by a second or two), when the caller knows of a new trade (`force`: the live feed saw one of these wallets
     trade), and at least once a minute — a buy then a full sell between two reads leaves the balance where it was,
     and those trades were never counted (cost / realised stale until some later balance change) */
  const s = n.balanceKey !== void 0 && i.balanceKey === n.balanceKey && i.trades.length > 0 && i.retry.size === 0 && !n.force && Date.now() - (i.balanceKeyAt ?? 0) > 30000 && Date.now() - (i.scannedAt ?? 0) < 60000,
    c = n.maxSignatures ?? 1e3,
    d = n.tokenProgram ?? new PublicKey(TOKEN_2022_PROGRAM),
    l = s
      ? Promise.resolve()
      : (async () => {
          // signatures listed earlier whose transaction could not be read (429, not visible yet): retried first
          const h = [...i.retry];
          i.retry.clear();
          if (
            (await mapLimit([...r], 6, async S => {
              let A;
              try {
                A = associatedTokenAddress(new PublicKey(S), e, d);
              } catch {
                return;
              }
              let k = i.newestByWallet.get(S),
                v,
                I,
                P = !1,
                D = 0;
              for (; !P && D < c;) {
                const U = await t
                  .getSignaturesForAddress(A, {
                    limit: 100,
                    before: v,
                  })
                  .catch(() => []);
                if (U.length === 0) break;
                for (const q of U) {
                  if ((I || (I = q.signature), k && q.signature === k)) {
                    P = !0;
                    break;
                  }
                  (D++, !q.err && !i.seen.has(q.signature) && h.push(q.signature));
                }
                if (P || U.length < 100) break;
                v = U[U.length - 1].signature;
              }
              I && i.newestByWallet.set(S, I);
            }),
            h.length === 0)
          )
            return;
          const g = await mapLimit(h, 8, S =>
              getTransactionAnyVersion(t, S).catch(() => null),
            ),
            _ = [];
          for (let S = 0; S < g.length; S++) {
            if (i.seen.has(h[S])) continue;
            const A = g[S];
            /* unread: NOT marked seen (newestByWallet already moved past it, so it was lost for good — a holder's
               buys missing from `spent` showed +1474 % on a real position); retried on the next read */
            if (!A?.meta) {
              i.retry.add(h[S]);
              continue;
            }
            i.seen.add(h[S]);
            for (const k of parseTxEvents(A)) {
              if (k.kind !== "trade" || k.mint.toBase58() !== a) continue;
              const v = k;
              _.push({
                sig: h[S],
                user: v.user.toBase58(),
                isBuy: v.isBuy,
                amount: v.isBuy
                  ? v.solAmount + v.fee + v.creatorFee + (v.cashback ?? 0n)
                  : v.solAmount - v.fee - v.creatorFee - (v.cashback ?? 0n),
              });
            }
          }
          i.trades = [..._, ...i.trades];
          i.complete = i.retry.size === 0;
        })().then(() => {
          i.scannedAt = Date.now();
        });
  historyInFlight.set(a, l);
  try {
    await l;
  } finally {
    historyInFlight.delete(a);
  }
  (n.balanceKey !== void 0 && !s && i.balanceKey !== n.balanceKey && ((i.balanceKey = n.balanceKey), (i.balanceKeyAt = Date.now())), historyCache.set(a, i));
  const u = new Map(),
    p = new Map(),
    f = (h, g, _) => h.set(g, (h.get(g) ?? 0n) + _);
  const sigs = new Map();
  for (const h of i.trades)
    r.has(h.user) && ((h.isBuy ? f(u, h.user, h.amount) : f(p, h.user, h.amount)), h.sig && sigs.set(h.user, [...(sigs.get(h.user) ?? []), h.sig]));
  return {
    spent: u,
    realised: p,
    sigs,
    complete: i.complete,
  };
}

/* signatures of every trade the wallet history of `mint` has counted (any wallet read so far): the ledger must have
   read them all before its figure replaces the live estimate (server/ledger.ts ledgerCovers) */
export function knownTradeSigs(mint, owners) {
  return (historyCache.get(mint)?.trades ?? []).filter(t => t.sig && owners.has(t.user)).map(t => t.sig);
}

/* --- Historique de trades de la COURBE (tout le marché) → chart + feed du terminal Solana.
   Caché + INCRÉMENTAL : au 1er appel on scanne le compte de la bonding-curve, ensuite on ne
   récupère que les signatures NOUVELLES (jusqu'à retomber sur la dernière vue). Sa demande du 19/09. */
var curveHistCache = new Map();
export async function curveTradeHistory(conn, mint, opts = {}) {
  const mintPk = mint instanceof PublicKey ? mint : new PublicKey(mint),
    mintStr = mintPk.toBase58(),
    curve = bondingCurvePda(mintPk),
    cache = curveHistCache.get(mintStr) ?? { trades: [], newest: null, seen: new Set(), pending: [], tries: new Map() },
    maxScan = Math.min(600, opts.max ?? 80), // 1er scan borné (anti-429), ensuite incrémental
    fresh = [];
  let before,
    firstSig,
    done = !1,
    scanned = 0;
  for (; !done && scanned < maxScan;) {
    const batch = await conn.getSignaturesForAddress(curve, { limit: 100, before }).catch(() => []);
    if (!batch.length) break;
    for (const s of batch) {
      firstSig || (firstSig = s.signature);
      if (cache.newest && s.signature === cache.newest) {
        done = !0;
        break;
      }
      (scanned++, !s.err && !cache.seen.has(s.signature) && fresh.push(s));
    }
    if (done || batch.length < 100) break;
    before = batch[batch.length - 1].signature;
  }
  if (firstSig) cache.newest = firstSig;
  /* `newest` moves past every listed signature, so one not read in this call (beyond the 30 read per call, or a
     getTransaction that answers null right after landing) waits in `pending` and is retried — it was lost for good
     before (marked seen unread). A signature still unreadable after 5 calls is dropped (pruned / never landed). */
  cache.pending ??= [];
  cache.tries ??= new Map();
  const queued = new Set(fresh.map(s => s.signature));
  const todo = [...fresh, ...cache.pending.filter(s => !queued.has(s.signature) && !cache.seen.has(s.signature))];
  if (todo.length) {
    const batch = todo.slice(0, 30);
    const txs = await mapLimit(batch, 2, s =>
      getTransactionAnyVersion(conn, s.signature).catch(() => null),
    );
    const nt = [];
    const retry = todo.slice(30);
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i],
        sig = batch[i].signature;
      if (!tx?.meta) {
        const n = (cache.tries.get(sig) ?? 0) + 1;
        n < 5 ? (cache.tries.set(sig, n), retry.push(batch[i])) : cache.tries.delete(sig);
        continue;
      }
      cache.seen.add(sig);
      cache.tries.delete(sig);
      for (const ev of parseTxEvents(tx)) {
        if (ev.kind !== "trade" || ev.mint.toBase58() !== mintStr) continue;
        const sol = Number(ev.solAmount) / 1e9,
          toks = Number(ev.tokenAmount) / 1e6;
        nt.push({
          side: ev.isBuy ? "buy" : "sell",
          wallet: ev.user.toBase58(),
          quoteEth: String(sol),
          priceEth: String(toks > 0 ? sol / toks : 0),
          blockTime: tx.blockTime ?? 0,
          block: tx.slot ?? 0,
          hash: sig,
        });
      }
    }
    cache.pending = retry.slice(0, 300);
    cache.trades = [...nt, ...cache.trades].slice(0, 500);
  }
  return (curveHistCache.set(mintStr, cache), cache.trades);
}

export async function readPositions(t, e, r, n = {}) {
  let a = new Set(r.map(M => M.owner.toBase58())),
    o = await t.getAccountInfo(bondingCurvePda(e)).catch(() => null),
    i = null,
    s = !1,
    c = null,
    d = 0n;
  if (o)
    try {
      const M = parseBondingCurve(o.data);
      ((s = !M.complete),
        (c = M.creator.toBase58()),
        (d = M.realSolReserves),
        (i = {
          virtualTokenReserves: M.virtualTokenReserves,
          virtualSolReserves: M.virtualSolReserves,
          realTokenReserves: M.realTokenReserves,
        }));
    } catch {}
  let l = await t.getAccountInfo(e).catch(() => null),
    u = tokenProgramFor(l?.owner.toBase58() ?? TOKEN_2022_PROGRAM),
    p = l ? parseMintMetadata(l.data) : null,
    f = await readSolanaBalances(
      t,
      r.map(M => M.owner.toBase58()),
      e.toBase58(),
      u,
    ).catch(() =>
      r.map(M => ({
        owner: M.owner.toBase58(),
        sol: 0n,
        tokens: null,
      })),
    ),
    h = f.map(M => `${M.owner}:${M.tokens ?? "x"}`).join("|"),
    {
      spent: g,
      realised: _,
      sigs: Z,
      complete: S,
    } = await walletTradeHistory(t, e, a, {
      ...n,
      tokenProgram: u,
      balanceKey: h,
    }),
    A = f.map(M => M.tokens),
    k = f.map(M => M.sol),
    v = i ? TOKEN_TOTAL_SUPPLY - i.realTokenReserves : 0n,
    I = i
      ? {
          ...i,
        }
      : null,
    P = r.map((M, H) => {
      let R = M.owner.toBase58(),
        m = A[H] !== null,
        w = A[H] ?? 0n,
        x = 0n;
      if (I && w > 0n) {
        x = solOutForTokens(w, I);
        const L = (w * I.virtualSolReserves) / (I.virtualTokenReserves + w);
        I = {
          virtualTokenReserves: I.virtualTokenReserves + w,
          virtualSolReserves: I.virtualSolReserves - L,
          realTokenReserves: I.realTokenReserves + w,
        };
      }
      const E = g.get(R) ?? 0n,
        T = _.get(R) ?? 0n,
        O = x + T - E;
      return {
        label: M.label,
        owner: R,
        tokens: w,
        balanceKnown: m,
        solBalance: k[H],
        supplyPct: v > 0n ? Number((w * 1000000n) / v) / 1e4 : null,
        isDev: c !== null && R === c,
        spent: E,
        realised: T,
        value: x,
        pnl: O,
        pnlPct: E > 0n ? Number((O * 10000n) / E) / 100 : null,
        tradeSigs: Z.get(R) ?? [],
      };
    }),
    D = M => P.reduce((H, R) => H + M(R), 0n),
    U = i && i.virtualTokenReserves > 0n ? (i.virtualSolReserves * 1000000n) / i.virtualTokenReserves : 0n,
    q = i ? INITIAL_REAL_TOKENS - i.realTokenReserves : 0n,
    F = i ? Math.max(0, Math.min(100, Number((q * 10000n) / INITIAL_REAL_TOKENS) / 100)) : 0;
  return {
    mint: e.toBase58(),
    onCurve: s,
    reserves: i,
    creator: c,
    name: p?.name ?? null,
    symbol: p?.symbol ?? null,
    priceLamports: U.toString(),
    realSolReserves: d.toString(),
    graduationThreshold: GRADUATION_SOL.toString(),
    graduationPct: F,
    positions: P,
    totals: {
      tokens: D(M => M.tokens),
      spent: D(M => M.spent),
      realised: D(M => M.realised),
      value: D(M => M.value),
      pnl: D(M => M.pnl),
    },
    historyComplete: S,
  };
}
