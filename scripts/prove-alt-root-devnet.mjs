/* Devnet proof (devnet SOL only): a transaction that reads an address from a lookup table extended a moment ago does
 * not land until that extend is ROOTED (finalized), however early it is sent — leaders resolve tables against their
 * root bank. Same signer, same priority, same moment: a twin transaction without the table lands within a few slots.
 *   RPC=<devnet rpc> [DEV_KEY=<secret key json>] [ROUNDS=3] node scripts/prove-alt-root-devnet.mjs
 * Without DEV_KEY a throwaway keypair is airdropped 1 SOL. Prints, per round, the slots between the extend and each
 * landing, and the processed → finalized distance at that time. */
import { readFileSync } from "node:fs";
import { AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const conn = new Connection(process.env.RPC ?? "https://api.devnet.solana.com", "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
if (!/devnet/i.test(conn.rpcEndpoint)) throw new Error("devnet only");

let payer;
if (process.env.DEV_KEY) payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.DEV_KEY, "utf8"))));
else {
  payer = Keypair.generate();
  const sig = await conn.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
  for (let i = 0; i < 60 && !(await conn.getSignatureStatus(sig)).value?.confirmationStatus; i++) await sleep(500);
}
log("payer", payer.publicKey.toBase58(), (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL, "SOL");

async function sendRaw(ixs, tables = []) {
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }), ...ixs] }).compileToV0Message(tables));
  tx.sign([payer]);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  return { sig, raw };
}
/** send + re-broadcast every 400 ms until it lands; returns the landing slot */
async function land(ixs, tables = []) {
  const { sig, raw } = await sendRaw(ixs, tables);
  const sentSlot = await conn.getSlot("processed");
  for (let i = 0; i < 150; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { sig, sentSlot, slot: st.slot, err: st.err };
    if (i % 2 === 1) await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => null);
    await sleep(200);
  }
  return { sig, sentSlot, slot: null, err: "not landed in 30 s" };
}

const rounds = Number(process.env.ROUNDS ?? 3);
for (let r = 0; r < rounds; r++) {
  const target = Keypair.generate().publicKey; // a fresh address that only the table holds
  const recentSlot = await conn.getSlot("finalized");
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot });
  const ext = await land([create, AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: table, addresses: [target] })]);
  if (!ext.slot || ext.err) throw new Error(`table tx failed: ${JSON.stringify(ext.err)}`);
  // what alt.ts waited for before this fix: a CONFIRMED slot past the extend
  let t;
  for (;;) {
    t = (await conn.getAddressLookupTable(table, { commitment: "confirmed" })).value;
    if (t && (await conn.getSlot("confirmed")) > Number(t.state.lastExtendedSlot)) break;
    await sleep(150);
  }
  const extSlot = Number(t.state.lastExtendedSlot);
  const [tip, fin] = await Promise.all([conn.getSlot("processed"), conn.getSlot("finalized")]);
  log(`round ${r + 1}: table ${table.toBase58().slice(0, 8)} extended in slot ${extSlot} · processed − finalized = ${tip - fin} slots`);
  // twins sent at the same moment: 1 lamport to `target` through the table, and 1 lamport to `target` as a static key
  const ix = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: target, lamports: 890_880 });
  const ix2 = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 890_880 });
  const [withAlt, without] = await Promise.all([land([ix], [t]), land([ix2])]);
  log(`  with the fresh table: sent at slot ${withAlt.sentSlot}, landed ${withAlt.slot} → ${withAlt.slot ? withAlt.slot - withAlt.sentSlot : "—"} slots after the send, ${withAlt.slot ? withAlt.slot - extSlot : "—"} after the extend ${withAlt.err ? JSON.stringify(withAlt.err) : ""}`);
  log(`  no table (twin):      sent at slot ${without.sentSlot}, landed ${without.slot} → ${without.slot ? without.slot - without.sentSlot : "—"} slots after the send`);
  // the same transaction once the extend is finalized
  for (;;) {
    const f = (await conn.getAddressLookupTable(table, { commitment: "finalized" }).catch(() => null))?.value;
    if (f && f.state.addresses.length >= 1) break;
    await sleep(300);
  }
  const after = await land([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: target, lamports: 1 })], [t]);
  log(`  same table once FINALIZED: sent at slot ${after.sentSlot}, landed ${after.slot} → ${after.slot ? after.slot - after.sentSlot : "—"} slots after the send`);
  // rent back: deactivate (closable ~513 slots later — left to the devnet)
  await sendRaw([AddressLookupTableProgram.deactivateLookupTable({ lookupTable: table, authority: payer.publicKey })]).catch(() => null);
}
