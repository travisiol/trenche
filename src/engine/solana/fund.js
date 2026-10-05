import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { latestBlockhash, sendAndConfirm } from "./send.js";

var sleep = t => new Promise(e => setTimeout(e, Math.max(0, t)));

// Un transfert SOL signé + confirmé (kp paie les frais). Réutilisé par le fund direct et le 2-hop.
async function solTransfer(conn, sendConn, kp, to, lamports, cuPrice = 0) {
  const dest = to instanceof PublicKey ? to : new PublicKey(to),
    { blockhash, lastValidBlockHeight } = await latestBlockhash(conn),
    ixs = [];
  (cuPrice > 0 && ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice })),
    ixs.push(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports: Number(lamports) })));
  const tx = new VersionedTransaction(
    new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(),
  );
  return (tx.sign([kp]), sendAndConfirm(conn, sendConn, tx, { lastValidBlockHeight }));
}

/* --- Fund wallets (Solana) ----------------------------------------------------------
   Un wallet source envoie du SOL vers N wallets choisis. Montant déjà tiré par wallet
   (aléatoire Min–Max côté client) ; chaque envoi part après un délai ALÉATOIRE dans la
   fourchette [delayMinMs, delayMaxMs] pour que ça ne parte pas en une rafale évidente.
   onStep() alimente le compteur temps réel. Blockhash rafraîchi à chaque envoi (la
   fenêtre peut dépasser la durée de vie d'un blockhash). Sa demande du 18/09. */
export async function distributeSol(opts) {
  const { conn, sendConn, fromKeypair, plan } = opts,
    step = typeof opts.onStep == "function" ? opts.onStep : () => {},
    cap = v => Math.max(0, Math.min(600000, Number(v) || 0)),
    dMin = cap(opts.delayMinMs),
    dMax = Math.max(dMin, cap(opts.delayMaxMs)),
    cuPrice = Math.max(0, Number(opts.cuPrice) || 0),
    gapFor = () => (dMax > 0 ? Math.round(dMin + Math.random() * (dMax - dMin)) : 0),
    results = [];
  let first = !0,
    idx = 0,
    sent = 0;
  for (const p of plan) {
    if (!first) {
      const gap = gapFor();
      gap > 0 && (step({ phase: "wait", index: idx, total: plan.length, delayMs: gap }), await sleep(gap));
    }
    first = !1;
    const to = p.address instanceof PublicKey ? p.address : new PublicKey(p.address),
      addr = to.toBase58(),
      sol = (Number(p.lamports) / 1e9).toFixed(6);
    try {
      const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn),
        ixs = [];
      (cuPrice > 0 && ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice })),
        ixs.push(
          SystemProgram.transfer({
            fromPubkey: fromKeypair.publicKey,
            toPubkey: to,
            lamports: Number(p.lamports),
          }),
        ));
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: fromKeypair.publicKey,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message(),
      );
      tx.sign([fromKeypair]);
      const r = await sendAndConfirm(conn, sendConn, tx, { lastValidBlockHeight }),
        ok = r.confirmed;
      (results.push({ address: addr, sol, ok, signature: r.signature, error: ok ? void 0 : r.error }),
        ok && sent++,
        step({
          phase: ok ? "sent" : "fail",
          index: idx,
          total: plan.length,
          address: addr,
          sol,
          signature: r.signature,
          error: ok ? void 0 : r.error,
        }));
    } catch (err) {
      (results.push({ address: addr, sol, ok: !1, error: err.message }),
        step({ phase: "fail", index: idx, total: plan.length, address: addr, sol, error: err.message }));
    }
    idx++;
  }
  return { results, sent, total: plan.length };
}

/* --- Fund wallets « 2-hop » (privacy) --------------------------------------------------
   La source ne finance JAMAIS directement tes wallets : pour chaque destinataire on génère
   un wallet-relais JETABLE (clé en mémoire, jamais dans le coffre), source → relais → dest.
   Montants exacts pour que le relais finisse à 0 (aucune poussière perdue). Ça casse le lien
   VISIBLE source→wallets (pas de confidentialité crypto façon zk, mais on n'est plus pisté /
   front-runnable via la source). Sa demande du 19/09. */
