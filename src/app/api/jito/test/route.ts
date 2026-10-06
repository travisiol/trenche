import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { JITO_BUNDLE_TIP_ACCOUNTS } from "@/engine/solana/config.js";
import { base58Encode } from "@/engine/solana/keys.js";
import { JITO_BLOCK_ENGINES, jitoBundleStatus, latestBlockhash, submitJitoBundle } from "@/engine/solana/send.js";
import { HttpError, json, readBody, route } from "@/server/api";
import { readConn, requireUnlocked } from "@/server/engine";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { wallet?, tipLamports? } — the smallest real Jito bundle: two transactions of `wallet` (default: the richest
 *  vault wallet), a 0-lamport self-transfer then the tip (default 100 000 lamports = 0.0001 SOL). Lands = Jito works
 *  end to end (cost: the tip + 2 × 5000 lamports); does not land = nothing spent. Reports every region's answer and
 *  status, polled 30 s. Built to find why every launch bundle reported "Invalid" (2026-10-06). */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  type Body = { wallet?: string; tipLamports?: number; /** one block engine only (e.g. https://ny.mainnet.block-engine.jito.wtf) */ region?: string; /** "two" (default): self-transfer then tip · "one": a single tx with both · "tx": the single tx via Jito's sendTransaction (control: not a bundle) */ mode?: "one" | "two" | "tx" };
  const body = await readBody<Body>(req).catch(() => ({}) as Body);
  const st = store();
  const bal = st.balances?.map ?? {};
  const wallet = body.wallet ?? st.sol.wallets.map((w) => [w.address, Number(bal[w.address] ?? 0)] as const).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!wallet) throw new HttpError(400, "No vault wallet.");
  const kp = st.sol.keypair(wallet);
  const tip = BigInt(Math.max(1000, Math.min(10_000_000, Math.floor(body.tipLamports ?? 100_000))));
  const conn = readConn();
  const { blockhash } = await latestBlockhash(conn);
  const tipTo = new PublicKey(JITO_BUNDLE_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_BUNDLE_TIP_ACCOUNTS.length)]);
  const mk = (ixs: TransactionInstruction[]) => {
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign([kp]);
    return tx;
  };
  const self = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 0 });
  const tipIx = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: tipTo, lamports: tip });
  const mode = body.mode ?? "two";
  const txs = mode === "two" ? [mk([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }), self]), mk([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }), tipIx])] : [mk([ComputeBudgetProgram.setComputeUnitLimit({ units: 2000 }), self, tipIx])];
  const signatures = txs.map((t) => base58Encode(t.signatures[0]));
  const accepted: Record<string, string> = {};
  const refused: Record<string, string> = {};
  const t0 = Date.now();
  let bundleId: string | null = null;
  let submitError: string | null = null;
  const regionList = body.region ? [body.region] : JITO_BLOCK_ENGINES;
  if (mode === "tx") {
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
      bundleId = await submitJitoBundle(txs, { blockEngineUrl: body.region, onAccepted: (r, id) => (accepted[r] = id), onRefused: (r, e) => (refused[r] = e) });
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
    }
  await new Promise((r) => setTimeout(r, 400)); // let the other regions answer
  const timeline: { ms: number; best: string | null; regions: Record<string, string | null>; landed: boolean[] }[] = [];
  let landedAll = false;
  if (bundleId || mode === "tx") {
    for (let i = 0; i < 30 && Date.now() - t0 < 32_000; i++) {
      let regions: Record<string, string | null> = {};
      const best = bundleId ? await jitoBundleStatus(bundleId, { regions: regionList, perRegion: (r) => (regions = r) }) : null;
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
