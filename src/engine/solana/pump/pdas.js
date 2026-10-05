import { PublicKey } from "@solana/web3.js";

export var PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  PUMP_FEE_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  PUMP_MAYHEM_PROGRAM = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
  SYSTEM_PROGRAM = "11111111111111111111111111111111",
  TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export var PUMP_FEE_RECIPIENTS = [
    "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
    "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
    "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
    "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
    "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
    "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
    "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
    "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
  ],
  PUMP_BUYBACK_FEE_RECIPIENTS = [
    "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
    "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
    "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
    "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
    "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
    "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
    "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
  ],
  DISCRIMINATORS = {
    create: Uint8Array.from([24, 30, 200, 40, 5, 28, 7, 119]),
    createV2: Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]),
    buy: Uint8Array.from([102, 6, 61, 18, 1, 218, 235, 234]),
    buyV2: Uint8Array.from([184, 23, 238, 97, 103, 197, 211, 61]),
    sell: Uint8Array.from([51, 230, 133, 164, 1, 127, 131, 173]),
    sellV2: Uint8Array.from([93, 246, 130, 60, 231, 233, 64, 178]),
    migrate: Uint8Array.from([155, 234, 231, 146, 236, 158, 162, 30]),
    collectCreatorFee: Uint8Array.from([20, 22, 86, 123, 198, 28, 219, 132]),
    claimCashback: Uint8Array.from([37, 58, 35, 126, 190, 53, 228, 197]),
    extendAccount: Uint8Array.from([234, 102, 194, 203, 150, 72, 62, 229]),
  },
  BONDING_CURVE_DISCRIMINATOR = Uint8Array.from([23, 183, 248, 55, 96, 216, 172, 96]),
  SEEDS = {
    global: "global",
    mintAuthority: "mint-authority",
    bondingCurve: "bonding-curve",
    bondingCurveV2: "bonding-curve-v2",
    creatorVault: "creator-vault",
    eventAuthority: "__event_authority",
    feeConfig: "fee_config",
    globalVolume: "global_volume_accumulator",
    userVolume: "user_volume_accumulator",
  },
  PROTOCOL_FEE_BPS = 95n,
  CREATOR_FEE_BPS = 30n,
  TOTAL_FEE_BPS = PROTOCOL_FEE_BPS + CREATOR_FEE_BPS,
  INITIAL_VIRTUAL_SOL = 30000000000n,
  INITIAL_VIRTUAL_TOKENS = 1073000000000000n,
  INITIAL_REAL_TOKENS = 793100000000000n,
  TOKEN_TOTAL_SUPPLY = 1000000000000000n;

export var PUMP_PROGRAM_ID = new PublicKey(PUMP_PROGRAM),
  PUMP_FEE_PROGRAM_ID = new PublicKey(PUMP_FEE_PROGRAM),
  ATA_PROGRAM_ID = new PublicKey(ATA_PROGRAM),
  PUMP_MAYHEM_PROGRAM_ID = new PublicKey(PUMP_MAYHEM_PROGRAM),
  /* PDA derivations are pure but cost ~0.2–1 ms each (sha256 bump search): a buy derives ~8 of them, so they are
     memoized (bounded) — signing N transactions on the hot path no longer re-derives the same addresses. */
  pdaCache = new Map(),
  pda = (t, e) => {
    const k = e.toBase58() + ":" + t.map(b => Buffer.from(b).toString("hex")).join(":");
    let v = pdaCache.get(k);
    if (!v) {
      v = PublicKey.findProgramAddressSync(t, e)[0];
      if (pdaCache.size > 20000) pdaCache.clear();
      pdaCache.set(k, v);
    }
    return v;
  },
  globalPda = () => pda([Buffer.from(SEEDS.global)], PUMP_PROGRAM_ID),
  mintAuthorityPda = () => pda([Buffer.from(SEEDS.mintAuthority)], PUMP_PROGRAM_ID),
  eventAuthorityPda = () => pda([Buffer.from(SEEDS.eventAuthority)], PUMP_PROGRAM_ID),
  globalVolumePda = () => pda([Buffer.from(SEEDS.globalVolume)], PUMP_PROGRAM_ID),
  bondingCurvePda = t => pda([Buffer.from(SEEDS.bondingCurve), t.toBuffer()], PUMP_PROGRAM_ID),
  bondingCurveV2Pda = t => pda([Buffer.from(SEEDS.bondingCurveV2), t.toBuffer()], PUMP_PROGRAM_ID),
  creatorVaultPda = t => pda([Buffer.from(SEEDS.creatorVault), t.toBuffer()], PUMP_PROGRAM_ID),
  userVolumePda = t => pda([Buffer.from(SEEDS.userVolume), t.toBuffer()], PUMP_PROGRAM_ID),
  feeConfigPda = () => pda([Buffer.from(SEEDS.feeConfig), PUMP_PROGRAM_ID.toBuffer()], PUMP_FEE_PROGRAM_ID),
  mayhemGlobalParamsPda = () => pda([Buffer.from("global-params")], PUMP_MAYHEM_PROGRAM_ID),
  mayhemSolVaultPda = () => pda([Buffer.from("sol-vault")], PUMP_MAYHEM_PROGRAM_ID),
  mayhemStatePda = t => pda([Buffer.from("mayhem-state"), t.toBuffer()], PUMP_MAYHEM_PROGRAM_ID);

export function associatedTokenAddress(t, e, r) {
  return pda([t.toBuffer(), r.toBuffer(), e.toBuffer()], ATA_PROGRAM_ID);
}

export var tokenProgramFor = t => new PublicKey(t === TOKEN_2022_PROGRAM ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM);

export function parseBondingCurve(t) {
  const e = Buffer.from(t);
  if (e.length < 81) throw new Error(`bonding_curve account too short (${e.length} bytes).`);
  for (let r = 0; r < 8; r++)
    if (e[r] !== BONDING_CURVE_DISCRIMINATOR[r])
      throw new Error("This account is not a pump.fun bonding_curve (different discriminant).");
  return {
    virtualTokenReserves: e.readBigUInt64LE(8),
    virtualSolReserves: e.readBigUInt64LE(16),
    realTokenReserves: e.readBigUInt64LE(24),
    realSolReserves: e.readBigUInt64LE(32),
    tokenTotalSupply: e.readBigUInt64LE(40),
    complete: e[48] === 1,
    creator: new PublicKey(e.subarray(49, 81)),
    isCashbackCoin: e.length > 82 && e[82] === 1,
  };
}
