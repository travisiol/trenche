/* Proof on devnet (real transactions, devnet SOL only): the create carries the dev buy AND the first bundle wallets'
 * buys in ONE transaction, thanks to two lookup tables (static pump.fun + one per launch) — exactly what runLaunch
 * now does (src/server/alt.ts + prepareLaunch `inlineMax`).
 *   DEV_KEY=<path to a JSON secret key array funded on devnet> RPC=<devnet rpc> node scripts/prove-inline-devnet.mjs
 * Prints the create signature, the instructions it holds and each buyer's token balance. */
import { readFileSync } from "node:fs";
import { AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ensureAlt } from "../src/engine/solana/alt.js";
import { executeLaunch, prepareLaunch } from "../src/engine/solana/pump/launch.js";
import { FRESH_CURVE } from "../src/engine/solana/pump/math.js";
import { PUMP_BUYBACK_FEE_RECIPIENTS, PUMP_FEE_RECIPIENTS, TOKEN_2022_PROGRAM, associatedTokenAddress, bondingCurvePda, bondingCurveV2Pda, creatorVaultPda, globalPda, userVolumePda } from "../src/engine/solana/pump/pdas.js";
import { sendAndConfirm, latestBlockhash } from "../src/engine/solana/send.js";

const conn = new Connection(process.env.RPC ?? "https://api.devnet.solana.com", "confirmed");
const dev = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.DEV_KEY, "utf8"))));
const N = Number(process.env.BUYERS ?? 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

async function send(ixs, signers) {
  const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }), ...ixs] }).compileToV0Message());
  tx.sign(signers);
  const r = await sendAndConfirm(conn, conn, tx, { lastValidBlockHeight, timeoutMs: 60_000 });
  if (!r.confirmed) throw new Error(`tx failed: ${r.error}`);
  return r.signature;
}

// devnet pump.fun constants (same as src/server/pumpcluster.ts)
const g = Buffer.from((await conn.getAccountInfo(globalPda())).data);
const pk = (o) => new PublicKey(g.subarray(o, o + 32)).toBase58();
PUMP_BUYBACK_FEE_RECIPIENTS.splice(0, PUMP_BUYBACK_FEE_RECIPIENTS.length, pk(41), ...Array.from({ length: 7 }, (_, i) => pk(162 + 32 * i)));
PUMP_FEE_RECIPIENTS.splice(0, PUMP_FEE_RECIPIENTS.length, ...Array.from({ length: 8 }, (_, i) => pk(741 + 32 * i)));
FRESH_CURVE.virtualTokenReserves = g.readBigUInt64LE(73);
FRESH_CURVE.virtualSolReserves = g.readBigUInt64LE(81);
FRESH_CURVE.realTokenReserves = g.readBigUInt64LE(89);
log("dev", dev.publicKey.toBase58(), "balance", (await conn.getBalance(dev.publicKey)) / LAMPORTS_PER_SOL);

// bundle wallets, funded by the dev
const buyers = Array.from({ length: N }, () => Keypair.generate());
await send(buyers.map((b) => SystemProgram.transfer({ fromPubkey: dev.publicKey, toPubkey: b.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL })), [dev]);
log("funded", N, "bundle wallets with 0.06 SOL");

// lookup tables (static + this launch), as src/server/alt.ts
const mint = Keypair.generate();
const t0 = Date.now();
const [stat, perLaunch] = await Promise.all([
  ensureAlt(conn, dev, process.env.STATIC_ALT ?? null),
  (async () => {
    const tp = new PublicKey(TOKEN_2022_PROGRAM);
    const curve = bondingCurvePda(mint.publicKey);
    const addresses = [curve, associatedTokenAddress(curve, mint.publicKey, tp), creatorVaultPda(dev.publicKey), bondingCurveV2Pda(mint.publicKey), ...[dev, ...buyers].flatMap((u) => [associatedTokenAddress(u.publicKey, mint.publicKey, tp), userVolumePda(u.publicKey)])];
    const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: dev.publicKey, payer: dev.publicKey, recentSlot: await conn.getSlot("finalized") });
    await send([create, AddressLookupTableProgram.extendLookupTable({ payer: dev.publicKey, authority: dev.publicKey, lookupTable: address, addresses })], [dev]);
    for (let i = 0; i < 40; i++) {
      const t = (await conn.getAddressLookupTable(address).catch(() => null))?.value;
      if (t && (await conn.getSlot("processed")) > Number(t.state.lastExtendedSlot)) return t;
      await sleep(250);
    }
    throw new Error("launch table never became usable");
  })(),
]);
log("tables ready in", Date.now() - t0, "ms · static", stat?.address ?? "NONE", "· launch", perLaunch.key.toBase58());

const prep = await prepareLaunch(
  conn,
  { dev, name: "INLINE", symbol: "INL", uri: "https://ipfs.io/ipfs/bafkreiei4bsikx7n6a7sumkwlz7ci2mezjhajclxuvrf3nl3c2louwqx2q", devBuyLamports: BigInt(0.03 * LAMPORTS_PER_SOL), mint },
  buyers.map((b, i) => ({ label: `w${i + 1}`, signer: b, solIn: BigInt(0.03 * LAMPORTS_PER_SOL), cuPrice: 100_000 })),
  { cuPrice: 100_000, slippageBps: 3000, tipLamports: BigInt(process.env.TIP_LAMPORTS ?? 0), lookupTables: [stat?.table, perLaunch].filter(Boolean), inlineMax: N },
);
log("create tx", prep.createTx.serialize().length, "bytes · dev buy inside:", prep.atomic, "· bundle wallets inside:", prep.inline, "· separate buy txs:", prep.buyTxs.length);

const r = await executeLaunch(conn, conn, prep, { onNote: (n) => log("note:", n) });
log("create", r.create.confirmed ? "CONFIRMED" : "FAILED", r.create.signature, r.create.error ?? "");
const tx = await conn.getTransaction(r.create.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
log("slot", tx?.slot, "· CU used", tx?.meta?.computeUnitsConsumed, "· fee", (tx?.meta?.fee ?? 0) / LAMPORTS_PER_SOL, "SOL · err", JSON.stringify(tx?.meta?.err));
const buys = (tx?.meta?.logMessages ?? []).filter((l) => /Instruction: Buy/.test(l)).length;
log("pump.fun Buy instructions inside the create transaction:", buys);
const tp = new PublicKey(TOKEN_2022_PROGRAM);
for (const [label, w] of [["dev", dev], ...buyers.map((b, i) => [`w${i + 1}`, b])]) {
  const bal = await conn.getTokenAccountBalance(associatedTokenAddress(w.publicKey, mint.publicKey, tp)).catch(() => null);
  log(label, w.publicKey.toBase58().slice(0, 8), "tokens:", bal?.value.uiAmountString ?? "none");
}
console.log(`https://solscan.io/tx/${r.create.signature}?cluster=devnet`);
