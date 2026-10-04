import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { parseEventLogs } from "./events.js";
import { PUMP_AMM_PROGRAM, TOKEN_PROGRAM, associatedTokenAddress, creatorVaultPda, userVolumePda } from "./pdas.js";
import { claimCashbackInstruction, collectCreatorFeeInstruction } from "./instructions.js";
import { tipInstruction } from "./math.js";
import { latestBlockhash, sendAndConfirm } from "../send.js";

var WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

function ammCreatorVaultAta(t) {
  const [e] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), t.toBuffer()],
    new PublicKey(PUMP_AMM_PROGRAM),
  );
  return associatedTokenAddress(e, WSOL_MINT, new PublicKey(TOKEN_PROGRAM));
}

var VAULT_RENT_LAMPORTS = 650240n, // getMinimumBalanceForRentExemption(0) on mainnet, verified 2026-10-05 (was 890880 in the original build: hid up to 0.00024 SOL of pending fees)
  CLAIM_CU_PER_WALLET = 16e3;

export async function readPumpCreatorFees(t, e) {
  if (e.length === 0) return [];
  const r = e.map(c => new PublicKey(c.address)),
    n = r.map(creatorVaultPda),
    a = r.map(userVolumePda),
    o = r.map(ammCreatorVaultAta),
    i = await t.getMultipleAccountsInfo([...n, ...a, ...o], "confirmed"),
    s = e.length;
  return e.map((c, d) => {
    const l = BigInt(i[d]?.lamports ?? 0),
      u = l > VAULT_RENT_LAMPORTS ? l - VAULT_RENT_LAMPORTS : 0n;
    return {
      label: c.label,
      owner: c.address,
      vault: n[d].toBase58(),
      lamports: l,
      claimable: u,
      cashback: readCashback(i[s + d]?.data),
      ammPending: readAmmPending(i[2 * s + d]?.data),
    };
  });
}

function readCashback(t) {
  if (!t || t.length < 90) return 0n;
  const e = Buffer.from(t);
  try {
    return e.readBigUInt64LE(82);
  } catch {
    return 0n;
  }
}

function readAmmPending(t) {
  if (!t || t.length < 72) return 0n;
  try {
    return Buffer.from(t).readBigUInt64LE(64);
  } catch {
    return 0n;
  }
}

function buildClaimTx(t, e, r) {
  const n = r.cashbackFor ?? [],
    a = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1e4 + CLAIM_CU_PER_WALLET * (e.length + n.length),
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: r.cuPrice,
      }),
      ...(r.tipLamports && r.tipLamports > 0n ? [tipInstruction(t.publicKey, r.tipLamports)] : []),
      ...e.map(collectCreatorFeeInstruction),
      ...n.map(claimCashbackInstruction),
    ],
    o = new VersionedTransaction(
      new TransactionMessage({
        payerKey: t.publicKey,
        recentBlockhash: r.recentBlockhash,
        instructions: a,
      }).compileToV0Message(),
    );
  return (o.sign([t]), o);
}

export async function claimPumpCreatorFees(t, e, r, n, a) {
  const o = n.filter(p => p.claimable > 0n || p.cashback > 0n);
  if (o.length === 0)
    return {
      claimed: [],
      total: 0n,
      sends: [],
      error: "No fees to claim.",
    };
  let { blockhash: i, lastValidBlockHeight: s } = await latestBlockhash(t),
    c = p =>
      buildClaimTx(
        r,
        p.filter(f => f.claimable > 0n).map(f => new PublicKey(f.owner)),
        {
          cuPrice: a.cuPrice,
          tipLamports: a.tipLamports,
          recentBlockhash: i,
          cashbackFor: p.filter(f => f.cashback > 0n).map(f => new PublicKey(f.owner)),
        },
      ),
    d = [],
    l = [];
  for (const p of o) {
    const f = [...l, p];
    c(f).serialize().length > 1232 && l.length > 0 ? (d.push(l), (l = [p])) : (l = f);
  }
  l.length && d.push(l);
  const u = [];
  for (const p of d)
    u.push(
      await sendAndConfirm(t, e, c(p), {
        lastValidBlockHeight: s,
        simulateConn: t,
      }),
    );
  return {
    claimed: o.map(p => ({
      label: p.label,
      owner: p.owner,
      lamports: p.claimable + p.cashback,
    })),
    total: o.reduce((p, f) => p + f.claimable + f.cashback, 0n),
    sends: u,
  };
}

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

export async function scanFeesHistory(t, e, r, n = {}) {
  let a = r
      ? {
          ...r,
          claims: [...r.claims],
          perMint: {
            ...r.perMint,
          },
        }
      : {
          newest: null,
          complete: !0,
          claims: [],
          perMint: {},
        },
    o = n.maxSignatures ?? 1500,
    i = creatorVaultPda(new PublicKey(e)),
    s = [],
    c,
    d = a.newest === null;
  e: for (;;) {
    let h = null;
    for (let _ = 0; _ < 3 && h === null; _++)
      ((h = await t
        .getSignaturesForAddress(i, {
          limit: 100,
          before: c,
        })
        .catch(() => null)),
        h === null && (await new Promise(S => setTimeout(S, 400 * 2 ** _))));
    if (h === null) return r ?? a;
    const g = h;
    if (g.length === 0) break;
    for (const _ of g) {
      if (a.newest && _.signature === a.newest) {
        d = !0;
        break e;
      }
      _.err || s.push(_.signature);
    }
    if (g.length < 100) break;
    c = g[g.length - 1].signature;
  }
  if ((d || (a.complete = !1), s.length === 0)) return ((a.complete = a.complete && !0), a);
  const l = s.slice(-o),
    u = await mapLimit(l, 6, h =>
      t
        .getTransaction(h, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        })
        .catch(() => null),
    ),
    p = (h, g) => {
      const _ = a.perMint[h] ?? {
        revenue: "0",
        trades: 0,
      };
      a.perMint[h] = {
        revenue: (BigInt(_.revenue) + g).toString(),
        trades: _.trades + 1,
      };
    },
    f = new Set(a.claims.map(h => h.sig));
  for (let h = 0; h < u.length; h++) {
    const g = u[h];
    if (g?.meta?.logMessages) {
      for (const _ of parseEventLogs(g.meta.logMessages))
        if (_.kind === "trade") {
          const S = _;
          if (S.creator.toBase58() !== e) continue;
          S.creatorFee > 0n && p(S.mint.toBase58(), S.creatorFee);
        } else if (_.kind === "collectCreatorFee") {
          const S = _;
          if (S.creator.toBase58() !== e) continue;
          f.has(l[h]) ||
            a.claims.push({
              ts: Number(S.timestamp) * 1e3,
              sig: l[h],
              amount: S.amount.toString(),
            });
        }
    }
  }
  return (a.claims.sort((h, g) => g.ts - h.ts), (a.newest = l[0]), (a.complete = s.length <= o), a);
}
