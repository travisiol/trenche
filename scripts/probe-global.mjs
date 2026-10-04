import { Connection, PublicKey } from "@solana/web3.js";
import { globalPda, PUMP_FEE_RECIPIENTS, PUMP_BUYBACK_FEE_RECIPIENTS } from "../src/engine/solana/pump/pdas.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [label, url] of [["MAINNET", "https://solana-rpc.publicnode.com"], ["DEVNET", "https://api.devnet.solana.com"]]) {
  const conn = new Connection(url, "confirmed");
  await sleep(1200);
  const info = await conn.getAccountInfo(globalPda(), "confirmed");
  const b = Buffer.from(info.data);
  console.log(`\n### ${label} Global ${b.length} bytes`);
  let o = 8;
  const pk = () => { const v = new PublicKey(b.subarray(o, o + 32)).toBase58(); o += 32; return v; };
  const u64 = () => { const v = b.readBigUInt64LE(o); o += 8; return v; };
  const u8 = () => b[o++];
  const g = {};
  g.initialized = u8(); g.authority = pk(); g.fee_recipient = pk(); g.ivt = u64(); g.ivs = u64(); g.irt = u64(); g.supply = u64(); g.fee_bps = u64(); g.withdraw_authority = pk(); g.enable_migrate = u8(); g.pool_migration_fee = u64(); g.creator_fee_bps = u64();
  g.fee_recipients = Array.from({ length: 7 }, pk); g.set_creator_authority = pk(); g.admin_set_creator_authority = pk(); g.create_v2_enabled = u8(); g.whitelist_pda = pk(); g.reserved_fee_recipient = pk();
  console.log(JSON.stringify({ ...g, ivt: String(g.ivt), ivs: String(g.ivs), irt: String(g.irt), supply: String(g.supply), fee_bps: String(g.fee_bps), pool_migration_fee: String(g.pool_migration_fee), creator_fee_bps: String(g.creator_fee_bps) }, null, 1));
  console.log(`offset after reserved_fee_recipient: ${o}; remaining ${b.length - o} bytes`);
  // scan the tail for pubkey-looking chunks (buyback recipients etc.)
  for (let p = o; p + 32 <= b.length; p++) {
    const v = new PublicKey(b.subarray(p, p + 32)).toBase58();
    if (PUMP_BUYBACK_FEE_RECIPIENTS.includes(v) || PUMP_FEE_RECIPIENTS.includes(v)) console.log(`  @${p} ${v} ${PUMP_BUYBACK_FEE_RECIPIENTS.includes(v) ? "(engine BUYBACK list)" : "(engine FEE list)"}`);
  }
  console.log("tail hex:", b.subarray(o).toString("hex"));
  const all = [g.fee_recipient, ...g.fee_recipients];
  console.log("fee_recipient+fee_recipients vs engine PUMP_FEE_RECIPIENTS:", all.every((x) => PUMP_FEE_RECIPIENTS.includes(x)) && PUMP_FEE_RECIPIENTS.every((x) => all.includes(x)) ? "IDENTICAL" : "DIFFERENT");
}
