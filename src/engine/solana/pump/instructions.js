import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  DISCRIMINATORS,
  PUMP_BUYBACK_FEE_RECIPIENTS,
  PUMP_FEE_PROGRAM,
  PUMP_FEE_RECIPIENTS,
  PUMP_PROGRAM,
  SYSTEM_PROGRAM,
  associatedTokenAddress,
  bondingCurvePda,
  bondingCurveV2Pda,
  creatorVaultPda,
  eventAuthorityPda,
  feeConfigPda,
  globalPda,
  globalVolumePda,
  userVolumePda,
} from "./pdas.js";

export var PUMP_PROGRAM_KEY = new PublicKey(PUMP_PROGRAM),
  PUMP_FEE_PROGRAM_KEY = new PublicKey(PUMP_FEE_PROGRAM),
  SYSTEM_PROGRAM_KEY = new PublicKey(SYSTEM_PROGRAM),
  u64le = t => {
    const e = Buffer.alloc(8);
    return (e.writeBigUInt64LE(t), e);
  },
  randomBuybackFeeRecipient = t =>
    new PublicKey(PUMP_BUYBACK_FEE_RECIPIENTS[t ?? Math.floor(Math.random() * PUMP_BUYBACK_FEE_RECIPIENTS.length)]),
  randomFeeRecipient = t =>
    new PublicKey(PUMP_FEE_RECIPIENTS[t ?? Math.floor(Math.random() * PUMP_FEE_RECIPIENTS.length)]),
  meta = (t, e, r) => ({
    pubkey: t,
    isSigner: e,
    isWritable: r,
  });

export function buyInstruction(t, e, r, n = !0) {
  const a = bondingCurvePda(t.mint),
    o = Buffer.concat([Buffer.from(DISCRIMINATORS.buy), u64le(e), u64le(r), Buffer.from([n ? 1 : 0])]),
    i = [
      meta(globalPda(), !1, !1),
      meta(t.feeRecipient, !1, !0),
      meta(t.mint, !1, !1),
      meta(a, !1, !0),
      meta(associatedTokenAddress(a, t.mint, t.tokenProgram), !1, !0),
      meta(associatedTokenAddress(t.user, t.mint, t.tokenProgram), !1, !0),
      meta(t.user, !0, !0),
      meta(SYSTEM_PROGRAM_KEY, !1, !1),
      meta(t.tokenProgram, !1, !1),
      meta(creatorVaultPda(t.creator), !1, !0),
      meta(eventAuthorityPda(), !1, !1),
      meta(PUMP_PROGRAM_KEY, !1, !1),
      meta(globalVolumePda(), !1, !1),
      meta(userVolumePda(t.user), !1, !0),
      meta(feeConfigPda(), !1, !1),
      meta(PUMP_FEE_PROGRAM_KEY, !1, !1),
      meta(bondingCurveV2Pda(t.mint), !1, !1),
      meta(t.buybackFeeRecipient, !1, !0),
    ];
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_KEY,
    keys: i,
    data: o,
  });
}

export function collectCreatorFeeInstruction(t) {
  const e = [
    meta(t, !1, !0),
    meta(creatorVaultPda(t), !1, !0),
    meta(SYSTEM_PROGRAM_KEY, !1, !1),
    meta(eventAuthorityPda(), !1, !1),
    meta(PUMP_PROGRAM_KEY, !1, !1),
  ];
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_KEY,
    keys: e,
    data: Buffer.from(DISCRIMINATORS.collectCreatorFee),
  });
}

export function claimCashbackInstruction(t) {
  const e = [
    meta(t, !1, !0),
    meta(userVolumePda(t), !1, !0),
    meta(SYSTEM_PROGRAM_KEY, !1, !1),
    meta(eventAuthorityPda(), !1, !1),
    meta(PUMP_PROGRAM_KEY, !1, !1),
  ];
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_KEY,
    keys: e,
    data: Buffer.from(DISCRIMINATORS.claimCashback),
  });
}

export function sellInstruction(t, e, r, n = !1) {
  const a = bondingCurvePda(t.mint),
    o = Buffer.concat([Buffer.from(DISCRIMINATORS.sell), u64le(e), u64le(r)]),
    i = [
      meta(globalPda(), !1, !1),
      meta(t.feeRecipient, !1, !0),
      meta(t.mint, !1, !1),
      meta(a, !1, !0),
      meta(associatedTokenAddress(a, t.mint, t.tokenProgram), !1, !0),
      meta(associatedTokenAddress(t.user, t.mint, t.tokenProgram), !1, !0),
      meta(t.user, !0, !0),
      meta(SYSTEM_PROGRAM_KEY, !1, !1),
      meta(creatorVaultPda(t.creator), !1, !0),
      meta(t.tokenProgram, !1, !1),
      meta(eventAuthorityPda(), !1, !1),
      meta(PUMP_PROGRAM_KEY, !1, !1),
      meta(feeConfigPda(), !1, !1),
      meta(PUMP_FEE_PROGRAM_KEY, !1, !1),
      ...(n ? [meta(userVolumePda(t.user), !1, !0)] : []),
      meta(bondingCurveV2Pda(t.mint), !1, !1),
      meta(t.buybackFeeRecipient, !1, !0),
    ];
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_KEY,
    keys: i,
    data: o,
  });
}
