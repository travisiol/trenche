import { base58Encode } from "./keys.js";

var sleep = t => new Promise(e => setTimeout(e, Math.max(0, t)));

function signatureOf(t) {
  const e = t.signatures[0];
  if (!e) throw new Error("Transaction not signed.");
  const r = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
    n = [0];
  for (const o of e) {
    let i = o;
    for (let s = 0; s < n.length; s++) ((i += n[s] << 8), (n[s] = i % 58), (i = (i / 58) | 0));
    for (; i > 0;) (n.push(i % 58), (i = (i / 58) | 0));
  }
  let a = "";
  for (let o = 0; o < e.length && e[o] === 0; o++) a += "1";
  for (let o = n.length - 1; o >= 0; o--) a += r[n[o]];
  return a;
}

/* --- Confirmation ------------------------------------------------------------------------
   Every status read of every in-flight transaction is coalesced into ONE getSignatureStatuses
   call per ~150 ms window (10 wallets confirming at once = 1 RPC call per poll, not 10). A read
   that fails (429…) answers `undefined` (= unknown), never `null` (= not found). */
var statusBatch = { pending: new Map(), timer: null, conn: null };

function statusOf(conn, sig, history = false) {
  if (history)
    return conn
      .getSignatureStatuses([sig], { searchTransactionHistory: true })
      .then(r => r?.value?.[0] ?? null)
      .catch(() => undefined);
  return new Promise(resolve => {
    const b = statusBatch;
    b.conn = conn;
    const list = b.pending.get(sig) ?? [];
    list.push(resolve);
    b.pending.set(sig, list);
    if (!b.timer) b.timer = setTimeout(flushStatuses, 80);
  });
}

async function flushStatuses() {
  const b = statusBatch,
    entries = [...b.pending.entries()].slice(0, 256);
  for (const [sig] of entries) b.pending.delete(sig);
  b.timer = b.pending.size ? setTimeout(flushStatuses, 80) : null;
  const sigs = entries.map(([sig]) => sig),
    res = await b.conn.getSignatureStatuses(sigs).catch(() => null);
  entries.forEach(([, cbs], i) => {
    const v = res ? (res.value?.[i] ?? null) : undefined;
    for (const cb of cbs) cb(v);
  });
}

var isLanded = s => !!s && !s.err && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized");

/* After the blockhash window closed (or the time budget ran out) a signature is re-checked with
   searchTransactionHistory a few times: a 429 storm during the window must not turn a landed
   transaction into "expired". Returns the status, null when really absent, undefined when unreadable. */
async function recheck(conn, sig, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    const s = await statusOf(conn, sig, true);
    if (s) return s;
    last = s;
    if (i < tries - 1) await sleep(1200 + 600 * i);
  }
  return last;
}

/**
 * Broadcast + confirm one signed transaction.
 * opts: { lastValidBlockHeight, timeoutMs (75 s), rebroadcastMs, simulateConn, dryRun,
 *         verify?: () => Promise<boolean>   — state check used when the signature is not found after expiry
 *                                              (mint/curve exists, token balance moved): true = landed,
 *         rebuild?: () => Promise<{ tx, lastValidBlockHeight }> — re-sign with a fresh blockhash when the
 *                                              transaction really was never included (max `maxRebuilds` = 2) }
 * Result: { signature, broadcasts, confirmed, ms, error?, expired?, recovered?: "history" | "verify", rebuilds }
 */
