import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { appendFileSync } from "node:fs";
const out = process.argv[2];
const target = new PublicKey("3JqRQbAqwwfpHdbvwF4zH6Rr9GQWE7hrfvmuLgNTstSk");
const c = new Connection("https://api.devnet.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true });
for (let i = 0; i < 24; i++) {
  try {
    const sig = await c.requestAirdrop(target, 2 * LAMPORTS_PER_SOL);
    appendFileSync(out, `${new Date().toISOString()} OK ${sig}\n`);
    break;
  } catch (e) {
    appendFileSync(out, `${new Date().toISOString()} ${String(e.message).replace(/\s+/g, " ").slice(0, 90)}\n`);
  }
  await new Promise((r) => setTimeout(r, 5 * 60_000));
}
