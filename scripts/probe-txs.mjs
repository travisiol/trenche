import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM, DISCRIMINATORS } from "../src/engine/solana/pump/pdas.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b58 = (u8) => { const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const d=[0]; for(const b of u8){let c=b;for(let i=0;i<d.length;i++){c+=d[i]<<8;d[i]=c%58;c=(c/58)|0;}while(c>0){d.push(c%58);c=(c/58)|0;}} let s="";for(let i=0;i<u8.length&&u8[i]===0;i++)s+="1";for(let i=d.length-1;i>=0;i--)s+=A[d[i]];return s;};
const dec = (s) => { const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const b=[0]; for(const ch of s){let c=A.indexOf(ch);for(let i=0;i<b.length;i++){c+=b[i]*58;b[i]=c&255;c>>=8;}while(c>0){b.push(c&255);c>>=8;}} for(let i=0;i<s.length&&s[i]==="1";i++)b.push(0); return Uint8Array.from(b.reverse()); };
const want = { buy: DISCRIMINATORS.buy, sell: DISCRIMINATORS.sell, create_v2: DISCRIMINATORS.createV2, create: DISCRIMINATORS.create, collect: DISCRIMINATORS.collectCreatorFee };
async function scan(label, url, limit, delay) {
  const conn = new Connection(url, "confirmed");
  const pump = new PublicKey(PUMP_PROGRAM);
  const sigs = await conn.getSignaturesForAddress(pump, { limit });
  console.log(`\n### ${label}: ${sigs.length} recent sigs, newest ${sigs[0]?.blockTime ? new Date(sigs[0].blockTime*1000).toISOString() : "?"}`);
  const seen = new Set();
  for (const s of sigs) {
    if (seen.size >= Object.keys(want).length) break;
    if (s.err) continue;
    await sleep(delay);
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    if (!tx) continue;
    const msg = tx.transaction.message;
    const keys = msg.staticAccountKeys ?? msg.accountKeys;
    const loaded = tx.meta?.loadedAddresses;
    const all = [...keys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
    const ixs = msg.compiledInstructions ?? msg.instructions;
    for (const ix of ixs) {
      const pid = all[ix.programIdIndex];
      if (!pid || pid.toBase58() !== PUMP_PROGRAM) continue;
      const data = ix.data instanceof Uint8Array ? ix.data : dec(ix.data);
      const idx = ix.accountKeyIndexes ?? ix.accounts;
      for (const [name, d] of Object.entries(want)) {
        if (d.every((b, i) => data[i] === b) && !seen.has(name)) {
          seen.add(name);
          console.log(`-- ${name} in ${s.signature} slot ${s.slot}: ${idx.length} accounts, data ${data.length} bytes, tail hex ${Buffer.from(data.subarray(8)).toString("hex")}`);
          idx.forEach((k, i) => console.log(`   ${i} ${all[k]?.toBase58()}`));
        }
      }
    }
  }
}
await scan("DEVNET", "https://api.devnet.solana.com", 60, 1200);
await scan("MAINNET", "https://solana-rpc.publicnode.com", 40, 400);
