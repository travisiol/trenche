/* Bundle BUILD proof on mainnet without sending anything: builds the create(+dev buy) and 4 buy transactions
 * with the TRENCH engine, then simulates each one against the mainnet RPC with sigVerify:false and
 * replaceRecentBlockhash:true. Signers are impersonated (funded exchange wallets, signatures are garbage) so the
 * programs run with real balances. Nothing is broadcast. Usage: node scripts/sim-bundle.mjs [rpcUrl] */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { prepareLaunch } from "../src/engine/solana/pump/launch.js";
import { buildBuyTx, buildSellTx, planBuys, planSells, signWith } from "../src/engine/solana/pump/math.js";
import { createV2Instruction } from "../src/engine/solana/pump/create.js";
import { randomBuybackFeeRecipient, randomFeeRecipient, sellInstruction } from "../src/engine/solana/pump/instructions.js";
import { associatedTokenAddress, bondingCurvePda, mintAuthorityPda, parseBondingCurve, TOKEN_2022_PROGRAM, tokenProgramFor } from "../src/engine/solana/pump/pdas.js";
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const rpc = process.argv[2] || "https://solana-rpc.publicnode.com";
const conn = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** a "keypair" whose public key is a funded mainnet wallet: signatures are invalid, simulation ignores them */
const impersonate = (address) => ({ publicKey: new PublicKey(address), secretKey: Keypair.generate().secretKey });
const FUNDED = {
  dev: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", // Binance 1
  buyers: ["5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", "GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ"],
};

async function simulate(label, tx) {
  await sleep(700);
  const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).catch((e) => ({ value: { err: e.message, logs: [] } }));
  const v = r.value;
  const logs = v.logs ?? [];
  const ok = !v.err;
  console.log(`\n== ${label}: ${ok ? "OK" : "ERR " + JSON.stringify(v.err)}  size=${tx.serialize().length}B  CU=${v.unitsConsumed ?? "?"}`);
  for (const l of logs.filter((l) => /invoke \[1\]|success|failed|Error|error|Instruction:|consumed/.test(l)).slice(0, 24)) console.log("   " + l);
  return ok;
}

const results = {};
const dev = impersonate(FUNDED.dev);
const mintKp = Keypair.generate();
const rows = FUNDED.buyers.map((a, i) => ({ label: `buyer-${i + 1}`, signer: impersonate(a), solIn: BigInt(300_000_000 + i * 50_000_000), cuPrice: 2_000_000 }));
const prep = await prepareLaunch(conn, { dev, name: "TRENCH SIM", symbol: "TSIM", uri: "https://ipfs.io/ipfs/bafkreigq4mzj6jxqj3xthtp5mp4oqzkk2rl3wxfmvmsrq3lg3uc5hlerru", devBuyLamports: BigInt(500_000_000), mint: mintKp, cashback: false }, rows, { cuPrice: 2_000_000, slippageBps: 3000, tipLamports: BigInt(1_000_000) });
console.log(`mint ${mintKp.publicKey.toBase58()} · atomic dev buy: ${prep.atomic} · createHasTip: ${prep.createHasTip} · buy txs: ${prep.buyTxs.length}`);
results.create = await simulate("create_v2 + ATA + tip + dev buy (bundle tx 1/5)", prep.createTx);

// the old 2-byte args tail (donchain build) for comparison
{
  const ix = createV2Instruction({ mint: mintKp.publicKey, user: dev.publicKey, creator: dev.publicKey, name: "TRENCH SIM", symbol: "TSIM", uri: "ipfs://x", cashback: false });
  const shortIx = ix; // the engine's own 2-byte tail; the official frontend sends 11 bytes (both accepted: trailing Option* args)
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: dev.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), shortIx] }).compileToV0Message());
  results.createOldArgs = await simulate("create_v2 with the 2-byte args tail the engine sends (creator_fee_bps / holder_reward omitted)", tx);
}

// the 4 bundle buys as built: simulated alone they must fail on the not-yet-created curve (bundle txs 2..5)
for (let i = 0; i < prep.buyTxs.length; i++) results[`bundleBuy${i + 1}`] = await simulate(`bundle buy ${i + 1}/${prep.buyTxs.length} (${prep.buyRows[i].label}, ${Number(prep.buyRows[i].solIn) / 1e9} SOL) — curve absent outside the bundle`, prep.buyTxs[i]);

