/* Fund movements: withdraw / transfer (one SOL transfer), disperse (distributeSol), consolidate (sweepSol),
 * and the "relay hop" option: source → fresh in-memory relay wallet → destination (the relay key is generated
 * for the hop and dropped; on a hop-2 failure the relay sweeps back to the source).
 * Every operation is a job; nothing is sent without an explicit API call from the UI. */
import { Keypair, PublicKey } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { distributeSol, sweepSol, type FundStep } from "@/engine/solana/fund.js";
import { HttpError, sleep, solString } from "./api";
import { readConn, requireUnlocked, sendConn, vaultWallets } from "./engine";
import { jobNew, jobNote, jobPush, jobRun, jobWait } from "./jobs";
import { logActivity, store, type Job } from "./store";

const TX_FEE_MARGIN = BigInt(12_000);
/** base fee of the relay's own transfer (hop 2 is sent without priority fee, like the engine's two-hop) */
const RELAY_FEE = BigInt(5_000);

function onStep(job: Job, phase?: string) {
  return (s: FundStep) => {
    if (s.phase === "wait") jobWait(job, s.delayMs ?? 0);
    else jobPush(job, s.phase === "sent", { phase: phase ?? s.phase, address: s.address, sol: s.sol, signature: s.signature ?? null, error: s.error });
  };
}

type HopResult = { ok: boolean; relay: string; hop1: string | null; hop2: string | null; error: string | null };

/** source → relay (amount + relay fee) → destination (amount). Both signatures land in the job. */
async function relayHop(job: Job, fromKp: Keypair, to: string, lamports: bigint, cuPrice: number): Promise<HopResult> {
  const conn = readConn();
  const relay = Keypair.generate();
  const relayAddr = relay.publicKey.toBase58();
  jobNote(job, `Relay wallet ${relayAddr} (fresh, in memory only)`, { phase: "relay", address: relayAddr });
  const h1 = await distributeSol({ conn, sendConn: sendConn(), fromKeypair: fromKp, plan: [{ address: relay.publicKey, lamports: lamports + RELAY_FEE }], cuPrice, onStep: onStep(job, "hop1") });
  const r1 = h1.results[0];
  if (!r1?.ok) return { ok: false, relay: relayAddr, hop1: r1?.signature ?? null, hop2: null, error: `hop 1/2 failed: ${r1?.error ?? "not confirmed"}` };
  const h2 = await distributeSol({ conn, sendConn: sendConn(), fromKeypair: relay, plan: [{ address: new PublicKey(to), lamports }], cuPrice: 0, onStep: onStep(job, "hop2") });
  const r2 = h2.results[0];
  if (r2?.ok) return { ok: true, relay: relayAddr, hop1: r1.signature ?? null, hop2: r2.signature ?? null, error: null };
  // hop 2 failed: bring whatever the relay holds back to the source (relay key is dropped afterwards)
  const back = await sweepSol({ conn, sendConn: sendConn(), wallets: [relayAddr], to: fromKp.publicKey, keypairOf: () => relay, onStep: onStep(job, "recover") }).catch(() => null);
  const recovered = !!back?.results[0]?.ok;
  return { ok: false, relay: relayAddr, hop1: r1.signature ?? null, hop2: r2?.signature ?? null, error: `hop 2/2 failed: ${r2?.error ?? "not confirmed"} — ${recovered ? "funds returned to the source" : "funds still in the relay " + relayAddr}` };
}

