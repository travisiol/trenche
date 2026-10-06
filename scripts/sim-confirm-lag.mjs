/* Offline (fake chain, no network): how long after a create LANDS does executeLaunch report it — push (WebSocket
 * watch) vs poll. LAND_MS=7000 node scripts/sim-confirm-lag.mjs. The pre-2026-10-06 engine polled ×1.35 up to 2.5 s:
 * ~1.1 s of lag here, ~4 s on BkzF3c… with a real RPC. */
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { executeLaunch } from "../src/engine/solana/pump/launch.js";
import { base58Encode } from "../src/engine/solana/keys.js";

const LAND_MS = Number(process.env.LAND_MS ?? 7000); // send → processed (BkzF3c…: ~7 s)
const CONF_MS = 900; // processed → confirmed
function fakeChain() {
  const sent = new Map();
  let calls = 0;
  const statusOf = (sig) => {
    const t = sent.get(sig);
    if (t === undefined) return null;
    const age = Date.now() - t;
    if (age < LAND_MS) return null;
    return { slot: 1, err: null, confirmationStatus: age >= LAND_MS + CONF_MS ? "confirmed" : "processed" };
  };
  const conn = {
    calls: () => calls,
    simulateTransaction: async () => ((calls++), { value: { err: null, logs: [] } }),
    sendRawTransaction: async (raw) => {
      calls++;
      const sig = base58Encode(VersionedTransaction.deserialize(raw).signatures[0]);
      if (!sent.has(sig)) sent.set(sig, Date.now());
      return sig;
    },
    getSignatureStatuses: async (sigs) => ((calls++), { value: sigs.map(statusOf) }),
    getBlockHeight: async () => ((calls++), 1),
    getAccountInfo: async () => ((calls++), null),
    watch: (sig) => {
      const at = () => sent.get(sig);
      const when = (ms) => new Promise((r) => { const tick = () => (at() !== undefined && Date.now() - at() >= ms ? r({ err: null, at: Date.now() }) : setTimeout(tick, 5)); tick(); });
      return { processed: when(LAND_MS), confirmed: when(LAND_MS + CONF_MS) };
    },
    sent,
  };
  return conn;
}
const payer = Keypair.generate();
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: "6HLXHmFP5V2jkEfSmuQSHnoei5CAB4eYydR1ujWTGgrS", instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })] }).compileToV0Message());
tx.sign([payer]);
const prep = { mint: Keypair.generate(), createTx: tx, createHasTip: false, buyTxs: [], atomic: true, lastValidBlockHeight: 1000 };
for (const mode of (process.env.MODES ?? "push,poll").split(",")) {
  const c = fakeChain();
  const t0 = Date.now();
  let seenMs = null;
  const r = await executeLaunch(c, c, { ...prep }, mode === "push" ? { watch: c.watch, onSeen: (ms) => (seenMs = ms) } : { onSeen: (ms) => (seenMs = ms) });
  const total = Date.now() - t0;
  console.log(`${mode.padEnd(5)} confirmed=${r.create.confirmed} · reported ${total} ms after the send · landed (processed) at ${LAND_MS} ms, confirmed on chain at ${LAND_MS + CONF_MS} ms → detection lag ${total - LAND_MS - CONF_MS} ms · seen(processed) reported at ${seenMs} ms · RPC calls ${c.calls()}`);
}
