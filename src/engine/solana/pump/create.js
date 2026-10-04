import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  ATA_PROGRAM,
  DISCRIMINATORS,
  PUMP_MAYHEM_PROGRAM,
  PUMP_PROGRAM,
  TOKEN_2022_PROGRAM,
  associatedTokenAddress,
  bondingCurvePda,
  eventAuthorityPda,
  globalPda,
  mayhemGlobalParamsPda,
  mayhemSolVaultPda,
  mayhemStatePda,
  mintAuthorityPda,
} from "./pdas.js";

var PUMP_PROGRAM_KEY = new PublicKey(PUMP_PROGRAM),
  MAYHEM_PROGRAM_KEY = new PublicKey(PUMP_MAYHEM_PROGRAM),
  TOKEN_2022_KEY = new PublicKey(TOKEN_2022_PROGRAM),
  ATA_PROGRAM_KEY = new PublicKey(ATA_PROGRAM),
  meta = (t, e, r) => ({
    pubkey: t,
    isSigner: e,
    isWritable: r,
  });

function borshString(t) {
  const e = Buffer.from(t, "utf8"),
    r = Buffer.alloc(4);
  return (r.writeUInt32LE(e.length), Buffer.concat([r, e]));
}

export function createV2Instruction(t) {
  const e = bondingCurvePda(t.mint),
    r = mayhemSolVaultPda(),
    n = Buffer.concat([
      Buffer.from(DISCRIMINATORS.createV2),
      borshString(t.name),
      borshString(t.symbol),
      borshString(t.uri),
      t.creator.toBuffer(),
      Buffer.from([0]),
      Buffer.from([t.cashback ? 1 : 0]),
    ]),
    a = [
      meta(t.mint, !0, !0),
      meta(mintAuthorityPda(), !1, !1),
      meta(e, !1, !0),
      meta(associatedTokenAddress(e, t.mint, TOKEN_2022_KEY), !1, !0),
      meta(globalPda(), !1, !1),
      meta(t.user, !0, !0),
      meta(SystemProgram.programId, !1, !1),
      meta(TOKEN_2022_KEY, !1, !1),
      meta(ATA_PROGRAM_KEY, !1, !1),
      meta(MAYHEM_PROGRAM_KEY, !1, !0),
      meta(mayhemGlobalParamsPda(), !1, !1),
      meta(r, !1, !0),
      meta(mayhemStatePda(t.mint), !1, !0),
      meta(associatedTokenAddress(t.mint, r, TOKEN_2022_KEY), !1, !0),
      meta(eventAuthorityPda(), !1, !1),
      meta(PUMP_PROGRAM_KEY, !1, !1),
    ];
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_KEY,
    keys: a,
    data: n,
  });
}

export function generateMint(t, e = 2e5) {
  if (!t) return Keypair.generate();
  const r = t.toLowerCase();
  for (let n = 0; n < e; n++) {
    const a = Keypair.generate();
    if (a.publicKey.toBase58().toLowerCase().endsWith(r)) return a;
  }
  return Keypair.generate();
}
