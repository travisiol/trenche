import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ASTRALANE_TIP_ACCOUNTS, HELIUS_BUNDLE_TIP_ACCOUNTS, JITO_BUNDLE_TIP_ACCOUNTS, JITO_TIP_ACCOUNTS } from "../config.js";
import {
  ATA_PROGRAM,
  INITIAL_REAL_TOKENS,
  INITIAL_VIRTUAL_SOL,
  INITIAL_VIRTUAL_TOKENS,
  TOKEN_2022_PROGRAM,
  TOTAL_FEE_BPS,
  associatedTokenAddress,
} from "./pdas.js";
import { buyInstruction, randomBuybackFeeRecipient, randomFeeRecipient, sellInstruction } from "./instructions.js";

function feeOn(t, e = TOTAL_FEE_BPS) {
  return t <= 0n ? 0n : (t * e + 9999n) / 10000n;
}

function tokensOutForSol(t, e, r = TOTAL_FEE_BPS) {
  if (t <= 1n) return 0n;
  const n = ((t - 1n) * 10000n) / (r + 10000n),
    a = (n * e.virtualTokenReserves) / (e.virtualSolReserves + n);
  return a < e.realTokenReserves ? a : e.realTokenReserves;
}

export function solOutForTokens(t, e, r = TOTAL_FEE_BPS) {
  if (t <= 0n) return 0n;
  const n = (t * e.virtualSolReserves) / (e.virtualTokenReserves + t);
  return n - feeOn(n, r);
}

function afterBuy(t, e, r) {
  return {
    virtualTokenReserves: r.virtualTokenReserves - t,
    virtualSolReserves: r.virtualSolReserves + e,
    realTokenReserves: r.realTokenReserves - t,
  };
}

function sequentialBuyQuotes(t, e, r = TOTAL_FEE_BPS) {
  let n = {
    ...e,
  };
  return t.map(a => {
    const o = tokensOutForSol(a, n, r),
      i = a <= 1n ? 0n : ((a - 1n) * 10000n) / (r + 10000n);
    return ((n = afterBuy(o, i, n)), o);
  });
}

function afterSell(t, e, r) {
  return {
    virtualTokenReserves: r.virtualTokenReserves + t,
    virtualSolReserves: r.virtualSolReserves - e,
    realTokenReserves: r.realTokenReserves + t,
  };
}

function worstCaseSellQuotes(t, e, r = TOTAL_FEE_BPS) {
  const n = t.reduce((a, o) => a + o, 0n);
  return t.map(a => {
    const o = n - a,
      i = o > 0n ? (o * e.virtualSolReserves) / (e.virtualTokenReserves + o) : 0n,
      s = {
        virtualTokenReserves: e.virtualTokenReserves + o,
        virtualSolReserves: e.virtualSolReserves - i,
        realTokenReserves: e.realTokenReserves + o,
      };
    return solOutForTokens(a, s, r);
  });
}

function worstCaseBuyQuotes(t, e, r = TOTAL_FEE_BPS) {
  const n = t.reduce((a, o) => a + o, 0n);
  return t.map(a => {
    const o = n - a,
      i = o <= 0n ? 0n : ((o - 1n) * 10000n) / (r + 10000n),
      s = (i * e.virtualTokenReserves) / (e.virtualSolReserves + i),
      c = {
        virtualTokenReserves: e.virtualTokenReserves - s,
        virtualSolReserves: e.virtualSolReserves + i,
        realTokenReserves: e.realTokenReserves - s,
      };
    return tokensOutForSol(a, c, r);
  });
}

export var FRESH_CURVE = {
  virtualTokenReserves: INITIAL_VIRTUAL_TOKENS,
  virtualSolReserves: INITIAL_VIRTUAL_SOL,
  realTokenReserves: INITIAL_REAL_TOKENS,
};

export function planBuys(t, e = FRESH_CURVE, r = 1e3, n = TOTAL_FEE_BPS) {
  const a = t.map(c => c.solIn),
    o = sequentialBuyQuotes(a, e, n),
    i = worstCaseBuyQuotes(a, e, n),
    s = BigInt(Math.max(0, Math.min(9e3, Math.round(r))));
  return t.map((c, d) => ({
    label: c.label,
    owner: c.signer.publicKey,
    solIn: c.solIn,
    tokensWanted: i[d],
    maxSolCost: (c.solIn * (10000n + s)) / 10000n,
    expectedTokens: o[d],
  }));
}

