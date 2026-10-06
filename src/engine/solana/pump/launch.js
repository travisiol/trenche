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
import { latestBlockhash, preflightBundle, sendAndConfirm, sendBundleAndConfirm, sendMany } from "../send.js";
import { base58Encode } from "../keys.js";
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
    // a warm blockhash (server hot cache) saves one RPC round trip on the click path
    { blockhash: i, lastValidBlockHeight: s } = n.recentBlockhash ?? (await latestBlockhash(t)),
    c = n.slippageBps ?? 1e3,
    // the create must outrank its own buys (a buy scheduled before it fails): ×3 the base price, and ≥ 1.5× the
    // highest buy price (bundle buys at 10 M → create at 15 M, not 30 M)
    l = Math.max(n.cuPrice * CREATE_CU_PRICE_MULT, Math.ceil(r.reduce((P, D) => Math.max(P, D.cuPrice ?? n.cuPrice), 0) * 1.5)),
    u = {
      label: "dev",
      signer: e.dev,
      solIn: e.devBuyLamports,
    },
    p = null,
    f = !1,
    h = !1,
    g = 0n;
  /* INLINE BUYERS (2026-10-05) : jusqu'à `inlineMax` wallets du bundle achètent DANS la transaction de création,
     juste derrière la dev — même atomicité que le dev buy, aucun sniper ne peut s'intercaler. Le nombre réel est
     le plus grand qui tient dans 1232 octets (les lookup tables `lookupTables` le font passer de 0 à 3). Les
     acheteurs signent la création ; la dev paie les frais de la transaction, chaque acheteur son ATA et son achat. */
  const tables = Array.isArray(n.lookupTables) ? n.lookupTables.filter(Boolean) : n.lookupTable ? [n.lookupTable] : [],
    hasDevBuy = e.devBuyLamports > 0n,
    inlineMax = Math.max(0, Math.min(r.length, Math.floor(n.inlineMax ?? 0))),
    _ = hasDevBuy ? [u, ...r] : r,
    S = planBuys(_, FRESH_CURVE, c),
    devPlan = hasDevBuy ? S[0] : null,
    rowPlans = hasDevBuy ? S.slice(1) : S,
    D = !!(n.tipLamports && n.tipLamports > 0n),
    feeRecipient = randomBuybackFeeRecipient(),
    buybackFeeRecipient = randomFeeRecipient(),
    buyIxs = (signer, plan) => [
      createAtaInstruction(signer.publicKey, signer.publicKey, a.publicKey, o),
      buyInstruction({ mint: a.publicKey, user: signer.publicKey, creator: e.dev.publicKey, tokenProgram: o, feeRecipient, buybackFeeRecipient }, plan.tokensWanted, plan.maxSolCost),
    ],
    U = (q, F, j) => {
      const signers = r.slice(0, j).map(x => x.signer),
        M = [
          // priority is paid on the LIMIT: measured create + dev buy 187-193 k CU, + ~86 k per inline buyer (devnet, 2026-10-06)
          ComputeBudgetProgram.setComputeUnitLimit({ units: (hasDevBuy ? 26e4 : 15e4) + j * 12e4 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: l }),
          createV2Instruction({ mint: a.publicKey, user: e.dev.publicKey, creator: e.dev.publicKey, name: e.name, symbol: e.symbol, uri: q, cashback: e.cashback }),
          ...(F ? [tipInstruction(e.dev.publicKey, n.tipLamports, void 0, n.jitoTip ?? !1)] : []),
          ...(hasDevBuy ? buyIxs(e.dev, devPlan) : []),
          ...signers.flatMap((x, k) => buyIxs(x, rowPlans[k])),
        ],
        R = new VersionedTransaction(new TransactionMessage({ payerKey: e.dev.publicKey, recentBlockhash: i, instructions: M }).compileToV0Message(tables));
      return (R.sign([e.dev, a, ...signers]), R);
    },
    fits = tx => {
      try {
        return tx.serialize().length <= 1232;
      } catch {
        return !1;
      }
    },
    variants = tables.length ? [[e.uri, D], [shortenIpfsUri(e.uri), D], [shortenIpfsUri(e.uri), !1]] : [[shortenIpfsUri(e.uri), !1]];
  let inline = 0;
  if (hasDevBuy || inlineMax > 0)
    for (let j = inlineMax; j >= 0 && !p; j--) {
      if (!hasDevBuy && j === 0) break;
      for (const [q, F] of variants) {
        let tx = null;
        try {
          tx = U(q, F, j);
        } catch {
          tx = null;
        }
        if (tx && fits(tx)) {
          ((p = tx), (f = hasDevBuy || j > 0), (h = F), (inline = j), (g = devPlan ? devPlan.tokensWanted : 0n));
          break;
        }
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
      ...(D ? [tipInstruction(e.dev.publicKey, n.tipLamports, void 0, n.jitoTip ?? !1)] : []),
    ];
    ((p = new VersionedTransaction(
      new TransactionMessage({
        payerKey: e.dev.publicKey,
        recentBlockhash: i,
        instructions: P,
      }).compileToV0Message(),
    )),
      p.sign([e.dev, a]),
      (h = D));
  }
  // atomic: the dev buy (when any) and the first `inline` rows are inside the create; the rest buys in its own txs.
  // not atomic (nothing fit): the dev buy too goes as a separate transaction, first of the list
  const devInside = f && hasDevBuy,
    k = f ? rowPlans.slice(inline) : S,
    v = f ? r.slice(inline) : _,
    I = k.map((P, x) =>
      signWith(
        buildBuyTx(
          {
            mint: a.publicKey,
            creator: e.dev.publicKey,
            tokenProgram: o,
            cuPrice: v[x].cuPrice ?? n.cuPrice,
            cuLimit: 13e4,
            ataExists: !1,
            // Jito: ONE tip per bundle of 5 = [create, b0..b3], [b4..b8]… on the LAST tx of each bundle (Jito's advice),
            // or on the create when it already carries one (with lookup tables only — without, it has no room: a launch
            // bundle with no tip at all was refused "must write lock at least one tip account", 2026-10-06). Every tx
            // tipping paid it 2–5 times. Sender (no Jito) needs its tip on every tx.
            // Astralane: EVERY tx of a bundle tips (their rule), bundles of 4
            tipLamports: n.jitoTip === "astralane" ? n.tipLamports : n.jitoTip ? (((x + 2) % 5 === 0 || x === k.length - 1) && !(x <= 3 && h) ? n.tipLamports : 0n) : n.tipLamports,
            jitoTip: n.jitoTip ?? !1,
            recentBlockhash: i,
          },
          P,
        ),
        v[x].signer,
      ),
    );
  return (
    !devInside && hasDevBuy && (g = S[0].tokensWanted),
    {
      mint: a,
      createTx: p,
      atomic: devInside,
      inline,
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

/* La création est confirmée par signature, puis — si la fenêtre du blockhash se ferme sans réponse
   (RPC 429) — par l'EXISTENCE de la bonding curve (opts via sendAndConfirm `verify`) ; si elle n'a
   vraiment pas atterri, re-signée avec un blockhash frais (`rebuildCreate`, 2 fois max). Les buys
   expirés sont ensuite prouvés par leur solde de tokens, sinon renvoyés avec un blockhash frais. */
export async function executeLaunch(t, e, r, n = {}) {
  const note = typeof n.onNote == "function" ? n.onNote : () => {},
    mintPk = r.mint.publicKey,
    curveExists = async () => !!(await t.getAccountInfo(bondingCurvePda(mintPk), "confirmed").catch(() => null)),
    a = {
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
      mint: mintPk.toBase58(),
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
        mint: mintPk.toBase58(),
        create: {
          signature: "",
          broadcasts: 0,
          confirmed: !1,
          ms: 0,
          error: `simulation: ${JSON.stringify(h.value.err)}${g ? " — " + g : ""}`.slice(0, 300),
        },
        buys: [],
        dryRun: !1,
        atomic: r.atomic,
      };
    }
  } catch {}
  /* Buys in their own transactions go out the moment the create is SEEN (processed), not with it: sent together,
     one landed before the create and failed, then its retry came 10 slots late behind a sniper (Cghynn…pump,
     2026-10-06). A buy held back past 20 s is reported expired: the retry below re-sends it once the create landed. */
  /* Confirmation by push (n.watch = WebSocket signatureSubscribe, processed + confirmed) with a flat 400 ms poll as the
     safety net: the old poll grew ×1.35 up to 2.5 s and saw BkzF3c…'s create ~4 s after it landed. */
  const createSig = base58Encode(r.createTx.signatures[0]),
    watch = typeof n.watch == "function" ? n.watch : null,
    createWatch = watch ? watch(createSig) : null,
    never = new Promise(() => {}),
    createSeen = async () => {
      let stop = !1;
      const viaPush = createWatch ? createWatch.processed.then(v => (v ? !v.err : never)) : never,
        viaPoll = (async () => {
          const t0 = Date.now();
          for (let i = 0; !stop && Date.now() - t0 < 20000; i++) {
            const st = (await t.getSignatureStatuses([createSig]).catch(() => null))?.value?.[0];
            if (st) return !st.err;
            if (i % 5 === 4 && (await curveExists().catch(() => !1))) return !0;
            await sleepMs(200);
          }
          return !1;
        })(),
        seen = await Promise.race([viaPush, viaPoll]);
      stop = !0;
      return seen;
    },
    s = o !== e && r.buyTxs.length > 0 ? o : e,
    t0 = Date.now(),
    c = sendAndConfirm(t, o, r.createTx, {
      ...a,
      verify: curveExists,
      rebuild: n.rebuildCreate,
      onSent: n.onSent,
      subscribe: watch ? sig => (sig === createSig ? createWatch.confirmed : watch(sig).confirmed) : void 0,
      pollMs: watch ? 1000 : 400,
      pollFallbackMs: 400,
      pollGrowth: 1,
      rebroadcastEveryMs: 1000,
    }),
    seenP = createSeen(),
    d = r.buyTxs.length
      ? seenP.then(ok =>
          ok
            ? sendMany(t, s, r.buyTxs, { ...a, staggerMs: n.spreadMs })
            : r.buyTxs.map(() => ({ signature: "", broadcasts: 0, confirmed: !1, ms: 0, expired: !0, error: "held back: the create was not seen yet" })),
        )
      : Promise.resolve([]);
  if (typeof n.onSeen == "function") seenP.then(ok => ok && n.onSeen(Date.now() - t0)).catch(() => {});
  const [l, u] = await Promise.all([c, d]);
  if (l.recovered) note(l.recovered === "history" ? "Create found in the transaction history after the confirmation window (RPC was rate-limited)." : "Create proven by the bonding curve on chain after the confirmation window.");
  if (l.rebuilds) note(`Create re-signed with a fresh blockhash (${l.rebuilds}×).`);
  // buys not confirmed for a non-final reason (expired / unreadable / wrong program id before the curve existed):
  // a wallet that already holds tokens DID buy; the others are re-sent with a fresh blockhash
  const retryable = h => !h.confirmed && (h.expired || /IncorrectProgramId|not found|timed out|rate-limited|unreachable/i.test(h.error ?? "")),
    f = u.map((h, g) => (retryable(h) ? g : -1)).filter(h => h >= 0);
  if (l.confirmed && f.length > 0) {
    const tokenProgram = new PublicKey(TOKEN_2022_PROGRAM),
      atas = f.map(_ => associatedTokenAddress(r.buyRows[_].signer.publicKey, mintPk, tokenProgram)),
      infos = await t.getMultipleAccountsInfo(atas, "confirmed").catch(() => null),
      toRetry = [];
    f.forEach((_, S) => {
      let held = 0n;
      try {
        if (infos?.[S]?.data) held = Buffer.from(infos[S].data).readBigUInt64LE(64);
      } catch {}
      if (held > 0n) {
        u[_] = { ...u[_], confirmed: !0, error: void 0, recovered: "verify" };
        note(`${r.buyRows[_].label}: buy proven by its token balance after the confirmation window.`);
      } else toRetry.push(_);
    });
    if (toRetry.length) {
      note(`${toRetry.length} buy(s) never landed — re-sent with a fresh blockhash.`);
      const h = toRetry.map(_ => r.buyRows[_]);
      (
        await snipeMint(t, e, mintPk, h, {
          ...r.retryOpts,
          spreadMs: n.spreadMs,
        }).catch(_ => ({
          buys: [],
          error: _.message,
        }))
      ).buys.forEach((_, S) => {
        u[toRetry[S]] = _;
      });
    }
  }
  return {
    mint: mintPk.toBase58(),
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
  const per = Math.max(1, Math.min(5, opts.maxPerBundle ?? 5)); // Jito 5, Astralane 4
  for (let i = 0; i < all.length; i += per) chunks.push(all.slice(i, i + per));
  const buys = [],
    bundleErrors = [];
  let created = { confirmed: !1, error: "not sent" };
  // Jito silently drops a bundle whose tx fails or is badly signed: signatures + simulateBundle first (see preflightBundle)
  const pre = await preflightBundle(readConn, chunks[0]).catch(() => ({ error: null, simulated: !1 }));
  if (pre.error) return { mint: prep.mint.publicKey.toBase58(), create: { confirmed: !1, error: `${pre.error} Nothing was sent.` }, buys: [], atomic: !0, mode: "bundle", bundleErrors: [] };
  if (typeof opts.onStep == "function") opts.onStep({ phase: "preflight", index: 0, simulated: pre.simulated });
  // without simulateBundle on the RPC, at least the create (it depends on nothing in the bundle) is simulated alone
  const sim = pre.simulated ? null : await readConn.simulateTransaction(prep.createTx, { sigVerify: !1, replaceRecentBlockhash: !0, commitment: "processed" }).catch(() => null);
  if (sim?.value?.err) {
    const why = (sim.value.logs ?? []).filter(l => /error|failed|exceeded|insufficient/i.test(l)).slice(-3).join(" · ");
    return { mint: prep.mint.publicKey.toBase58(), create: { confirmed: !1, error: `The create transaction fails simulation: ${JSON.stringify(sim.value.err)}${why ? ` — ${why}` : ""}. Nothing was sent.` }, buys: [], atomic: !0, mode: "bundle", bundleErrors: [] };
  }
  for (let ci = 0; ci < chunks.length; ci++) {
    onStep({ phase: "bundle", index: ci, total: chunks.length });
    const r = await sendBundleAndConfirm(readConn, chunks[ci], {
        timeoutMs: opts.timeoutMs ?? 45000,
        blockEngineUrl: opts.blockEngineUrl,
        astralane: opts.astralane,
        // the first bundle holds the create: after the window, the curve's existence proves it landed (RPC 429 ≠ lost)
        verify: ci === 0 ? async () => !!(await readConn.getAccountInfo(bondingCurvePda(prep.mint.publicKey), "confirmed").catch(() => null)) : void 0,
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
