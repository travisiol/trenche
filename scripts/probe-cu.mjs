/* Compute-unit measurement for the trade builders, on mainnet, WITHOUT sending anything: buy / sell transactions
 * built by the TRENCH engine are simulated (sigVerify:false, replaceRecentBlockhash:true) against live pump.fun
 * curves found in the latest creates. Signers are impersonated (signatures are garbage, simulation ignores them).
 * Prints unitsConsumed per variant; the server CU limits (src/server/priority.ts) are set from these numbers.
 * Usage: node scripts/probe-cu.mjs [rpcUrl] [mints=3] */
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { randomBuybackFeeRecipient, randomFeeRecipient, sellInstruction } from "../src/engine/solana/pump/instructions.js";
import { buildBuyTx, buildSellTx, planBuys, planSells, signWith } from "../src/engine/solana/pump/math.js";
import { associatedTokenAddress, bondingCurvePda, mintAuthorityPda, parseBondingCurve, TOKEN_2022_PROGRAM, tokenProgramFor } from "../src/engine/solana/pump/pdas.js";

const rpc = process.argv[2] || "https://solana-rpc.publicnode.com";
const want = Number(process.argv[3] || 3);
const raw = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true });
/** every read retried on 429 (publicnode answers -32005 under bursts) */
const conn = new Proxy(raw, {
  get(t, k) {
    const v = t[k];
    if (typeof v !== "function") return v;
    return async (...a) => {
      for (let i = 0; ; i++) {
        try {
          return await v.apply(t, a);
        } catch (e) {
          if (i >= 5 || !/429|rate limit/i.test(e.message)) throw e;
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
      }
    };
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const impersonate = (address) => ({ publicKey: new PublicKey(address), secretKey: Keypair.generate().secretKey });
// funded exchange wallets that never trade on pump.fun (fresh ATA + fresh user-volume accumulator)
const FRESH_BUYERS = ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"];
const BIG = 1_400_000;
const rows = [];

async function sim(label, tx) {
  await sleep(400);
  const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).catch((e) => ({ value: { err: e.message, logs: [] } }));
  const v = r.value;
  const ok = !v.err;
  rows.push({ label, ok, cu: v.unitsConsumed ?? null, err: ok ? null : JSON.stringify(v.err).slice(0, 80) });
  console.log(`${ok ? "OK " : "ERR"} ${String(v.unitsConsumed ?? "?").padStart(7)} CU  ${label}${ok ? "" : "  " + JSON.stringify(v.err)}`);
  if (!ok) for (const l of (v.logs ?? []).filter((l) => /Error|failed|insufficient/i.test(l)).slice(0, 3)) console.log("      " + l);
  return v.unitsConsumed ?? null;
}

const sigs = await conn.getSignaturesForAddress(mintAuthorityPda(), { limit: 25 });
const lives = [];
for (const s of sigs) {
  if (s.err || lives.length >= want) continue;
  await sleep(300);
  const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
  if (!tx) continue;
  const keys = tx.transaction.message.staticAccountKeys;
  for (const k of keys) {
    if (keys.some((x) => x.equals(bondingCurvePda(k)))) {
      if (!lives.some((l) => l.mint.equals(k))) lives.push({ mint: k, user: keys[0] });
      break;
    }
  }
}
console.log(`${lives.length} live curve(s) from the latest creates · RPC ${rpc}\n`);

for (const live of lives) {
  const info = await conn.getAccountInfo(bondingCurvePda(live.mint), "confirmed");
  if (!info) continue;
  const curve = parseBondingCurve(info.data);
  if (curve.complete) continue;
  const mintInfo = await conn.getAccountInfo(live.mint, "confirmed");
  const tokenProgram = tokenProgramFor(mintInfo?.owner.toBase58() ?? TOKEN_2022_PROGRAM);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const m = live.mint.toBase58().slice(0, 6);
  console.log(`-- ${live.mint.toBase58()} (${tokenProgram.toBase58().startsWith("Tokenz") ? "Token-2022" : "SPL Token"}, cashback=${curve.isCashbackCoin})`);
  for (const [i, who] of FRESH_BUYERS.entries()) {
    const signer = impersonate(who);
    const [p] = planBuys([{ label: "b", signer, solIn: 10_000_000n }], curve, 3000);
    await sim(`${m} buy, fresh ATA (idempotent create), fresh buyer ${i + 1}, tip`, signWith(buildBuyTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 100_000, cuLimit: BIG, ataExists: false, tipLamports: 5000n, recentBlockhash: blockhash }, p), signer));
  }
  // composite transactions (the simulation applies the instructions in order): fresh buy, then a second buy on the now
  // existing ATA, then a 100 % sell — each instruction's CU = composite − the previous composite
  {
    const signer = impersonate(FRESH_BUYERS[0]);
    const [p] = planBuys([{ label: "b", signer, solIn: 10_000_000n }], curve, 3000);
    const base = buildBuyTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 100_000, cuLimit: BIG, ataExists: false, tipLamports: 5000n, recentBlockhash: blockhash }, p);
    const msg = TransactionMessage.decompile(base.message);
    const buyIx = msg.instructions[msg.instructions.length - 1];
    const one = await sim(`${m} [composite] buy (fresh ATA) + tip`, new VersionedTransaction(msg.compileToV0Message()));
    msg.instructions.push(buyIx);
    const two = await sim(`${m} [composite] + second buy (ATA exists)`, new VersionedTransaction(msg.compileToV0Message()));
    const [sp] = planSells([{ label: "s", signer, tokens: (p.tokensWanted * 2n * 9n) / 10n }], curve, 9000);
    msg.instructions.push(sellInstruction({ mint: live.mint, user: signer.publicKey, creator: curve.creator, tokenProgram, feeRecipient: randomBuybackFeeRecipient(), buybackFeeRecipient: randomFeeRecipient() }, sp.tokens, 0n, curve.isCashbackCoin));
    const three = await sim(`${m} [composite] + sell 90 %`, new VersionedTransaction(msg.compileToV0Message()));
    if (one && two) rows.push({ label: `${m} derived buy ATA exists`, ok: true, cu: two - one });
    if (two && three) rows.push({ label: `${m} derived sell`, ok: true, cu: three - two });
    console.log(`   derived: buy on existing ATA ${two && one ? two - one : "?"} CU · sell ${three && two ? three - two : "?"} CU (+ tip/compute budget overhead counted in the fresh buy)`);
  }
  // a holder (largest non-curve token account, else the creator): buy with ATA existing, idempotent create on an existing ATA, sell
  let holder = live.user;
  const largest = await conn.getTokenLargestAccounts(live.mint, "confirmed").catch(() => null);
  const curveAta = associatedTokenAddress(bondingCurvePda(live.mint), live.mint, tokenProgram);
  for (const a of largest?.value ?? []) {
    if (a.address.equals(curveAta) || BigInt(a.amount) === 0n) continue;
    await sleep(300);
    const acc = await conn.getParsedAccountInfo(a.address, "confirmed").catch(() => null);
    const owner = acc?.value?.data?.parsed?.info?.owner;
    if (owner && PublicKey.isOnCurve(new PublicKey(owner).toBytes()) && associatedTokenAddress(new PublicKey(owner), live.mint, tokenProgram).equals(a.address)) {
      holder = new PublicKey(owner);
      break;
    }
  }
  const ata = await conn.getTokenAccountBalance(associatedTokenAddress(holder, live.mint, tokenProgram), "confirmed").catch(() => null);
  const held = BigInt(ata?.value?.amount ?? "0");
  const bal = await conn.getBalance(holder, "confirmed").catch(() => 0);
  const creator = impersonate(holder.toBase58());
  if (held > 0n && bal > 3_000_000) {
    const [p] = planBuys([{ label: "c", signer: creator, solIn: 1_000_000n }], curve, 3000);
    await sim(`${m} buy, ATA exists (no create), holder, tip`, signWith(buildBuyTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 100_000, cuLimit: BIG, ataExists: true, tipLamports: 5000n, recentBlockhash: blockhash }, p), creator));
    await sim(`${m} buy, ATA exists + idempotent create, holder, tip`, signWith(buildBuyTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 100_000, cuLimit: BIG, ataExists: false, tipLamports: 5000n, recentBlockhash: blockhash }, p), creator));
  } else console.log(`   (holder ${holder.toBase58().slice(0, 6)}… holds ${held} tokens / ${bal} lamports: existing-ATA buy skipped)`);
  if (held > 0n) {
    for (const part of [2n, 1n]) {
      const [sp] = planSells([{ label: "dev", signer: creator, tokens: held / part }], curve, 3000);
      await sim(`${m} sell ${part === 1n ? "100" : "50"} %, holder, tip`, signWith(buildSellTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 100_000, cuLimit: BIG, tipLamports: 5000n, recentBlockhash: blockhash, cashback: curve.isCashbackCoin }, sp), creator));
    }
  } else console.log("   (no holder found: sell skipped)");
}

const by = (re) => rows.filter((r) => r.ok && re.test(r.label)).map((r) => r.cu);
const max = (a) => (a.length ? Math.max(...a) : null);
console.log("\nMAX CU", JSON.stringify({ buyFreshAta: max(by(/fresh ATA \(idempotent/)), buyAtaExists: max(by(/no create|derived buy/)), buyIdempotentOnExisting: max(by(/idempotent create, holder/)), sell: max(by(/ sell .*holder|derived sell/)) }));
