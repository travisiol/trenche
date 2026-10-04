import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createV2Instruction, generateMint } from "./create.js";
import { buyInstruction, randomBuybackFeeRecipient, randomFeeRecipient } from "./instructions.js";
import { FRESH_CURVE, buildBuyTx, buildSellTx, planBuys, planSells, signWith, tipInstruction } from "./math.js";
import { latestBlockhash, sendAndConfirm, sendBundleAndConfirm, sendMany } from "../send.js";
import {
  ATA_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  associatedTokenAddress,
  bondingCurvePda,
  parseBondingCurve,
  tokenProgramFor,
} from "./pdas.js";

var CREATE_CU_PRICE_MULT = 3;

function shortenIpfsUri(t) {
  const e = t.match(/^https?:\/\/[^/]+\/ipfs\/([A-Za-z0-9._-]+)\/?$/);
  return e ? `ipfs://${e[1]}` : t;
}

var meta = (t, e, r) => ({
  pubkey: t,
  isSigner: e,
  isWritable: r,
});

function createAtaInstruction(t, e, r, n) {
  return new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM),
    keys: [
      meta(t, !0, !0),
      meta(associatedTokenAddress(e, r, n), !1, !0),
      meta(e, !1, !1),
      meta(r, !1, !1),
      meta(new PublicKey(SYSTEM_PROGRAM), !1, !1),
      meta(n, !1, !1),
    ],
    data: Buffer.from([1]),
  });
}

export async function prepareLaunch(
  t,
  e,
  r,
  n = {
    cuPrice: 2e6,
  },
) {
  let a = e.mint ?? generateMint(e.vanitySuffix),
    o = new PublicKey(TOKEN_2022_PROGRAM),
    { blockhash: i, lastValidBlockHeight: s } = await latestBlockhash(t),
    c = n.slippageBps ?? 1e3,
    l = r.reduce((P, D) => Math.max(P, D.cuPrice ?? n.cuPrice), n.cuPrice) * CREATE_CU_PRICE_MULT,
    u = {
      label: "dev",
      signer: e.dev,
      solIn: e.devBuyLamports,
    },
    p = null,
    f = !1,
    h = !1,
    g = 0n;
  if (e.devBuyLamports > 0n) {
    const P = planBuys([u], FRESH_CURVE, c)[0],
      D = !!(n.tipLamports && n.tipLamports > 0n),
      U = (q, F) => {
        const M = [
            ComputeBudgetProgram.setComputeUnitLimit({
              units: 5e5,
            }),
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: l,
            }),
            createV2Instruction({
              mint: a.publicKey,
              user: e.dev.publicKey,
              creator: e.dev.publicKey,
              name: e.name,
              symbol: e.symbol,
              uri: q,
              cashback: e.cashback,
            }),
            createAtaInstruction(e.dev.publicKey, e.dev.publicKey, a.publicKey, o),
            ...(F ? [tipInstruction(e.dev.publicKey, n.tipLamports)] : []),
            buyInstruction(
              {
                mint: a.publicKey,
                user: e.dev.publicKey,
                creator: e.dev.publicKey,
                tokenProgram: o,
                feeRecipient: randomBuybackFeeRecipient(),
                buybackFeeRecipient: randomFeeRecipient(),
              },
              P.tokensWanted,
              P.maxSolCost,
            ),
          ],
          H = new TransactionMessage({
            payerKey: e.dev.publicKey,
            recentBlockhash: i,
            instructions: M,
          }).compileToV0Message(n.lookupTable ? [n.lookupTable] : []),
          R = new VersionedTransaction(H);
        return (R.sign([e.dev, a]), R);
      };
    if (n.lookupTable) {
      const q = U(e.uri, D);
      q.serialize().length <= 1232 && ((p = q), (f = !0), (h = D), (g = P.tokensWanted));
    }
    if (!p) {
      const q = U(shortenIpfsUri(e.uri), !1);
      q.serialize().length <= 1232 && ((p = q), (f = !0), (h = !1), (g = P.tokensWanted));
    }
  }
  if (!p) {
    const P = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 3e5,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: l,
      }),
      createV2Instruction({
        mint: a.publicKey,
        user: e.dev.publicKey,
        creator: e.dev.publicKey,
        name: e.name,
        symbol: e.symbol,
        uri: e.uri,
        cashback: e.cashback,
      }),
      ...(n.tipLamports && n.tipLamports > 0n ? [tipInstruction(e.dev.publicKey, n.tipLamports)] : []),
    ];
    ((p = new VersionedTransaction(
      new TransactionMessage({
        payerKey: e.dev.publicKey,
        recentBlockhash: i,
        instructions: P,
      }).compileToV0Message(),
    )),
      p.sign([e.dev, a]),
      (h = !!(n.tipLamports && n.tipLamports > 0n)));
  }
  const _ = e.devBuyLamports > 0n ? [u, ...r] : r,
    S = planBuys(_, FRESH_CURVE, c),
    A = f && e.devBuyLamports > 0n,
    k = A ? S.slice(1) : S,
    v = A ? _.slice(1) : _,
    I = k.map((P, D) =>
      signWith(
        buildBuyTx(
          {
            mint: a.publicKey,
            creator: e.dev.publicKey,
            tokenProgram: o,
            cuPrice: v[D].cuPrice ?? n.cuPrice,
            cuLimit: 13e4,
            ataExists: !1,
            tipLamports: n.tipLamports,
            recentBlockhash: i,
          },
          P,
        ),
        v[D].signer,
      ),
    );
  return (
    !f && e.devBuyLamports > 0n && (g = S[0].tokensWanted),
    {
      mint: a,
      createTx: p,
      atomic: f,
      createHasTip: h,
      buyTxs: I,
      buys: k,
      buyRows: v,
      retryOpts: {
        cuPrice: n.cuPrice,
        slippageBps: c,
        tipLamports: n.tipLamports,
      },
      devTokens: g,
      blockhash: i,
      lastValidBlockHeight: s,
    }
  );
}