export async function sendAndConfirm(t, e, r, n = {}) {
  const a = Date.now();
  let o = signatureOf(r);
  if (n.dryRun)
    return {
      signature: o,
      broadcasts: 0,
      confirmed: !1,
      ms: 0,
      error: "dry-run",
    };
  let i = r.serialize(),
    s = n.rebroadcastMs ?? 800,
    c = n.timeoutMs ?? 75e3,
    d = 0,
    l = "",
    lastValid = n.lastValidBlockHeight,
    rebuilds = 0,
    maxRebuilds = n.maxRebuilds ?? 2,
    budgetEnd = a + c;
  const done = (confirmed, extra = {}) => ({ signature: o, broadcasts: d, confirmed, ms: Date.now() - a, rebuilds, ...extra });
  if (n.simulateConn)
    try {
      const p = await n.simulateConn.simulateTransaction(r, {
        commitment: "confirmed",
        sigVerify: !1,
        replaceRecentBlockhash: !1,
      });
      if (p.value.err) {
        const f = (p.value.logs ?? []).slice(-4).join(" | ");
        return done(!1, { error: `simulation: ${JSON.stringify(p.value.err)}${f ? " — " + f : ""}`.slice(0, 300) });
      }
    } catch {}
  const u = async () => {
    try {
      (await e.sendRawTransaction(i, {
        skipPreflight: !0,
        maxRetries: 0,
      }),
        d++);
      d === 1 && typeof n.onSent == "function" && n.onSent(o);
    } catch (p) {
      const f = p.message ?? "";
      if (/already been processed|AlreadyProcessed/i.test(f)) {
        d++;
        return;
      }
      l = f;
    }
  };
  if ((await u(), d === 0 && l)) return done(!1, { error: l.slice(0, 200) });
  /* the signature was not found after the window closed: history re-check → state check → fresh blockhash */
  const notFound = async why => {
    const h = await recheck(t, o);
    if (isLanded(h)) return done(!0, { recovered: "history" });
    if (h && h.err) return done(!1, { error: JSON.stringify(h.err) });
    if (n.verify) {
      const ok = await n.verify().catch(() => !1);
      if (ok) return done(!0, { recovered: "verify" });
    }
    if (n.rebuild && rebuilds < maxRebuilds && h !== undefined) {
      rebuilds++;
      try {
        const nb = await n.rebuild();
        r = nb.tx;
        o = signatureOf(r);
        i = r.serialize();
        lastValid = nb.lastValidBlockHeight;
        l = "";
        budgetEnd = Date.now() + Math.min(c, 60e3);
        await u();
        if (d === 0 && l) return done(!1, { error: l.slice(0, 200) });
        return null; // keep polling with the new signature
      } catch (err) {
        return done(!1, { error: `rebuild failed: ${err.message ?? err}`.slice(0, 200), expired: !0 });
      }
    }
    return done(!1, {
      error: h === undefined ? `${why} — RPC could not confirm the signature (rate-limited): check it on the explorer` : `${why} — transaction not found on chain after re-check`,
      expired: !0,
    });
  };
  /* poll cadence: 400 ms flat on a private RPC (n.pollMs, n.pollGrowth = 1), 600 ms growing to 2.5 s on a public one */
  const pollStart = n.pollMs ?? 600,
    pollGrowth = n.pollGrowth ?? 1.35;
  let poll = pollStart;
  for (;;) {
    for (; Date.now() < budgetEnd;) {
      const f = await statusOf(t, o);
      if (f) {
        if (f.err) return done(!1, { error: JSON.stringify(f.err) });
        if (isLanded(f)) return done(!0);
      }
      if (lastValid !== void 0 && (await t.getBlockHeight("confirmed").catch(() => 0)) > lastValid) {
        const r2 = await notFound("blockhash expired (150 blocks)");
        if (r2) return r2;
        poll = pollStart;
        continue;
      }
      await sleep(poll);
      poll = Math.min(2500, Math.round(poll * pollGrowth));
      if (Date.now() - a > s) await u();
    }
    const r3 = await notFound("confirmation timed out");
    if (r3) return r3;
  }
}

/** opts.rebuild may be a function of the transaction index: (i) => Promise<{ tx, lastValidBlockHeight }>;
 *  opts.verify likewise: (i) => Promise<boolean>. */