function createAtaInstruction(t, e, r, n) {
  return new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM),
    keys: [
      {
        pubkey: t,
        isSigner: !0,
        isWritable: !0,
      },
      {
        pubkey: associatedTokenAddress(e, r, n),
        isSigner: !1,
        isWritable: !0,
      },
      {
        pubkey: e,
        isSigner: !1,
        isWritable: !1,
      },
      {
        pubkey: r,
        isSigner: !1,
        isWritable: !1,
      },
      {
        pubkey: SystemProgram.programId,
        isSigner: !1,
        isWritable: !1,
      },
      {
        pubkey: n,
        isSigner: !1,
        isWritable: !1,
      },
    ],
    data: Buffer.from([1]),
  });
}

export function buildBuyTx(t, e) {
  const r = t.tokenProgram ?? new PublicKey(TOKEN_2022_PROGRAM),
    n = t.cuLimit ?? (t.ataExists ? 105e3 : 13e4),
    a = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: n,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: t.cuPrice,
      }),
      ...(t.ataExists ? [] : [createAtaInstruction(e.owner, e.owner, t.mint, r)]),
      ...(t.tipLamports && t.tipLamports > 0n ? [tipInstruction(e.owner, t.tipLamports, void 0, t.jitoTip ?? !1)] : []),
      buyInstruction(
        {
          mint: t.mint,
          user: e.owner,
          creator: t.creator,
          tokenProgram: r,
          feeRecipient: randomBuybackFeeRecipient(),
          buybackFeeRecipient: randomFeeRecipient(),
        },
        e.tokensWanted,
        e.maxSolCost,
      ),
    ],
    o = new TransactionMessage({
      payerKey: e.owner,
      recentBlockhash: t.recentBlockhash,
      instructions: a,
    }).compileToV0Message();
  return new VersionedTransaction(o);
}

/** tip transfer: `jito` = a transaction of a Jito bundle (block-engine tip accounts), else Helius Sender's */
export function tipInstruction(t, e, r, jito = !1) {
  // jito: true = Jito block-engine tip accounts, "astralane" = Astralane's, "helius" = Helius sendBundle's, false = Helius Sender's
  const list = jito === "astralane" ? ASTRALANE_TIP_ACCOUNTS : jito === "helius" ? HELIUS_BUNDLE_TIP_ACCOUNTS : jito ? JITO_BUNDLE_TIP_ACCOUNTS : JITO_TIP_ACCOUNTS,
    n = (r ?? Math.floor(Math.random() * list.length)) % list.length;
  return SystemProgram.transfer({
    fromPubkey: t,
    toPubkey: new PublicKey(list[n]),
    lamports: e,
  });
}

export function signWith(t, e) {
  return (t.sign([e]), t);
}

export function planSells(t, e, r = 1e3, n = TOTAL_FEE_BPS) {
  const a = t.map(c => c.tokens),
    o = sequentialSellQuotes(a, e, n),
    i = worstCaseSellQuotes(a, e, n),
    s = BigInt(Math.max(0, Math.min(9e3, Math.round(r))));
  return t.map((c, d) => ({
    label: c.label,
    owner: c.signer.publicKey,
    tokens: c.tokens,
    minSolOutput: (i[d] * (10000n - s)) / 10000n,
    expectedSol: o[d],
  }));
}

function sequentialSellQuotes(t, e, r) {
  let n = {
    ...e,
  };
  return t.map(a => {
    const o = (a * n.virtualSolReserves) / (n.virtualTokenReserves + a),
      i = solOutForTokens(a, n, r);
    return ((n = afterSell(a, o, n)), i);
  });
}

export function buildSellTx(t, e) {
  const r = t.tokenProgram ?? new PublicKey(TOKEN_2022_PROGRAM),
    n = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: t.cuLimit ?? 105e3,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: t.cuPrice,
      }),
      sellInstruction(
        {
          mint: t.mint,
          user: e.owner,
          creator: t.creator,
          tokenProgram: r,
          feeRecipient: randomBuybackFeeRecipient(),
          buybackFeeRecipient: randomFeeRecipient(),
        },
        e.tokens,
        e.minSolOutput,
        t.cashback,
      ),
      ...(t.tipLamports && t.tipLamports > 0n ? [tipInstruction(e.owner, t.tipLamports, void 0, t.jitoTip ?? !1)] : []),
    ];
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: e.owner,
      recentBlockhash: t.recentBlockhash,
      instructions: n,
    }).compileToV0Message(),
  );
}