export async function executeLaunch(t, e, r, n = {}) {
  const a = {
      lastValidBlockHeight: r.lastValidBlockHeight,
      dryRun: n.dryRun,
    },
    o = r.createHasTip ? e : t;
  if (n.dryRun) {
    const h = await sendAndConfirm(t, o, r.createTx, {
      ...a,
      simulateConn: t,
    });
    return {
      mint: r.mint.publicKey.toBase58(),
      create: h,
      buys: [],
      dryRun: !0,
      atomic: r.atomic,
    };
  }
  try {
    const h = await t.simulateTransaction(r.createTx, {
      commitment: "confirmed",
      sigVerify: !1,
      replaceRecentBlockhash: !1,
    });
    if (h.value.err) {
      const g = (h.value.logs ?? []).slice(-4).join(" | ");
      return {
        mint: r.mint.publicKey.toBase58(),
        create: {
          signature: "",
          broadcasts: 0,
          confirmed: !1,
          ms: 0,
          error: `simulation: ${JSON.stringify(h.value.err)}${g ? " \u2014 " + g : ""}`.slice(0, 300),
        },
        buys: [],
        dryRun: !1,
        atomic: r.atomic,
      };
    }
  } catch {}
  const s = o !== e && r.buyTxs.length > 0 ? o : e,
    c = sendAndConfirm(t, o, r.createTx, a),
    d = sendMany(t, s, r.buyTxs, {
      ...a,
      staggerMs: n.spreadMs,
    }),
    [l, u] = await Promise.all([c, d]),
    p = h => !h.confirmed && /IncorrectProgramId/.test(h.error ?? ""),
    f = u.map((h, g) => (p(h) ? g : -1)).filter(h => h >= 0);
  if (l.confirmed && f.length > 0) {
    const h = f.map(_ => r.buyRows[_]);
    (
      await snipeMint(t, e, r.mint.publicKey, h, {
        ...r.retryOpts,
        spreadMs: n.spreadMs,
      }).catch(_ => ({
        buys: [],
        error: _.message,
      }))
    ).buys.forEach((_, S) => {
      u[f[S]] = _;
    });
  }
  return {
    mint: r.mint.publicKey.toBase58(),
    create: l,
    buys: u,
    dryRun: !1,
    atomic: r.atomic,
  };
}