// the same buy builder against a LIVE curve (latest create on mainnet) proves the buy account layout
await sleep(1000);
const sigs = await conn.getSignaturesForAddress(mintAuthorityPda(), { limit: 8 });
let live = null;
for (const s of sigs) {
  if (s.err) continue;
  await sleep(900);
  const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
  if (!tx) continue;
  const keys = tx.transaction.message.staticAccountKeys;
  for (const k of keys) {
    const pda = bondingCurvePda(k);
    if (keys.some((x) => x.equals(pda))) {
      live = { mint: k, user: keys[0] };
      break;
    }
  }
  if (live) break;
}
if (live) {
  await sleep(900);
  const info = await conn.getAccountInfo(bondingCurvePda(live.mint), "confirmed");
  const curve = parseBondingCurve(info.data);
  const mintInfo = await conn.getAccountInfo(live.mint, "confirmed");
  const tokenProgram = tokenProgramFor(mintInfo?.owner.toBase58() ?? TOKEN_2022_PROGRAM);
  console.log(`\nlive mint ${live.mint.toBase58()} · complete=${curve.complete} · creator ${curve.creator.toBase58()} · vSol ${Number(curve.virtualSolReserves) / 1e9}`);
  const plans = planBuys(rows, curve, 3000);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  for (let i = 0; i < 4; i++) {
    const tx = signWith(buildBuyTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 2_000_000, ataExists: false, tipLamports: BigInt(1_000_000), recentBlockhash: blockhash }, plans[i]), rows[i].signer);
    results[`liveBuy${i + 1}`] = await simulate(`buy on live curve ${i + 1}/4 (${rows[i].label})`, tx);
  }
  // sell layout: buy then sell 50 % of the bought tokens inside ONE transaction (simulation applies the buy first)
  {
    const buyer = rows[0].signer;
    const p = plans[0];
    const buyTx = buildBuyTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 2_000_000, ataExists: false, tipLamports: 0n, recentBlockhash: blockhash }, p);
    const sellIx = sellInstruction({ mint: live.mint, user: buyer.publicKey, creator: curve.creator, tokenProgram, feeRecipient: randomBuybackFeeRecipient(), buybackFeeRecipient: randomFeeRecipient() }, p.expectedTokens / 2n, 0n, curve.isCashbackCoin);
    const msg = TransactionMessage.decompile(buyTx.message);
    msg.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 });
    msg.instructions.push(sellIx);
    const tx = new VersionedTransaction(msg.compileToV0Message());
    results.liveBuyThenSell = await simulate(`buy ${Number(p.solIn) / 1e9} SOL then SELL ${Number(p.expectedTokens / 2n) / 1e6} tokens in one tx (buyer-1, sell layout)`, tx);
  }
  // sell: the dev of that live mint holds tokens (dev buy) — simulate selling 50 % of its ATA balance
  await sleep(900);
  const ata = await conn.getTokenAccountBalance(associatedTokenAddress(live.user, live.mint, tokenProgram), "confirmed").catch(() => null);
  const held = BigInt(ata?.value?.amount ?? "0");
  if (held > 0n) {
    const seller = impersonate(live.user.toBase58());
    const sp = planSells([{ label: "dev", signer: seller, tokens: held / 2n }], curve, 3000);
    const tx = signWith(buildSellTx({ mint: live.mint, creator: curve.creator, tokenProgram, cuPrice: 2_000_000, tipLamports: 0n, recentBlockhash: blockhash, cashback: curve.isCashbackCoin }, sp[0]), seller);
    results.liveSell = await simulate(`sell 50 % of ${Number(held) / 1e6} tokens by the live mint's creator ${live.user.toBase58().slice(0, 6)}…`, tx);
  } else console.log("\n(live creator holds no tokens: sell simulation skipped)");
} else console.log("\n(no live curve found in the last 8 creates: live buy simulation skipped)");

console.log("\nSUMMARY", JSON.stringify(results));
