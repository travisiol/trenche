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
 * opts: { lastValidBlockHeight, timeoutMs (75 s), rebroadcastMs (first re-broadcast after, 800 ms),
 *         rebroadcastEveryMs (then at most every, 1500 ms — re-broadcasts carry { rebroadcast: true } so the
 *         send connection may skip the rate-limited Sender path), simulateConn, dryRun,
 *         subscribe?: (signature) => Promise<{ err } | null> — a push notification of the confirmation
 *                     (WebSocket signatureSubscribe); null = unavailable → the poll falls back to pollFallbackMs,
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
  let lastBroadcast = 0;
  const u = async (rebroadcast = !1) => {
    lastBroadcast = Date.now();
    try {
      (await e.sendRawTransaction(i, {
        skipPreflight: !0,
        maxRetries: 0,
        rebroadcast,
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
        push = n.subscribe ? n.subscribe(o) : null;
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
  /* poll cadence: 400 ms flat on a private RPC (n.pollMs, n.pollGrowth = 1), 600 ms growing to 2.5 s on a public one.
     With a push subscription the poll is only the safety net (n.pollMs ≈ 1.5 s) and the wait ends on the push. */
  let push = n.subscribe ? n.subscribe(o) : null;
  const pollStart = n.pollMs ?? 600,
    pollGrowth = n.pollGrowth ?? 1.35,
    reEvery = n.rebroadcastEveryMs ?? 1500;
  let poll = push ? pollStart : (n.pollFallbackMs ?? pollStart);
  for (;;) {
    for (; Date.now() < budgetEnd;) {
      if (push) {
        const v = await Promise.race([push, sleep(poll).then(() => void 0)]);
        if (v === null) {
          push = null; // socket unavailable: plain polling from now on
          poll = n.pollFallbackMs ?? poll;
        } else if (v !== void 0) {
          if (v.err) return done(!1, { error: JSON.stringify(v.err) });
          return done(!0);
        }
      } else await sleep(poll);
      const f = await statusOf(t, o);
      if (f) {
        if (f.err) return done(!1, { error: JSON.stringify(f.err) });
        if (isLanded(f)) return done(!0);
      }
      if (lastValid !== void 0 && (await t.getBlockHeight("confirmed").catch(() => 0)) > lastValid) {
        const r2 = await notFound("blockhash expired (150 blocks)");
        if (r2) return r2;
        poll = push ? pollStart : (n.pollFallbackMs ?? pollStart);
        continue;
      }
      poll = Math.min(2500, Math.round(poll * pollGrowth));
      if (Date.now() - a > s && Date.now() - lastBroadcast >= reEvery) await u(!0);
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
  "https://frankfurt.mainnet.block-engine.jito.wtf",
];
/* where launch bundles go by default: ONE region (a bundle reaches the leader from any region — real landings from
   frankfurt and amsterdam alone, 2026-10-06), so one launch = one sendBundle against Jito's 1/s-per-IP limit; three
   regions at once got every one refused on a shared IP. TRENCH_JITO_REGION overrides. */
var JITO_DEFAULT_REGION = process.env.TRENCH_JITO_REGION || "https://frankfurt.mainnet.block-engine.jito.wtf";

async function submitTo(base, body) {
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

/* Same bundle to every regional block engine at once (same bundle id: Jito dedups) — the leader's region gets it
   first. Resolves with the first accepted id; throws the first refusal only when every region refused.
   `accepted` (opts.onAccepted) lists the regions that took it: in-flight statuses are REGION-LOCAL — asking another
   region answers "Invalid" (unknown), which is what every launch bundle reported until 2026-10-06. */
export async function submitJitoBundle(txs, opts = {}) {
  const encoded = txs.map(tx => Buffer.from(tx.serialize()).toString("base64")),
    body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [encoded, { encoding: "base64" }],
    }),
    engines = opts.blockEngineUrl ? [opts.blockEngineUrl] : JITO_BLOCK_ENGINES,
    results = engines.map(base =>
      submitTo(base, body).then(
        id => (opts.onAccepted?.(base, id), id),
        e => (opts.onRefused?.(base, e instanceof Error ? e.message : String(e)), Promise.reject(e)),
      ),
    );
  try {
    return await Promise.any(results);
  } catch (e) {
    throw e instanceof AggregateError ? e.errors[0] : e;
  }
}
export { JITO_BLOCK_ENGINES };

/* Astralane sendBundle (docs "Submit Transactions"): ≤ 4 txs, every one tipping an Astralane tip wallet, base64.
   The answer is the list of signatures (no bundle id). `astralane` = { key, url? } — url defaults to the Frankfurt
   gateway (their recommendation for Europe). */
var ASTRALANE_DEFAULT_URL = "https://fr.gateway.astralane.io/iris";
export async function submitAstralaneBundle(txs, astralane) {
  const url = `${astralane.url || ASTRALANE_DEFAULT_URL}?api-key=${encodeURIComponent(astralane.key)}`,
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", api_key: astralane.key },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [txs.map(tx => Buffer.from(tx.serialize()).toString("base64")), { encoding: "base64", mevProtect: !0, revertProtection: !1 }] }),
    }),
    text = await res.text(),
    data = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
  if (data?.error) throw new Error(`Astralane refused the bundle: ${data.error.message || JSON.stringify(data.error)}`);
  if (!res.ok) throw new Error(`Astralane HTTP ${res.status}: ${text.slice(0, 160)}`);
  return Array.isArray(data?.result) ? data.result.join(",") : String(data?.result ?? "sent");
}

/* Helius sendBundle (docs "Bundles via Helius"): ≤ 5 txs, base64, one tx tipping a Helius tip account; Helius forwards
   to Jito's block engine (geo-routed). `helius` = { url } = the Helius RPC URL with its api-key. Answer = bundle id. */
export async function submitHeliusBundle(txs, helius) {
  const res = await fetch(helius.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(helius.region ? { "jito-region": helius.region } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [txs.map(tx => Buffer.from(tx.serialize()).toString("base64")), { encoding: "base64" }] }),
    }),
    text = await res.text(),
    data = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
  if (data?.error) throw new Error(`Helius refused the bundle: ${data.error.message || JSON.stringify(data.error)}`);
  if (!res.ok) throw new Error(`Helius HTTP ${res.status}: ${text.replace(/api-key=[^&\s"]+/g, "api-key=…").slice(0, 160)}`);
  return String(data?.result ?? "sent");
}

/* Before a bundle leaves: Jito drops a bundle silently (status "Invalid") when one transaction fails its simulation or
   carries a bad signature, so check both here. 1) every required signature verified locally (ed25519); 2) the whole
   bundle simulated in order with Jito's `simulateBundle` on the read RPC when it offers the method (Helius / Jito RPCs)
   — the buys after the create see the created curve, which a plain simulateTransaction cannot. Returns an error
   sentence, or null (all good / simulateBundle unavailable: `simulated` says which). */
export async function preflightBundle(readConn, txs) {
  const { ed25519 } = await import("@noble/curves/ed25519");
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i],
      msg = tx.message.serialize(),
      n = tx.message.header.numRequiredSignatures,
      keys = tx.message.staticAccountKeys;
    for (let k = 0; k < n; k++) {
      const sig = tx.signatures[k];
      if (!sig || sig.every(b => b === 0) || !ed25519.verify(sig, msg, keys[k].toBytes()))
        return { error: `Transaction ${i + 1} of the bundle has a missing or invalid signature for ${keys[k].toBase58()}.`, simulated: !1 };
    }
  }
  let data;
  try {
    const res = await fetch(readConn.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateBundle",
        params: [{ encodedTransactions: txs.map(tx => Buffer.from(tx.serialize()).toString("base64")) }, { skipSigVerify: !0, replaceRecentBlockhash: !0, preExecutionAccountsConfigs: txs.map(() => null), postExecutionAccountsConfigs: txs.map(() => null) }],
      }),
    });
    data = await res.json().catch(() => null);
  } catch {
    return { error: null, simulated: !1 };
  }
  const v = data?.result?.value;
  if (!v) return { error: null, simulated: !1 }; // method not offered by this RPC
  const failed = v.summary && typeof v.summary === "object" ? v.summary.failed : null;
  if (!failed) return { error: null, simulated: !0 };
  const results = v.transactionResults ?? [],
    idx = Math.max(0, results.findIndex(r => r?.err)),
    logs = (results[idx]?.logs ?? []).filter(l => /error|failed|exceeded|insufficient/i.test(l)).slice(-3).join(" · ");
  return { error: `Transaction ${idx + 1} of the bundle fails simulation: ${JSON.stringify(failed.error ?? results[idx]?.err ?? failed)}${logs ? ` — ${logs}` : ""}.`, simulated: !0 };
}