/** one transfer from a vault wallet to any address (withdraw) or to another vault wallet (transfer) */
export function sendSol(kind: "withdraw" | "transfer", from: string, to: string, lamports: bigint, viaRelay = false): Job {
  requireUnlocked();
  const st = store();
  const [src] = vaultWallets([from]);
  if (kind === "transfer") vaultWallets([to]);
  if (from === to) throw new HttpError(400, "Source and destination are the same wallet.");
  const job = jobNew(kind, viaRelay ? 2 : 1, `${kind === "withdraw" ? "Withdraw" : "Transfer"} ${solString(lamports)} SOL → ${to.slice(0, 6)}…${viaRelay ? " via relay" : ""}`);
  jobRun(job, async (j) => {
    const conn = readConn();
    const bal = await getSolBalance(conn, from).catch(() => null);
    if (bal === null) throw new Error("RPC unreachable: balance could not be read. Nothing was sent.");
    const need = lamports + TX_FEE_MARGIN + (viaRelay ? RELAY_FEE : BigInt(0));
    if (bal < need) throw new Error(`${src.label} holds ${solString(bal)} SOL but needs ${solString(need)} SOL (amount + fee${viaRelay ? " + relay fee" : ""}). Nothing was sent.`);
    const cuPrice = st.sol.config.priorityMicroLamports;
    let ok: boolean;
    let signature: string | null;
    let error: string | null;
    let extra: Record<string, unknown> = {};
    if (viaRelay) {
      const r = await relayHop(j, st.sol.keypair(from), to, lamports, cuPrice);
      ok = r.ok;
      signature = r.hop2 ?? r.hop1;
      error = r.error;
      extra = { relay: r.relay, hop1: r.hop1, hop2: r.hop2 };
    } else {
      const r = await distributeSol({ conn, sendConn: sendConn(), fromKeypair: st.sol.keypair(from), plan: [{ address: new PublicKey(to), lamports }], cuPrice, onStep: onStep(j) });
      const res = r.results[0];
      ok = !!res?.ok;
      signature = res?.signature ?? null;
      error = ok ? null : (res?.error ?? "not confirmed");
    }
    j.extra = { from, to, sol: solString(lamports), signature, viaRelay, ...extra };
    logActivity(st, {
      kind,
      ok,
      message: `${kind === "withdraw" ? "Withdraw" : "Transfer"} ${solString(lamports)} SOL ${src.label} → ${to.slice(0, 6)}…${viaRelay ? " via relay" : ""} ${ok ? "confirmed" : "failed: " + error}`,
      wallets: [from, to],
      signature: signature ?? undefined,
      jobId: j.id,
      data: extra,
    });
    if (!ok) throw new Error(error ?? "not confirmed");
  });
  return job;
}

/** one source → many vault wallets, random amount in [min,max] each, random delay in [minDelay,maxDelay] ms */
export function disperse(from: string, to: string[], minLam: bigint, maxLam: bigint, minDelay: number, maxDelay: number, viaRelay = false): Job {
  requireUnlocked();
  const st = store();
  const [src] = vaultWallets([from]);
  const targets = vaultWallets(to).filter((w) => w.address !== from);
  if (targets.length === 0) throw new HttpError(400, "No destination wallet (the source cannot be a destination).");
  if (maxLam < minLam) throw new HttpError(400, "maxSol must be ≥ minSol.");
  const span = Number(maxLam - minLam);
  const plan = targets.map((w) => ({ address: w.address, lamports: minLam + BigInt(Math.round(Math.random() * span)) }));
  const perSend = TX_FEE_MARGIN + (viaRelay ? RELAY_FEE : BigInt(0));
  const need = plan.reduce((s, p) => s + p.lamports, BigInt(0)) + BigInt(plan.length) * perSend;
  const job = jobNew("disperse", viaRelay ? plan.length * 2 : plan.length, `Disperse ${src.label} → ${plan.length} wallet(s)${viaRelay ? " via relays" : ""}`);
  jobRun(job, async (j) => {
    const conn = readConn();
    const bal = await getSolBalance(conn, from).catch(() => null);
    if (bal === null) throw new Error("RPC unreachable: balance could not be read. Nothing was sent.");
    if (bal < need) throw new Error(`${src.label} holds ${solString(bal)} SOL but needs ~${solString(need)} SOL (sends + fees). Nothing was sent.`);
    const cuPrice = st.sol.config.priorityMicroLamports;
    let sent = 0;
    const relays: HopResult[] = [];
    if (viaRelay) {
      const fromKp = st.sol.keypair(from);
      for (let i = 0; i < plan.length; i++) {
        if (i > 0 && maxDelay > 0) {
          const gap = Math.round(minDelay + Math.random() * Math.max(0, maxDelay - minDelay));
          jobWait(j, gap);
          await sleep(gap);
        }
        const r = await relayHop(j, fromKp, plan[i].address, plan[i].lamports, cuPrice);
        relays.push(r);
        if (r.ok) sent++;
        else jobNote(j, `${plan[i].address.slice(0, 6)}…: ${r.error}`, { ok: false, address: plan[i].address });
      }
    } else {
      const r = await distributeSol({ conn, sendConn: sendConn(), fromKeypair: st.sol.keypair(from), plan, delayMinMs: minDelay, delayMaxMs: maxDelay, cuPrice, onStep: onStep(j) });
      sent = r.sent;
    }
    j.extra = { sent, total: plan.length, plannedSol: solString(need), viaRelay, relays: viaRelay ? relays : undefined };
    logActivity(st, { kind: "disperse", ok: sent > 0, message: `Disperse from ${src.label}${viaRelay ? " via relays" : ""}: ${sent}/${plan.length} wallet(s) funded.`, wallets: [from, ...targets.map((t) => t.address)], jobId: j.id });
    if (sent === 0) throw new Error("No wallet funded.");
  });
  return job;
}

