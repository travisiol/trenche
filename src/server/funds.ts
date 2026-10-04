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
import { logActivity, saveWalletMeta, store, type Job } from "./store";
import { generateWallets } from "./wallets";

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
/** `title` names the job in Activity ("Consolidate" from the transfer view, "Reverse Disperse" from the privacy drawer) */
export function consolidate(from: string[], to: string, viaRelay = false, delayMs = 0, title = "Consolidate"): Job {
  requireUnlocked();
  const st = store();
  const sources = vaultWallets(from).filter((w) => w.address !== to);
  if (sources.length === 0) throw new HttpError(400, "No source wallet (the destination cannot be a source).");
  const job = jobNew("consolidate", viaRelay ? sources.length * 2 : sources.length, `${title} ${sources.length} wallet(s) → ${to.slice(0, 6)}…${viaRelay ? " via relays" : ""}${delayMs ? ` · ${Math.round(delayMs / 60000)} min between wallets` : ""}`);
  job.extra = { to, sources: sources.map((s) => s.address), viaRelay, delayMinutes: delayMs / 60000 };
  jobRun(job, async (j) => {
    if (delayMs > 0 && !viaRelay) {
      // Reverse Disperse with a delay: one sweep at a time, cooperative stop between wallets
      let sent = 0;
      let firstErr: string | null = null;
      for (let i = 0; i < sources.length; i++) {
        if (i > 0 && !(await pause(j, delayMs))) break;
        const r = await sweepSol({ conn: readConn(), sendConn: sendConn(), wallets: [sources[i].address], to, keypairOf: (a) => st.sol.keypair(a), onStep: onStep(j) });
        if (r.sent) sent++;
        else firstErr ??= r.results[0]?.error ?? "nothing swept";
      }
      j.extra = { ...(j.extra ?? {}), sent, total: sources.length };
      logActivity(st, { kind: "consolidate", ok: sent > 0, message: `Reverse disperse → ${to.slice(0, 6)}…: ${sent}/${sources.length} wallet(s) swept.`, wallets: [...sources.map((s) => s.address), to], jobId: j.id });
      if (sent === 0) throw new Error(firstErr === "empty" ? "Every source wallet is empty. Nothing was sent." : (firstErr ?? "nothing swept"));
      return;
    }
    if (viaRelay) {
      // each source empties itself through its own fresh relay: source → relay → destination
      const conn = readConn();
      const cuPrice = st.sol.config.priorityMicroLamports;
      let sent = 0;
      const relays: string[] = [];
      const errors: string[] = [];
      for (let i = 0; i < sources.length; i++) {
        const w = sources[i];
        // the delay between wallets applies here too (cooperative stop between wallets)
        if (i > 0 && delayMs > 0 && !(await pause(j, delayMs))) {
          jobNote(j, `Stopped before wallet ${i + 1}/${sources.length}; ${sent} already swept.`);
          break;
        }
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

/* ------------------------------------------------------------------ Block X Portfolio flows */

export type PlanRow = { address: string; label: string; lamports: bigint };

/** split `total` across `targets`: equal, or randomised ±variationPct around the equal share (sum unchanged) */
export function splitAmounts(targets: string[], total: bigint, variationPct: number): bigint[] {
  const n = targets.length;
  if (n === 0) return [];
  const v = Math.max(0, Math.min(100, variationPct)) / 100;
  const w = Array.from({ length: n }, () => (v > 0 ? Math.max(0.02, 1 + v * (Math.random() * 2 - 1)) : 1));
  const sum = w.reduce((s, x) => s + x, 0);
  const out: bigint[] = [];
  let left = total;
  for (let i = 0; i < n - 1; i++) {
    const a = BigInt(Math.floor(Number(total) * (w[i] / sum)));
    out.push(a);
    left -= a;
  }
  out.push(left);
  return out;
}

/** wait (cooperatively, `job.stop`) between wallets; minutes-scale delays are fine (no engine cap) */
async function pause(job: Job, ms: number): Promise<boolean> {
  if (ms <= 0) return !job.stop;
  jobWait(job, ms);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (job.stop) return false;
    await sleep(Math.min(500, until - Date.now()));
  }
  job.nextAt = 0;
  return !job.stop;
}

/** send a plan from one keypair, one transfer at a time (direct or through a fresh relay), `delayMs` between wallets */
async function sendPlan(job: Job, fromKp: Keypair, plan: PlanRow[], delayMs: number, viaRelay: boolean): Promise<{ sent: number; relays: HopResult[] }> {
  const st = store();
  const conn = readConn();
  const cuPrice = st.sol.config.priorityMicroLamports;
  let sent = 0;
  const relays: HopResult[] = [];
  for (let i = 0; i < plan.length; i++) {
    if (i > 0 && !(await pause(job, delayMs))) {
      jobNote(job, `Stopped before wallet ${i + 1}/${plan.length}; ${sent} already sent.`);
      break;
    }
    if (job.stop) break;
    const p = plan[i];
    if (viaRelay) {
      const r = await relayHop(job, fromKp, p.address, p.lamports, cuPrice);
      relays.push(r);
      if (r.ok) sent++;
      else jobNote(job, `${p.label}: ${r.error}`, { ok: false, address: p.address });
    } else {
      const r = await distributeSol({ conn, sendConn: sendConn(), fromKeypair: fromKp, plan: [{ address: new PublicKey(p.address), lamports: p.lamports }], cuPrice, onStep: onStep(job) });
      if (r.results[0]?.ok) sent++;
    }
  }
  return { sent, relays };
}

const labelOf = (a: string): string => store().walletMeta.meta[a]?.label || store().sol.wallets.find((w) => w.address === a)?.label || a.slice(0, 6);

export type DisperseOpts = {
  from?: string;
  createDeposit?: boolean;
  to: string[];
  totalLam?: bigint;
  amountLam?: bigint;
  amounts?: Record<string, bigint>;
  variationPct: number;
  delayMs: number;
  /** how long the job waits for the source to hold the total (deposit wallets) */
  waitMs: number;
  viaRelay: boolean;
  presetName?: string;
  kind?: "disperse" | "distribute";
};
export type DisperseStarted = { job: Job; from: { address: string; label: string; isDeposit: boolean }; plan: PlanRow[]; needLam: bigint; totalLam: bigint };

/** Block X Disperse: an existing wallet or a fresh "Deposit N" wallet funds `to`; the job waits until the source holds
 *  the total + fees (up to waitMs), then sends wallet after wallet with `delayMs` between them. */
export function disperseV2(o: DisperseOpts): DisperseStarted {
  requireUnlocked();
  const st = store();
  let from: string;
  let isDeposit = false;
  if (o.createDeposit) {
    const n = Object.values(st.walletMeta.meta).filter((m) => /^Deposit \d+$/.test(m.label ?? "")).length + 1;
    [from] = generateWallets(1, "Deposit");
    st.walletMeta.meta[from].label = `Deposit ${n}`;
    saveWalletMeta(st);
    isDeposit = true;
  } else {
    if (!o.from) throw new HttpError(400, "from: a source wallet is required (or createDeposit: true).");
    [{ address: from }] = vaultWallets([o.from]);
  }
  const targets = vaultWallets([...new Set(o.to)]).filter((w) => w.address !== from);
  if (targets.length === 0) throw new HttpError(400, "Destinations (0/0): pick at least one wallet (the source cannot be a destination).");
  let lamports: bigint[];
  if (o.amounts) {
    lamports = targets.map((t) => {
      const v = o.amounts![t.address];
      if (v === undefined || v <= BigInt(0)) throw new HttpError(400, `amounts: ${t.label} has no amount > 0.`);
      return v;
    });
  } else if (o.amountLam !== undefined) lamports = targets.map(() => o.amountLam!);
  else if (o.totalLam !== undefined) {
    if (o.totalLam < BigInt(targets.length)) throw new HttpError(400, "Total to split is too small for that many wallets.");
    lamports = splitAmounts(targets.map((t) => t.address), o.totalLam, o.variationPct);
  } else throw new HttpError(400, "Amount missing: totalSol (split across the wallets), amountSol (per wallet) or amounts (per address).");
  const plan: PlanRow[] = targets.map((t, i) => ({ address: t.address, label: t.label, lamports: lamports[i] }));
  const totalLam = plan.reduce((s, p) => s + p.lamports, BigInt(0));
  const perSend = TX_FEE_MARGIN + (o.viaRelay ? RELAY_FEE : BigInt(0));
  const needLam = totalLam + BigInt(plan.length) * perSend;
  const kind = o.kind ?? "disperse";
  const srcLabel = labelOf(from);
  const job = jobNew(kind, o.viaRelay ? plan.length * 2 : plan.length, `${kind === "distribute" ? "Distribute" : "Disperse"} ${srcLabel} → ${plan.length} wallet(s) · ${solString(totalLam)} SOL${o.viaRelay ? " via relays" : ""}${o.delayMs ? ` · ${Math.round(o.delayMs / 60000)} min between wallets` : ""}`);
  job.extra = { from, isDeposit, plan: plan.map((p) => ({ address: p.address, label: p.label, sol: solString(p.lamports) })), totalSol: solString(totalLam), needSol: solString(needLam), variationPct: o.variationPct, delayMinutes: o.delayMs / 60000, viaRelay: o.viaRelay, presetName: o.presetName ?? null, phase: "waiting" };
  jobRun(job, async (j) => {
    const conn = readConn();
    // wait for funds (a deposit wallet starts empty: the user funds it from the QR)
    const deadline = Date.now() + o.waitMs;
    let bal: bigint | null = null;
    let noted = false;
    for (;;) {
      bal = await getSolBalance(conn, from).catch(() => null);
      if (bal !== null && bal >= needLam) break;
      if (j.stop) throw new Error(`Stopped while waiting for funds (${srcLabel} holds ${bal === null ? "?" : solString(bal)} of ${solString(needLam)} SOL). Nothing was sent.`);
      if (!isDeposit && !o.waitMs) throw new Error(`${srcLabel} holds ${bal === null ? "? (RPC unreachable)" : solString(bal)} SOL but needs ~${solString(needLam)} SOL (sends + fees). Nothing was sent.`);
      if (Date.now() > deadline) throw new Error(`${srcLabel} never held the ${solString(needLam)} SOL needed (has ${bal === null ? "?" : solString(bal)}) within ${Math.round(o.waitMs / 60000)} min. Nothing was sent — fund it and start again.`);
      if (!noted) {
        jobNote(j, `Waiting for ${solString(needLam)} SOL on ${srcLabel} ${from} (has ${bal === null ? "?" : solString(bal)} SOL) — fund it, the disperse starts on its own. Up to ${Math.round(o.waitMs / 60000)} min.`, { address: from });
        noted = true;
      }
      j.extra = { ...(j.extra ?? {}), phase: "waiting", balanceSol: bal === null ? null : solString(bal) };
      jobWait(j, 5000);
      await sleep(5000);
    }
    j.extra = { ...(j.extra ?? {}), phase: "sending", balanceSol: solString(bal!) };
    jobNote(j, `${srcLabel} holds ${solString(bal!)} SOL — sending to ${plan.length} wallet(s).`);
    const r = await sendPlan(j, st.sol.keypair(from), plan, o.delayMs, o.viaRelay);
    j.extra = { ...(j.extra ?? {}), phase: "done", sent: r.sent, total: plan.length, relays: o.viaRelay ? r.relays : undefined };
    logActivity(st, { kind, ok: r.sent > 0, message: `${kind === "distribute" ? "Distribute" : "Disperse"} from ${srcLabel}${o.viaRelay ? " via relays" : ""}: ${r.sent}/${plan.length} wallet(s) funded.`, wallets: [from, ...plan.map((p) => p.address)], jobId: j.id });
    if (r.sent === 0) throw new Error(j.stop ? "Stopped before any wallet was funded." : "No wallet funded.");
  });
  return { job, from: { address: from, label: srcLabel, isDeposit }, plan, needLam, totalLam };
}

/** Block X Distribute drop zone: ONE source → targets, total = the source's whole balance minus fees when not given */
export async function distribute(o: { source: string; targets: string[]; totalLam?: bigint; variationPct: number; delayMs: number; viaRelay: boolean }): Promise<DisperseStarted> {
  requireUnlocked();
  const [src] = vaultWallets([o.source]);
  const targets = [...new Set(o.targets)].filter((t) => t !== src.address);
  if (targets.length === 0) throw new HttpError(400, "Target Wallet: drag at least one wallet (not the source).");
  let totalLam = o.totalLam;
  if (totalLam === undefined) {
    const bal = await getSolBalance(readConn(), src.address).catch(() => null);
    if (bal === null) throw new HttpError(503, "RPC unreachable: the source balance could not be read. Nothing was sent.");
    const perSend = TX_FEE_MARGIN + (o.viaRelay ? RELAY_FEE : BigInt(0));
    totalLam = bal - BigInt(targets.length) * perSend;
    if (totalLam <= BigInt(0)) throw new HttpError(402, `${src.label} holds ${solString(bal)} SOL: nothing left to distribute after fees for ${targets.length} wallet(s). Nothing was sent.`);
  }
  return disperseV2({ from: src.address, to: targets, totalLam, variationPct: o.variationPct, delayMs: o.delayMs, waitMs: 0, viaRelay: o.viaRelay, kind: "distribute" });
}

/** Block X Transfer drop zone: sources[i] → targets[i % targets.length]; `lamports` each, or the whole balance minus fees */
export function transferPairs(sources: string[], targets: string[], lamports: bigint | null, viaRelay: boolean, delayMs: number): Job {
  requireUnlocked();
  const st = store();
  const src = vaultWallets([...new Set(sources)]);
  const tg = vaultWallets([...new Set(targets)]);
  if (src.length === 0 || tg.length === 0) throw new HttpError(400, "Transfer needs at least one source and one target wallet.");
  const pairs = src.map((s, i) => ({ from: s, to: tg[i % tg.length] })).filter((p) => p.from.address !== p.to.address);
  if (pairs.length === 0) throw new HttpError(400, "Every source is also its target: nothing to transfer.");
  const job = jobNew("transfer", viaRelay ? pairs.length * 2 : pairs.length, `Transfer ${pairs.length} wallet(s) → ${tg.length} target(s)${lamports ? ` · ${solString(lamports)} SOL each` : " · whole balance"}${viaRelay ? " via relays" : ""}`);
  job.extra = { pairs: pairs.map((p) => ({ from: p.from.address, to: p.to.address })), sol: lamports ? solString(lamports) : null, viaRelay };
  jobRun(job, async (j) => {
    const conn = readConn();
    let sent = 0;
    const errors: string[] = [];
    for (let i = 0; i < pairs.length; i++) {
      if (i > 0 && !(await pause(j, delayMs))) break;
      const p = pairs[i];
      const bal = await getSolBalance(conn, p.from.address).catch(() => null);
      if (bal === null) {
        errors.push(`${p.from.label}: RPC unreachable`);
        jobPush(j, false, { address: p.from.address, error: "RPC unreachable: balance could not be read" });
        continue;
      }
      const perSend = TX_FEE_MARGIN + (viaRelay ? RELAY_FEE : BigInt(0));
      const amount = lamports ?? bal - perSend;
      if (amount <= BigInt(0) || bal < amount + perSend) {
        const msg = `${p.from.label} holds ${solString(bal)} SOL but needs ${solString((lamports ?? BigInt(0)) + perSend)} SOL (amount + fee). Skipped.`;
        errors.push(msg);
        jobPush(j, false, { address: p.from.address, error: msg });
        continue;
      }
      const r = await sendPlan(j, st.sol.keypair(p.from.address), [{ address: p.to.address, label: p.to.label, lamports: amount }], 0, viaRelay);
      if (r.sent) sent++;
    }
    j.extra = { ...(j.extra ?? {}), sent, total: pairs.length };
    logActivity(st, { kind: "transfer", ok: sent > 0, message: `Transfer: ${sent}/${pairs.length} wallet(s) sent.`, wallets: pairs.flatMap((p) => [p.from.address, p.to.address]), jobId: j.id });
    if (sent === 0) throw new Error(errors[0] ?? "Nothing was sent.");
  });
  return job;
}
