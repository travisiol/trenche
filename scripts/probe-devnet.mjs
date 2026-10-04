import { Connection, PublicKey } from "@solana/web3.js";
import { globalPda, globalVolumePda, feeConfigPda, eventAuthorityPda, mintAuthorityPda, mayhemGlobalParamsPda, mayhemSolVaultPda, PUMP_PROGRAM, PUMP_FEE_PROGRAM, PUMP_MAYHEM_PROGRAM } from "../src/engine/solana/pump/pdas.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = new Connection("https://api.devnet.solana.com", "confirmed");
const main = new Connection("https://solana-rpc.publicnode.com", "confirmed");
const list = { global: globalPda(), globalVolume: globalVolumePda(), feeConfig: feeConfigPda(), eventAuthority: eventAuthorityPda(), mintAuthority: mintAuthorityPda(), mayhemGlobalParams: mayhemGlobalParamsPda(), mayhemSolVault: mayhemSolVaultPda() };
for (const [k, v] of Object.entries(list)) {
  const d = await dev.getAccountInfo(v).catch((e) => ({ err: e.message }));
  await sleep(1500);
  const m = await main.getAccountInfo(v).catch((e) => ({ err: e.message }));
  console.log(k, v.toBase58(), "devnet:", d ? (d.err ?? `${d.data.length}B owner ${d.owner.toBase58()}`) : "null", "| mainnet:", m ? (m.err ?? `${m.data.length}B`) : "null");
  await sleep(1500);
}
for (const p of [PUMP_PROGRAM, PUMP_FEE_PROGRAM, PUMP_MAYHEM_PROGRAM]) {
  const pk = new PublicKey(p);
  const d = await dev.getAccountInfo(pk);
  await sleep(1500);
  const pd = new PublicKey(d.data.subarray(4, 36));
  const dd = await dev.getAccountInfo(pd, { dataSlice: { offset: 0, length: 45 } }).catch((e) => ({ err: e.message }));
  await sleep(1500);
  const m = await main.getAccountInfo(pk);
  const pm = new PublicKey(m.data.subarray(4, 36));
  const md = await main.getAccountInfo(pm, { dataSlice: { offset: 0, length: 45 } }).catch((e) => ({ err: e.message }));
  const slot = (b) => b?.data ? Number(Buffer.from(b.data).readBigUInt64LE(4)) : b?.err;
  console.log(p, "programdata devnet slot", slot(dd), "size", dd?.data ? "ok" : dd, "| mainnet slot", slot(md));
  await sleep(1500);
}
