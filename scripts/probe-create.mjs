import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM, DISCRIMINATORS, mintAuthorityPda } from "../src/engine/solana/pump/pdas.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (s) => { const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const b=[0]; for(const ch of s){let c=A.indexOf(ch);for(let i=0;i<b.length;i++){c+=b[i]*58;b[i]=c&255;c>>=8;}while(c>0){b.push(c&255);c>>=8;}} for(let i=0;i<s.length&&s[i]==="1";i++)b.push(0); return Uint8Array.from(b.reverse()); };
for (const [label, url] of [["MAINNET", "https://solana-rpc.publicnode.com"], ["DEVNET", "https://api.devnet.solana.com"]]) {
  const conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  await sleep(1500);
  const sigs = await conn.getSignaturesForAddress(mintAuthorityPda(), { limit: 5 }).catch((e) => { console.log(label, "sigs error", e.message.slice(0, 100)); return []; });
  let found = 0;
  for (const s of sigs) {
    if (s.err || found >= 2) continue;
    await sleep(1500);
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    if (!tx) { console.log("no tx"); continue; }
    const msg = tx.transaction.message; const keys = msg.staticAccountKeys; const la = tx.meta?.loadedAddresses; const all = [...keys, ...(la?.writable ?? []), ...(la?.readonly ?? [])];
    for (const ix of msg.compiledInstructions) {
      if (all[ix.programIdIndex]?.toBase58() !== PUMP_PROGRAM) continue;
      const d = ix.data instanceof Uint8Array ? ix.data : dec(ix.data);
      const isV2 = DISCRIMINATORS.createV2.every((b, i) => d[i] === b), isV1 = DISCRIMINATORS.create.every((b, i) => d[i] === b);
      if (!isV2 && !isV1) continue;
      found++;
      console.log(`${label} ${isV2 ? "create_v2" : "create(v1)"} ${s.signature} slot ${s.slot}: ${ix.accountKeyIndexes.length} accounts, data ${d.length} bytes`);
      let o = 8; const rd = () => { const n = Buffer.from(d).readUInt32LE(o); const v = Buffer.from(d.subarray(o+4, o+4+n)).toString(); o += 4+n; return v; };
      console.log("  name", JSON.stringify(rd()), "symbol", rd(), "uri", rd().slice(0, 50), "tail after creator:", Buffer.from(d.subarray(o+32)).toString("hex"));
      ix.accountKeyIndexes.forEach((k, i) => console.log("   ", i, all[k]?.toBase58()));
    }
  }
}