/* Jito's own view of a bundle: Invalid (unknown / > 5 min) · Pending · Failed (dropped by every region — usually a
   transaction that fails simulation) · Landed. null when the call itself fails. */
async function statusAt(base, bundleId) {
  try {
    const res = await fetch(base + "/api/v1/getInflightBundleStatuses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getInflightBundleStatuses", params: [[bundleId]] }),
    });
    const data = await res.json().catch(() => ({}));
    return data?.result?.value?.[0]?.status ?? null;
  } catch {
    return null;
  }
}
var STATUS_RANK = { Landed: 4, Pending: 3, Failed: 2, Invalid: 1 };
/* the best verdict among the regions that accepted the bundle (opts.regions; default every region) */
export async function jitoBundleStatus(bundleId, opts = {}) {
  const regions = opts.blockEngineUrl ? [opts.blockEngineUrl] : opts.regions?.length ? opts.regions : JITO_BLOCK_ENGINES,
    all = await Promise.all(regions.map(base => statusAt(base, bundleId)));
  if (opts.perRegion) opts.perRegion(Object.fromEntries(regions.map((b, i) => [b, all[i]])));
  return all.filter(Boolean).sort((a, b) => (STATUS_RANK[b] ?? 0) - (STATUS_RANK[a] ?? 0))[0] ?? null;
}

