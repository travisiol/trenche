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

export async function sendAndConfirm(t, e, r, n = {}) {
  const a = Date.now(),
    o = signatureOf(r);
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
    c = n.timeoutMs ?? 6e4,
    d = 0,
    l = "";
  if (n.simulateConn)
    try {
      const p = await n.simulateConn.simulateTransaction(r, {
        commitment: "confirmed",
        sigVerify: !1,
        replaceRecentBlockhash: !1,
      });
      if (p.value.err) {
        const f = (p.value.logs ?? []).slice(-4).join(" | ");
        return {
          signature: o,
          broadcasts: 0,
          confirmed: !1,
          ms: Date.now() - a,
          error: `simulation: ${JSON.stringify(p.value.err)}${f ? " \u2014 " + f : ""}`.slice(0, 300),
        };
      }
    } catch {}
  const u = async () => {
    try {
      (await e.sendRawTransaction(i, {
        skipPreflight: !0,
        maxRetries: 0,
      }),
        d++);
    } catch (p) {
      const f = p.message ?? "";
      if (/already been processed|AlreadyProcessed/i.test(f)) {
        d++;
        return;
      }
      l = f;
    }
  };
  if ((await u(), d === 0 && l))
    return {
      signature: o,
      broadcasts: 0,
      confirmed: !1,
      ms: Date.now() - a,
      error: l.slice(0, 200),
    };
  for (; Date.now() - a < c;) {
    const f = (await t.getSignatureStatuses([o]).catch(() => null))?.value?.[0];
    if (f) {
      if (f.err)
        return {
          signature: o,
          broadcasts: d,
          confirmed: !1,
          ms: Date.now() - a,
          error: JSON.stringify(f.err),
        };
      if (f.confirmationStatus === "confirmed" || f.confirmationStatus === "finalized")
        return {
          signature: o,
          broadcasts: d,
          confirmed: !0,
          ms: Date.now() - a,
        };
    }
    if (
      n.lastValidBlockHeight !== void 0 &&
      (await t.getBlockHeight("confirmed").catch(() => 0)) > n.lastValidBlockHeight
    )
      return {
        signature: o,
        broadcasts: d,
        confirmed: !1,
        ms: Date.now() - a,
        error: "blockhash expired (150 blocks) \u2014 transaction never included",
      };
    (await sleep(s), await u());
  }
  return {
    signature: o,
    broadcasts: d,
    confirmed: !1,
    ms: Date.now() - a,
    error: "timeout exceeded",
  };
}

export async function sendMany(t, e, r, n = {}) {
  const a = Math.max(0, Math.round(n.staggerMs ?? 0));
  return Promise.all(
    r.map(
      async (o, i) => (
        a > 0 && i > 0 && (await sleep(a * i)),
        sendAndConfirm(t, e, o, n).catch(s => ({
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
  for (; Date.now() - t0 < timeoutMs;) {
    const st = (await readConn.getSignatureStatuses(sigs).catch(() => null))?.value ?? [];
    const bad = st.find(s => s && s.err);
    if (bad) return { ok: !1, bundleId, sigs, error: `A bundle transaction reverted: ${JSON.stringify(bad.err)}` };
    const landed = st.map(s => !!(s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")));
    if (landed.length === sigs.length && landed.every(Boolean)) return { ok: !0, bundleId, sigs, landed };
    await sleep(700);
  }
  return {
    ok: !1,
    bundleId,
    sigs,
    error: "Bundle not landed within the window — nothing was spent (atomic). Retry, or raise the tip.",
  };
}
