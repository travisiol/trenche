import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { ASTRALANE_TIP_ACCOUNTS, HELIUS_BUNDLE_TIP_ACCOUNTS, JITO_BUNDLE_TIP_ACCOUNTS } from "@/engine/solana/config.js";
import { base58Encode } from "@/engine/solana/keys.js";
import { buildBuyTx, planBuys, signWith } from "@/engine/solana/pump/math.js";
import { bondingCurvePda, parseBondingCurve, tokenProgramFor } from "@/engine/solana/pump/pdas.js";
import { JITO_BLOCK_ENGINES, jitoBundleStatus, latestBlockhash, submitAstralaneBundle, submitHeliusBundle, submitJitoBundle } from "@/engine/solana/send.js";
import { HttpError, json, readBody, route } from "@/server/api";
import { readConn, requireUnlocked } from "@/server/engine";
import { heliusBundleUrl, store } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { wallet?, tipLamports? } — the smallest real Jito bundle: two transactions of `wallet` (default: the richest
 *  vault wallet), a 0-lamport self-transfer then the tip (default 100 000 lamports = 0.0001 SOL). Lands = Jito works
 *  end to end (cost: the tip + 2 × 5000 lamports); does not land = nothing spent. Reports every region's answer and
 *  status, polled 30 s. Built to find why every launch bundle reported "Invalid" (2026-10-06). */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  type Body = { wallet?: string; tipLamports?: number; /** one block engine only (e.g. https://ny.mainnet.block-engine.jito.wtf) */ region?: string; /** "two" (default): self-transfer then tip · "one": a single tx with both · "tx": the single tx via Jito's sendTransaction (control: not a bundle) */ mode?: "one" | "two" | "tx" | "pumpbuy"; /** pumpbuy: a live pump.fun coin and the SOL (lamports) to buy */ mint?: string; lamports?: number; /** pumpbuy variants */ tipInBuy?: boolean; cuPrice?: number; cuLimit?: number; /** send through Astralane (Settings key): every tx tips an Astralane wallet */ astralane?: boolean; /** with astralane: send the tipped buy alone through Astralane sendTransaction (Free tier) */ astralaneTx?: boolean; /** build the same transactions and only simulate them (nothing sent, nothing spent) */ simulate?: boolean; /** send through Helius sendBundle (Settings Helius key / RPC), forwarded to Jito */ helius?: boolean };
  const body = await readBody<Body>(req).catch(() => ({}) as Body);
  const st = store();
  const bal = st.balances?.map ?? {};
  const wallet = body.wallet ?? st.sol.wallets.map((w) => [w.address, Number(bal[w.address] ?? 0)] as const).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!wallet) throw new HttpError(400, "No vault wallet.");
  const kp = st.sol.keypair(wallet);
  const tip = BigInt(Math.max(1000, Math.min(10_000_000, Math.floor(body.tipLamports ?? 100_000))));
  const conn = readConn();
  const { blockhash } = await latestBlockhash(conn);
  const astra = body.astralane === true ? (st.settings.astralaneKey ?? "").trim() : "";
  if (body.astralane === true && !astra) throw new HttpError(400, "No Astralane key in Settings.");
  const heliusUrl = body.helius === true ? heliusBundleUrl(st.settings) : null;
  if (body.helius === true && !heliusUrl) throw new HttpError(400, "No Helius key or Helius RPC URL in Settings.");
  const tipList = astra ? ASTRALANE_TIP_ACCOUNTS : heliusUrl ? HELIUS_BUNDLE_TIP_ACCOUNTS : JITO_BUNDLE_TIP_ACCOUNTS;
  const tipTo = new PublicKey(tipList[Math.floor(Math.random() * tipList.length)]);
  const mk = (ixs: TransactionInstruction[]) => {
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign([kp]);
    return tx;
  };
  const self = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 0 });
  const tipIx = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: tipTo, lamports: tip });
  const mode = body.mode ?? "two";
  // pumpbuy: OUR pump.fun buy transaction (engine buildBuyTx, as a launch bundle builds it) then a tip-only tx — tells
  // whether Jito drops our pump transactions or only our create
  let pumpTxs: VersionedTransaction[] | null = null;
  if (mode === "pumpbuy") {
    if (!body.mint) throw new HttpError(400, "pumpbuy: mint required.");
    const mint = new PublicKey(body.mint);
    const acc = await conn.getAccountInfo(bondingCurvePda(mint));
    if (!acc) throw new HttpError(400, "No bonding curve for this mint.");
    const curve = parseBondingCurve(acc.data);
    const mintAcc = await conn.getAccountInfo(mint);
    const tokenProgram = tokenProgramFor(mintAcc?.owner.toBase58() ?? "");
    const plan = planBuys([{ label: "test", signer: kp, solIn: BigInt(Math.max(100_000, Math.min(5_000_000, Math.floor(body.lamports ?? 500_000)))) }], { virtualTokenReserves: curve.virtualTokenReserves, virtualSolReserves: curve.virtualSolReserves, realTokenReserves: curve.realTokenReserves }, 3000)[0];
    const inBuy = body.tipInBuy === true || !!astra; // Astralane: every tx tips
    const buy = signWith(buildBuyTx({ mint, creator: curve.creator, tokenProgram, cuPrice: Math.max(0, Math.floor(body.cuPrice ?? 100_000)), cuLimit: Math.max(90_000, Math.floor(body.cuLimit ?? 130_000)), ataExists: false, recentBlockhash: blockhash, tipLamports: inBuy ? tip : undefined, jitoTip: astra ? "astralane" : inBuy }, plan), kp);
    pumpTxs = inBuy && !astra ? [buy] : [buy, mk([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }), tipIx])];
  }
  const txs = pumpTxs ? pumpTxs : mode === "two" ? [mk([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }), self]), mk([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }), tipIx])] : [mk([ComputeBudgetProgram.setComputeUnitLimit({ units: 2000 }), self, tipIx])];
  const signatures = txs.map((t) => base58Encode(t.signatures[0]));
  if (body.simulate) {
    const sims = await Promise.all(txs.map(async (t) => {
      const r = await conn.simulateTransaction(t, { sigVerify: false, replaceRecentBlockhash: true }).catch((e) => ({ value: { err: String(e), logs: [] as string[], unitsConsumed: 0 } }));
      return { err: r.value.err, unitsConsumed: r.value.unitsConsumed ?? null, logs: (r.value.logs ?? []).slice(-12), bytes: t.serialize().length, accounts: t.message.staticAccountKeys.map((k) => k.toBase58()) };
    }));
    return json({ mode, simulate: true, wallet, sims });
  }
  const accepted: Record<string, string> = {};
  const refused: Record<string, string> = {};
  const t0 = Date.now();
  let bundleId: string | null = null;
  let submitError: string | null = null;
  // one region by default (Jito: 1 sendBundle/s per IP)
  const regionList = [body.region ?? JITO_BLOCK_ENGINES.find((u) => u.includes("frankfurt")) ?? JITO_BLOCK_ENGINES[0]];
  if (astra && body.astralaneTx && pumpTxs) {
    // Astralane fast lane (Free key): the tipped buy alone, sendTransaction
    try {
      const res = await fetch(`https://fr.gateway.astralane.io/iris?api-key=${encodeURIComponent(astra)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [Buffer.from(pumpTxs[0].serialize()).toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 0 }] }) });
      const data = (await res.json().catch(() => ({}))) as { result?: string; error?: { message?: string } };
      if (data.result) accepted["astralane-tx"] = data.result;
      else refused["astralane-tx"] = data.error?.message ?? `HTTP ${res.status}`;
    } catch (e) {
      refused["astralane-tx"] = e instanceof Error ? e.message : String(e);
    }
    signatures.splice(1);
  } else if (mode === "tx") {
    // control: Jito's plain transaction endpoint (no bundle, no auction state) — lands like any send if Jito takes it
    await Promise.all(
      regionList.map(async (base) => {
        try {
          const res = await fetch(`${base}/api/v1/transactions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [Buffer.from(txs[0].serialize()).toString("base64"), { encoding: "base64" }] }) });
          const data = (await res.json().catch(() => ({}))) as { result?: string; error?: { message?: string } };
          if (data.result) accepted[base] = data.result;
          else refused[base] = data.error?.message ?? `HTTP ${res.status}`;
        } catch (e) {
          refused[base] = e instanceof Error ? e.message : String(e);
        }
      }),
    );
  } else
    try {
      bundleId = heliusUrl
        ? await submitHeliusBundle(txs, { url: heliusUrl }).then((id) => ((accepted["helius"] = id), id), (e) => ((refused["helius"] = e instanceof Error ? e.message : String(e)), Promise.reject(e)))
        : astra
        ? await submitAstralaneBundle(txs, { key: astra }).then((id) => ((accepted["astralane"] = id), id), (e) => ((refused["astralane"] = e instanceof Error ? e.message : String(e)), Promise.reject(e)))
        : await submitJitoBundle(txs, { blockEngineUrl: regionList[0], onAccepted: (r, id) => (accepted[r] = id), onRefused: (r, e) => (refused[r] = e) });
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
    }
  await new Promise((r) => setTimeout(r, 400)); // let the other regions answer
  const timeline: { ms: number; best: string | null; regions: Record<string, string | null>; landed: boolean[] }[] = [];
  let landedAll = false;
  if (bundleId || mode === "tx" || (astra && body.astralaneTx)) {
    for (let i = 0; i < 30 && Date.now() - t0 < 32_000; i++) {
      let regions: Record<string, string | null> = {};
      const best = bundleId && !astra && !heliusUrl ? await jitoBundleStatus(bundleId, { regions: regionList, perRegion: (r) => (regions = r) }) : null;
      const stx = (await conn.getSignatureStatuses(signatures).catch(() => null))?.value ?? [];
      const landed = signatures.map((_, k) => !!stx[k] && !stx[k]!.err);
      timeline.push({ ms: Date.now() - t0, best, regions, landed });
      if (landed.every(Boolean)) {
        landedAll = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return json({ mode, wallet, tipLamports: tip.toString(), tipAccount: tipTo.toBase58(), bundleId, submitError, accepted, refused, signatures, landed: landedAll, timeline });
});