// Envoie le bundle puis confirme via les signatures de ses tx (elles ne confirment que
// si le bundle entier a atterri — atomique). Renvoie {ok, bundleId, sigs, landed, error}.
// Après la fenêtre : re-vérification de la 1re signature dans l'historique + opts.verify()
// (état on-chain) avant de déclarer le bundle perdu — un 429 n'est pas un échec.
export async function sendBundleAndConfirm(readConn, txs, opts = {}) {
  const sigs = txs.map(signatureOf);
  let bundleId;
  const regions = [];
  // "Rate limit exceeded … Retry after 1000ms" (1 sendBundle per second per IP, shared IPs hit it sooner): wait what
  // Jito asks and send the same bundle again — a refusal at the door is not a lost auction (2026-10-06)
  for (let k = 0; ; k++) {
    try {
      bundleId = opts.astralane
        ? await submitAstralaneBundle(txs, opts.astralane)
        : opts.helius
          ? await submitHeliusBundle(txs, opts.helius)
          : await submitJitoBundle(txs, { ...opts, blockEngineUrl: opts.blockEngineUrl || JITO_DEFAULT_REGION, onAccepted: base => regions.push(base) });
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e),
        limited = /rate limit|429|retry after/i.test(msg);
      if (!limited || k >= 6) return { ok: !1, bundleId: null, sigs, error: msg, rateLimited: limited };
      const after = Number(/retry after (\d+)/i.exec(msg)?.[1] ?? 1000);
      await sleep(Math.min(5000, after + 150 + Math.floor(Math.random() * 250)));
    }
  }
  const timeoutMs = opts.timeoutMs ?? 45000,
    t0 = Date.now();
  let poll = 700,
    jito = null,
    jitoAt = 0,
    failedSeen = 0;
  for (; Date.now() - t0 < timeoutMs;) {
    // Jito's verdict every ~3 s: two "Failed" in a row = dropped (a tx fails simulation), stop waiting
    if (!opts.astralane && !opts.helius && Date.now() - jitoAt > 3000) {
      jitoAt = Date.now();
      jito = (await jitoBundleStatus(bundleId, { ...opts, regions })) ?? jito;
      failedSeen = jito === "Failed" ? failedSeen + 1 : 0;
      if (failedSeen >= 2) break;
    }
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
    jitoStatus: jito,
    error:
      jito === "Failed"
        ? `Jito dropped the bundle (status Failed, id ${bundleId}) — a transaction of the bundle fails simulation; nothing was spent (atomic).`
        : opts.astralane
          ? `Bundle not landed within the window (Astralane) — nothing was spent (atomic).`
          : opts.helius
            ? `Helius forwarded the bundle to Jito but no block included it within the window (id ${bundleId}) — nothing was spent (atomic).`
          // "Invalid" = Jito no longer tracks it — NOT a bad bundle: a plain test bundle landed while Jito said "Invalid" (2026-10-07)
          : `Jito accepted the bundle but no block included it within the window (status ${jito ?? "unknown"} = no longer tracked, not an invalid bundle) — on pump.fun its tip competes with every other bundle touching the same accounts; nothing was spent (atomic). Id ${bundleId}.`,
  };
}