var sleepMs = t => new Promise(e => setTimeout(e, Math.max(0, t)));

/* --- Launch ÉCHELONNÉ (comme les tasks) ---------------------------------------------
   Le dev part ATOMIQUE avec la création (createTx) → tu es le 1er acheteur garanti. Puis
   tes wallets entrent UN PAR UN, chacun après un délai aléatoire dans [delayMinMs,
   delayMaxMs], chaque buy re-signé avec un blockhash frais (la fenêtre peut être longue).
   onStep() alimente le compteur temps réel. Sa demande du 18/09. */
export async function launchStaggered(readConn, sendConn, prep, sniperRows, opts = {}) {
  const onStep = typeof opts.onStep == "function" ? opts.onStep : () => {},
    created = await executeLaunch(readConn, sendConn, prep, {});
  onStep({ phase: "create", confirmed: created.create.confirmed, error: created.create.error });
  if (!created.create.confirmed)
    return { mint: created.mint, create: created.create, buys: [], atomic: created.atomic, mode: "staggered" };
  const mint = new PublicKey(created.mint),
    cap = v => Math.max(0, Math.min(600000, Number(v) || 0)),
    dMin = cap(opts.delayMinMs),
    dMax = Math.max(dMin, cap(opts.delayMaxMs)),
    gapFor = () => (dMax > 0 ? Math.round(dMin + Math.random() * (dMax - dMin)) : 0),
    buys = [];
  let first = !0,
    idx = 0;
  for (const row of sniperRows) {
    if (!first) {
      const gap = gapFor();
      gap > 0 && (onStep({ phase: "wait", index: idx, total: sniperRows.length, delayMs: gap }), await sleepMs(gap));
    }
    first = !1;
    const res = await snipeMint(readConn, sendConn, mint, [row], {
        cuPrice: opts.cuPrice,
        slippageBps: opts.slippageBps,
        tipLamports: opts.tipLamports,
      }).catch(err => ({ buys: [{ confirmed: !1, error: err.message }] })),
      b = res.buys?.[0] ?? { confirmed: !1, error: res.error || "no result" };
    (buys.push(b),
      onStep({
        phase: b.confirmed ? "sent" : "fail",
        index: idx,
        total: sniperRows.length,
        label: row.label,
        error: b.confirmed ? void 0 : b.error || res.error,
      }));
    idx++;
  }
  return { mint: created.mint, create: created.create, buys, atomic: created.atomic, mode: "staggered" };
}

/* --- Launch BUNDLE ATOMIQUE (Jito) --------------------------------------------------
   création+dev + tes wallets dans un (ou des) bundle(s) Jito : même slot, dans l'ordre,
   ou rien. Un sniper ne peut PAS s'insérer. prep doit être préparé AVEC les wallets et un
   tip. Un bundle = 5 tx max : au-delà, on découpe (le 1er bundle = création+dev+premiers
   wallets reste inséparable). Sa demande du 18/09. */
export async function launchBundle(readConn, prep, opts = {}) {
  const onStep = typeof opts.onStep == "function" ? opts.onStep : () => {},
    all = [prep.createTx, ...prep.buyTxs],
    chunks = [];
  for (let i = 0; i < all.length; i += 5) chunks.push(all.slice(i, i + 5));
  const buys = [],
    bundleErrors = [];
  let created = { confirmed: !1, error: "not sent" };
  for (let ci = 0; ci < chunks.length; ci++) {
    onStep({ phase: "bundle", index: ci, total: chunks.length });
    const r = await sendBundleAndConfirm(readConn, chunks[ci], {
        timeoutMs: opts.timeoutMs ?? 45000,
        blockEngineUrl: opts.blockEngineUrl,
      }),
      buyCount = chunks[ci].filter(tx => tx !== prep.createTx).length;
    (ci === 0 && (created = r.ok ? { confirmed: !0, signature: r.sigs[0] } : { confirmed: !1, error: r.error }));
    r.ok || bundleErrors.push(r.error);
    // Un compteur qui avance PAR WALLET (pas par bundle) : chaque buy du chunk landé.
    for (let k = 0; k < buyCount; k++) {
      (buys.push({ confirmed: r.ok, error: r.ok ? void 0 : r.error }),
        onStep({ phase: r.ok ? "sent" : "fail", index: buys.length - 1, bundle: !0, error: r.ok ? void 0 : r.error }));
    }
    if (ci === 0 && !r.ok) break;
  }
  return {
    mint: prep.mint.publicKey.toBase58(),
    create: created,
    buys,
    atomic: !0,
    mode: "bundle",
    bundleErrors,
  };
}