export async function sendMany(t, e, r, n = {}) {
  const a = Math.max(0, Math.round(n.staggerMs ?? 0));
  return Promise.all(
    r.map(
      async (o, i) => (
        a > 0 && i > 0 && (await sleep(a * i)),
        sendAndConfirm(t, e, o, {
          ...n,
          rebuild: typeof n.rebuild == "function" ? () => n.rebuild(i) : void 0,
          verify: typeof n.verify == "function" ? () => n.verify(i) : void 0,
          onSent: typeof n.onSent == "function" ? sig => n.onSent(i, sig) : void 0,
          onResult: void 0,
        })
          .then(res => (typeof n.onResult == "function" && n.onResult(i, res), res))
          .catch(s => ({
          signature: signatureOf(o),
          broadcasts: 0,
          confirmed: !1,
          ms: 0,
          error: s.message,
        }))
      ),
    ),
  );
}

export async function latestBlockhash(t) {
  return t.getLatestBlockhash("confirmed");
}

/* --- Bundle atomique Jito -----------------------------------------------------------
   Toutes les tx du bundle atterrissent dans le MÊME slot, dans l'ordre, ou aucune : un
   sniper ne peut PHYSIQUEMENT pas s'insérer entre la création+dev et tes wallets. C'est
   le « tu es premier, ou tu n'entres pas » côté Solana. Un bundle Jito = 5 tx maximum,
   avec au moins un pourboire (tip) vers un compte Jito. Si le bundle n'atterrit pas :
   rien n'est dépensé (atomique) — on le signale et on peut relancer. Sa demande du 18/09. */
var JITO_BLOCK_ENGINES = [
  "https://mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://amsterdam.mainnet.block-engine.jito.wtf",
];

export async function submitJitoBundle(txs, opts = {}) {
  const base = opts.blockEngineUrl || JITO_BLOCK_ENGINES[0],
    encoded = txs.map(tx => base58Encode(tx.serialize())),
    body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [encoded, { encoding: "base58" }],
    });
  const res = await fetch(base + "/api/v1/bundles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(`Jito refused the bundle: ${data.error.message || JSON.stringify(data.error)}`);
  if (!res.ok) throw new Error(`Jito HTTP ${res.status}`);
  return data.result;
}

// Envoie le bundle puis confirme via les signatures de ses tx (elles ne confirment que
// si le bundle entier a atterri — atomique). Renvoie {ok, bundleId, sigs, landed, error}.
// Après la fenêtre : re-vérification de la 1re signature dans l'historique + opts.verify()
// (état on-chain) avant de déclarer le bundle perdu — un 429 n'est pas un échec.
export async function sendBundleAndConfirm(readConn, txs, opts = {}) {
  const sigs = txs.map(signatureOf);
  let bundleId;
  try {
    bundleId = await submitJitoBundle(txs, opts);
  } catch (e) {
    return { ok: !1, bundleId: null, sigs, error: e.message };
  }
  const timeoutMs = opts.timeoutMs ?? 45000,
    t0 = Date.now();
  let poll = 700;
  for (; Date.now() - t0 < timeoutMs;) {
    const st = (await readConn.getSignatureStatuses(sigs).catch(() => null))?.value ?? [];
    const bad = st.find(s => s && s.err);
    if (bad) return { ok: !1, bundleId, sigs, error: `A bundle transaction reverted: ${JSON.stringify(bad.err)}` };
    const landed = st.map(s => !!(s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")));
    if (landed.length === sigs.length && landed.every(Boolean)) return { ok: !0, bundleId, sigs, landed };
    await sleep(poll);
    poll = Math.min(2500, Math.round(poll * 1.3));
  }
  const h = await recheck(readConn, sigs[0]);
  if (isLanded(h)) return { ok: !0, bundleId, sigs, landed: sigs.map(() => !0), recovered: "history" };
  if (h && h.err) return { ok: !1, bundleId, sigs, error: `A bundle transaction reverted: ${JSON.stringify(h.err)}` };
  if (opts.verify && (await opts.verify().catch(() => !1))) return { ok: !0, bundleId, sigs, landed: sigs.map(() => !0), recovered: "verify" };
  return {
    ok: !1,
    bundleId,
    sigs,
    error: "Bundle not landed within the window — nothing was spent (atomic). Retry, or raise the tip.",
  };
}
