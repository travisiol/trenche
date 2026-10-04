import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ATA_PROGRAM,
  PUMP_BUYBACK_FEE_RECIPIENTS,
  PUMP_FEE_PROGRAM,
  PUMP_FEE_RECIPIENTS,
  PUMP_MAYHEM_PROGRAM,
  PUMP_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  eventAuthorityPda,
  feeConfigPda,
  globalPda,
  globalVolumePda,
  mayhemGlobalParamsPda,
  mayhemSolVaultPda,
  mintAuthorityPda,
} from "./pump/pdas.js";
import { latestBlockhash, sendAndConfirm } from "./send.js";

function altAddresses() {
  return [
    new PublicKey(PUMP_PROGRAM),
    new PublicKey(PUMP_FEE_PROGRAM),
    new PublicKey(PUMP_MAYHEM_PROGRAM),
    new PublicKey(SYSTEM_PROGRAM),
    new PublicKey(TOKEN_2022_PROGRAM),
    new PublicKey(ATA_PROGRAM),
    ComputeBudgetProgram.programId,
    mintAuthorityPda(),
    globalPda(),
    eventAuthorityPda(),
    globalVolumePda(),
    feeConfigPda(),
    mayhemGlobalParamsPda(),
    mayhemSolVaultPda(),
    ...PUMP_BUYBACK_FEE_RECIPIENTS.map(t => new PublicKey(t)),
    ...PUMP_FEE_RECIPIENTS.map(t => new PublicKey(t)),
  ];
}

var sleep = t => new Promise(e => setTimeout(e, t));

async function loadUsableAlt(t, e) {
  let r;
  try {
    r = new PublicKey(e);
  } catch {
    return null;
  }
  const a = (await t.getAddressLookupTable(r).catch(() => null))?.value;
  if (!a) return null;
  const o = new Set(a.state.addresses.map(s => s.toBase58()));
  return altAddresses().every(s => o.has(s.toBase58())) ? a : null;
}

async function sendAltTx(t, e, r) {
  const { blockhash: n, lastValidBlockHeight: a } = await latestBlockhash(t),
    o = new VersionedTransaction(
      new TransactionMessage({
        payerKey: e.publicKey,
        recentBlockhash: n,
        instructions: r,
      }).compileToV0Message(),
    );
  o.sign([e]);
  const i = await sendAndConfirm(t, t, o, {
    lastValidBlockHeight: a,
    simulateConn: t,
  });
  if (!i.confirmed) throw new Error(`ALT setup failed: ${i.error ?? "not confirmed"}`);
  return i;
}

async function createAlt(t, e) {
  const r = altAddresses(),
    n = await t.getSlot("finalized"),
    [a, o] = AddressLookupTableProgram.createLookupTable({
      authority: e.publicKey,
      payer: e.publicKey,
      recentSlot: n,
    }),
    i = r.slice(0, 20),
    s = r.slice(20);
  (await sendAltTx(t, e, [
    a,
    AddressLookupTableProgram.extendLookupTable({
      payer: e.publicKey,
      authority: e.publicKey,
      lookupTable: o,
      addresses: i,
    }),
  ]),
    s.length &&
      (await sendAltTx(t, e, [
        AddressLookupTableProgram.extendLookupTable({
          payer: e.publicKey,
          authority: e.publicKey,
          lookupTable: o,
          addresses: s,
        }),
      ])));
  for (let c = 0; c < 20; c++) {
    const d = await loadUsableAlt(t, o.toBase58());
    if (d)
      return (
        await sleep(600),
        {
          table: d,
          address: o.toBase58(),
        }
      );
    await sleep(500);
  }
  throw new Error("ALT created but not active yet (retry the launch).");
}

export async function ensureAlt(t, e, r) {
  try {
    if (r) {
      const n = await loadUsableAlt(t, r);
      if (n)
        return {
          table: n,
          address: r,
        };
    }
    return await createAlt(t, e);
  } catch {
    return null;
  }
}
