/* Fund movements: withdraw / transfer (one SOL transfer), disperse (distributeSol), consolidate (sweepSol).
 * Every operation is a job; nothing is sent without an explicit API call from the UI. */
import { PublicKey } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { distributeSol, sweepSol, type FundStep } from "@/engine/solana/fund.js";
import { HttpError, solString } from "./api";
import { readConn, requireUnlocked, sendConn, vaultWallets } from "./engine";
import { jobNew, jobPush, jobRun, jobWait } from "./jobs";
import { logActivity, store, type Job } from "./store";

const TX_FEE_MARGIN = BigInt(12_000);

function onStep(job: Job) {
  return (s: FundStep) => {
    if (s.phase === "wait") jobWait(job, s.delayMs ?? 0);
    else jobPush(job, s.phase === "sent", { phase: s.phase, address: s.address, sol: s.sol, signature: s.signature ?? null, error: s.error });
  };
}

/** one transfer from a vault wallet to any address (withdraw) or to another vault wallet (transfer) */
export function sendSol(kind: "withdraw" | "transfer", from: string, to: string, lamports: bigint): Job {
  requireUnlocked();
  const st = store();
  const [src] = vaultWallets([from]);
  if (kind === "transfer") vaultWallets([to]);
  if (from === to) throw new HttpError(400, "Source and destination are the same wallet.");
  const job = jobNew(kind, 1, `${kind === "withdraw" ? "Withdraw" : "Transfer"} ${solString(lamports)} SOL → ${to.slice(0, 6)}…`);
  jobRun(job, async (j) => {
    const conn = readConn();
    const bal = await getSolBalance(conn, from).catch(() => null);
    if (bal === null) throw new Error("RPC unreachable: balance could not be read. Nothing was sent.");
    if (bal < lamports + TX_FEE_MARGIN)
      throw new Error(`${src.label} holds ${solString(bal)} SOL but needs ${solString(lamports + TX_FEE_MARGIN)} SOL (amount + fee). Nothing was sent.`);
    const r = await distributeSol({
      conn,
      sendConn: sendConn(),
      fromKeypair: st.sol.keypair(from),
      plan: [{ address: new PublicKey(to), lamports }],
      cuPrice: st.sol.config.priorityMicroLamports,
      onStep: onStep(j),
    });
    const res = r.results[0];
    j.extra = { from, to, sol: solString(lamports), signature: res?.signature ?? null };
    logActivity(st, {
      kind,
      ok: !!res?.ok,
      message: `${kind === "withdraw" ? "Withdraw" : "Transfer"} ${solString(lamports)} SOL ${src.label} → ${to.slice(0, 6)}… ${res?.ok ? "confirmed" : "failed: " + (res?.error ?? "?")}`,
      wallets: [from, to],
      signature: res?.signature,
      jobId: j.id,
    });
    if (!res?.ok) throw new Error(res?.error ?? "not confirmed");
  });
  return job;
}

/** one source → many vault wallets, random amount in [min,max] each, random delay in [minDelay,maxDelay] ms */
export function disperse(from: string, to: string[], minLam: bigint, maxLam: bigint, minDelay: number, maxDelay: number): Job {
  requireUnlocked();
  const st = store();
  const [src] = vaultWallets([from]);
  const targets = vaultWallets(to).filter((w) => w.address !== from);
  if (targets.length === 0) throw new HttpError(400, "No destination wallet (the source cannot be a destination).");
  if (maxLam < minLam) throw new HttpError(400, "maxSol must be ≥ minSol.");
  const span = Number(maxLam - minLam);
  const plan = targets.map((w) => ({ address: w.address, lamports: minLam + BigInt(Math.round(Math.random() * span)) }));
  const need = plan.reduce((s, p) => s + p.lamports, BigInt(0)) + BigInt(plan.length) * TX_FEE_MARGIN;
  const job = jobNew("disperse", plan.length, `Disperse ${src.label} → ${plan.length} wallet(s)`);
  jobRun(job, async (j) => {
    const conn = readConn();
    const bal = await getSolBalance(conn, from).catch(() => null);
    if (bal === null) throw new Error("RPC unreachable: balance could not be read. Nothing was sent.");
    if (bal < need) throw new Error(`${src.label} holds ${solString(bal)} SOL but needs ~${solString(need)} SOL (sends + fees). Nothing was sent.`);
    const r = await distributeSol({
      conn,
      sendConn: sendConn(),
      fromKeypair: st.sol.keypair(from),
      plan,
      delayMinMs: minDelay,
      delayMaxMs: maxDelay,
      cuPrice: st.sol.config.priorityMicroLamports,
      onStep: onStep(j),
    });
    j.extra = { sent: r.sent, total: r.total, plannedSol: solString(need) };
    logActivity(st, { kind: "disperse", ok: r.sent > 0, message: `Disperse from ${src.label}: ${r.sent}/${r.total} wallet(s) funded.`, wallets: [from, ...targets.map((t) => t.address)], jobId: j.id });
  });
  return job;
}

/** many vault wallets → one destination (any address), each sends its whole balance minus fee */
export function consolidate(from: string[], to: string): Job {
  requireUnlocked();
  const st = store();
  const sources = vaultWallets(from).filter((w) => w.address !== to);
  if (sources.length === 0) throw new HttpError(400, "No source wallet (the destination cannot be a source).");
  const job = jobNew("consolidate", sources.length, `Consolidate ${sources.length} wallet(s) → ${to.slice(0, 6)}…`);
  jobRun(job, async (j) => {
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