export async function distributeSolTwoHop(opts) {
  const { conn, sendConn, fromKeypair, plan } = opts,
    step = typeof opts.onStep == "function" ? opts.onStep : () => {},
    cap = v => Math.max(0, Math.min(600000, Number(v) || 0)),
    dMin = cap(opts.delayMinMs),
    dMax = Math.max(dMin, cap(opts.delayMaxMs)),
    cuPrice = Math.max(0, Number(opts.cuPrice) || 0),
    gapFor = () => (dMax > 0 ? Math.round(dMin + Math.random() * (dMax - dMin)) : 0),
    FEE = 5000n, // frais réseau d'un transfert (le relais paie ceux du 2e saut)
    results = [];
  let first = !0,
    idx = 0,
    sent = 0;
  for (const p of plan) {
    if (!first) {
      const gap = gapFor();
      gap > 0 && (step({ phase: "wait", index: idx, total: plan.length, delayMs: gap }), await sleep(gap));
    }
    first = !1;
    const dest = p.address instanceof PublicKey ? p.address : new PublicKey(p.address),
      addr = dest.toBase58(),
      amount = BigInt(p.lamports),
      sol = (Number(amount) / 1e9).toFixed(6),
      hop = Keypair.generate();
    try {
      // 1) source → relais jetable : montant + les frais du 2e saut
      const r1 = await solTransfer(conn, sendConn, fromKeypair, hop.publicKey, amount + FEE, cuPrice);
      if (!r1.confirmed) {
        (results.push({ address: addr, sol, ok: !1, error: "hop 1/2: " + (r1.error || "not confirmed") }),
          step({ phase: "fail", index: idx, total: plan.length, address: addr, sol, error: r1.error }),
          idx++);
        continue;
      }
      // 2) relais → destination : montant exact (le relais finit à 0). Retry si besoin ; en tout
      //    dernier recours on RAPATRIE le SOL vers la source pour ne RIEN perdre (clé du relais jetée).
      let r2 = await solTransfer(conn, sendConn, hop, dest, amount, 0);
      if (!r2.confirmed) r2 = await solTransfer(conn, sendConn, hop, dest, amount, cuPrice); // retry, blockhash frais
      const ok = r2.confirmed;
      let recovered = !1;
      if (!ok) {
        const hb = BigInt(await conn.getBalance(hop.publicKey, "confirmed").catch(() => 0));
        if (hb > FEE) recovered = (await solTransfer(conn, sendConn, hop, fromKeypair.publicKey, hb - FEE, 0)).confirmed;
      }
      (results.push({
        address: addr,
        sol,
        ok,
        signature: r2.signature,
        error: ok ? void 0 : `hop 2/2 failed${recovered ? " — funds returned to source" : " — funds still in the relay"}`,
      }),
        ok && sent++,
        step({
          phase: ok ? "sent" : "fail",
          index: idx,
          total: plan.length,
          address: addr,
          sol,
          signature: r2.signature,
          error: ok ? void 0 : `hop 2/2 failed${recovered ? " (recovered)" : ""}`,
        }));
    } catch (e) {
      (results.push({ address: addr, sol, ok: !1, error: e.message }),
        step({ phase: "fail", index: idx, total: plan.length, address: addr, sol, error: e.message }));
    }
    idx++;
  }
  return { results, sent, total: plan.length };
}

/* --- Collect SOL (sweep) : chaque wallet envoie tout son solde (moins les frais) vers une
   destination. Équivalent du « Collect ETH » côté RH, pour le Bridge Solana. (19/09) */
export async function sweepSol(opts) {
  const { conn, sendConn, wallets, to, keypairOf } = opts,
    step = typeof opts.onStep == "function" ? opts.onStep : () => {},
    dest = to instanceof PublicKey ? to : new PublicKey(to),
    // frais EXACTS d'une signature sans compute-price : le wallet finit à 0. Une marge laisserait une poussière
    // < minimum de rent, que le runtime refuse (compte rent-exempt → rent-paying = InsufficientFundsForRent).
    FEE = 5000n,
    results = [];
  let sent = 0,
    idx = 0;
  for (const w of wallets) {
    const kp = keypairOf(w),
      from = kp.publicKey,
      addr = from.toBase58();
    if (addr === dest.toBase58()) {
      idx++;
      continue;
    }
    try {
      const bal = BigInt(await conn.getBalance(from, "confirmed")),
        amount = bal - FEE;
      if (amount <= 0n) {
        (results.push({ address: addr, sol: "0", ok: !1, error: "empty" }),
          step({ phase: "fail", index: idx, total: wallets.length, address: addr, error: "empty" }),
          idx++);
        continue;
      }
      const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn),
        tx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: from,
            recentBlockhash: blockhash,
            instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: dest, lamports: Number(amount) })],
          }).compileToV0Message(),
        );
      tx.sign([kp]);
      const r = await sendAndConfirm(conn, sendConn, tx, { lastValidBlockHeight }),
        ok = r.confirmed,
        sol = (Number(amount) / 1e9).toFixed(6);
      (results.push({ address: addr, sol, ok, signature: r.signature, error: ok ? void 0 : r.error }),
        ok && sent++,
        step({ phase: ok ? "sent" : "fail", index: idx, total: wallets.length, address: addr, sol, error: ok ? void 0 : r.error }));
    } catch (e) {
      (results.push({ address: addr, ok: !1, error: e.message }),
        step({ phase: "fail", index: idx, total: wallets.length, address: addr, error: e.message }));
    }
    idx++;
  }
  return { results, sent, total: wallets.length };
}