export async function snipeMint(t, e, r, n, a) {
  const o = await t.getAccountInfo(bondingCurvePda(r));
  if (!o)
    return {
      mint: r.toBase58(),
      buys: [],
      dryRun: !!a.dryRun,
      error: "Bonding curve not found (token graduated or wrong mint).",
    };
  const i = parseBondingCurve(o.data);
  if (i.complete)
    return {
      mint: r.toBase58(),
      buys: [],
      dryRun: !!a.dryRun,
      error: "Token graduated (PumpSwap): not supported here.",
    };
  const s = {
      virtualTokenReserves: i.virtualTokenReserves,
      virtualSolReserves: i.virtualSolReserves,
      realTokenReserves: i.realTokenReserves,
    },
    c = await t.getAccountInfo(r),
    d = tokenProgramFor(c?.owner.toBase58() ?? TOKEN_2022_PROGRAM),
    l = planBuys(n, s, a.slippageBps ?? 1e3),
    { blockhash: u, lastValidBlockHeight: p } = await latestBlockhash(t),
    f = l.map((g, _) =>
      signWith(
        buildBuyTx(
          {
            mint: r,
            creator: i.creator,
            tokenProgram: d,
            cuPrice: n[_].cuPrice ?? a.cuPrice,
            ataExists: !1,
            tipLamports: a.tipLamports,
            recentBlockhash: u,
          },
          g,
        ),
        n[_].signer,
      ),
    ),
    h = await sendMany(t, e, f, {
      lastValidBlockHeight: p,
      dryRun: a.dryRun,
      staggerMs: a.spreadMs,
    });
  return {
    mint: r.toBase58(),
    buys: h,
    dryRun: !!a.dryRun,
  };
}

export async function sellMint(t, e, r, n, a) {
  const o = await t.getAccountInfo(bondingCurvePda(r));
  if (!o)
    return {
      mint: r.toBase58(),
      sells: [],
      error: "Bonding curve not found (token graduated or wrong mint).",
    };
  const i = parseBondingCurve(o.data);
  if (i.complete)
    return {
      mint: r.toBase58(),
      sells: [],
      error: "Token graduated (PumpSwap): selling not supported here.",
    };
  const s = {
      virtualTokenReserves: i.virtualTokenReserves,
      virtualSolReserves: i.virtualSolReserves,
      realTokenReserves: i.realTokenReserves,
    },
    c = await t.getAccountInfo(r),
    d = tokenProgramFor(c?.owner.toBase58() ?? TOKEN_2022_PROGRAM),
    l = planSells(n, s, a.slippageBps ?? 1e3),
    { blockhash: u, lastValidBlockHeight: p } = await latestBlockhash(t),
    f = l.map((g, _) => {
      const S = buildSellTx(
        {
          mint: r,
          creator: i.creator,
          tokenProgram: d,
          cuPrice: a.cuPrice,
          tipLamports: a.tipLamports,
          recentBlockhash: u,
          cashback: i.isCashbackCoin,
        },
        g,
      );
      return (S.sign([n[_].signer]), S);
    }),
    h = await sendMany(t, e, f, {
      lastValidBlockHeight: p,
      staggerMs: a.spreadMs,
    });
  return {
    mint: r.toBase58(),
    sells: h,
  };
}