/** many vault wallets → one destination (any address), each sends its whole balance minus fee */
export function consolidate(from: string[], to: string, viaRelay = false): Job {
  requireUnlocked();
  const st = store();
  const sources = vaultWallets(from).filter((w) => w.address !== to);
  if (sources.length === 0) throw new HttpError(400, "No source wallet (the destination cannot be a source).");
  const job = jobNew("consolidate", viaRelay ? sources.length * 2 : sources.length, `Consolidate ${sources.length} wallet(s) → ${to.slice(0, 6)}…${viaRelay ? " via relays" : ""}`);
  jobRun(job, async (j) => {
    if (viaRelay) {
      // each source empties itself through its own fresh relay: source → relay → destination
      const conn = readConn();
      const cuPrice = st.sol.config.priorityMicroLamports;
      let sent = 0;
      const relays: string[] = [];
      const errors: string[] = [];
      for (const w of sources) {
        const bal = await getSolBalance(conn, w.address).catch(() => null);
        if (bal === null) { errors.push(`${w.label}: RPC unreachable`); jobPush(j, false, { phase: "hop1", address: w.address, error: "RPC unreachable: balance could not be read" }); jobPush(j, false, { phase: "hop2", address: w.address, error: "skipped" }); continue; }
        const lamports = bal - TX_FEE_MARGIN - RELAY_FEE;
        if (lamports <= BigInt(0)) { errors.push("empty"); jobPush(j, false, { phase: "hop1", address: w.address, error: "empty" }); jobPush(j, false, { phase: "hop2", address: w.address, error: "skipped" }); continue; }
        const r = await relayHop(j, st.sol.keypair(w.address), to, lamports, cuPrice);
        relays.push(r.relay);
        if (r.ok) sent += 1; else errors.push(`${w.label}: ${r.error}`);
      }
      j.extra = { sent, total: sources.length, viaRelay: true, relays };
      logActivity(st, { kind: "consolidate", ok: sent > 0, message: `Consolidate via relays → ${to.slice(0, 6)}…: ${sent}/${sources.length} wallet(s) swept.`, wallets: [...sources.map((s) => s.address), to], jobId: j.id });
      if (sent === 0) throw new Error(errors.every((e) => e === "empty") ? "Every source wallet is empty. Nothing was sent." : errors[0]);
      return;
    }
    const r = await sweepSol({
      conn: readConn(),
      sendConn: sendConn(),
      wallets: sources.map((w) => w.address),
      to,
      keypairOf: (a) => st.sol.keypair(a),
      onStep: onStep(j),
    });
    j.extra = { sent: r.sent, total: r.total };
    logActivity(st, { kind: "consolidate", ok: r.sent > 0, message: `Consolidate → ${to.slice(0, 6)}…: ${r.sent}/${r.total} wallet(s) swept.`, wallets: [...sources.map((s) => s.address), to], jobId: j.id });
    if (r.sent === 0) throw new Error(r.results[0]?.error === "empty" ? "Every source wallet is empty. Nothing was sent." : (r.results[0]?.error ?? "nothing swept"));
  });
  return job;
}
