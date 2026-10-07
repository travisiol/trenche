/* Fund movements: withdraw / transfer (one SOL transfer), disperse (distributeSol), consolidate (sweepSol),
 * and the "relay hop" option: source → fresh in-memory relay wallet → destination (the relay key is generated
 * for the hop and dropped; on a hop-2 failure the relay sweeps back to the source).
 * Every operation is a job; nothing is sent without an explicit API call from the UI. */
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { distributeSol, sweepSol, type FundStep } from "@/engine/solana/fund.js";
import { latestBlockhash, sendAndConfirm } from "@/engine/solana/send.js";
import { HttpError, sleep, solString } from "./api";
import { readConn, requireUnlocked, sendConn, vaultWallets } from "./engine";
import { jobNew, jobNote, jobPush, jobRun, jobWait } from "./jobs";
import { logActivity, saveWalletMeta, store, type Job } from "./store";
import { generateWallets } from "./wallets";
import { MAX_DELAY_SEC, MAX_PARTS, RELAY_FEE_LAM, RENT_MIN_LAM, TX_FEE_MARGIN_LAM, fmtDuration, fmtRange, randomDelays, shuffled, splitLamports, type DelayRange } from "@/lib/privacy";

const TX_FEE_MARGIN = BigInt(TX_FEE_MARGIN_LAM);
/** base fee of the relay's own transfer (hop 2 is sent without priority fee, like the engine's two-hop) */
const RELAY_FEE = BigInt(RELAY_FEE_LAM);
/** exact fee of a one-signature transfer sent without compute-unit price (used when a wallet must end at 0) */
const BASE_FEE = BigInt(5_000);
/** rent-exempt minimum of a system account: a fresh relay / destination must receive at least this, and a source
 *  may not be left with a balance between 0 and this (the runtime refuses rent-exempt → rent-paying) */
const RENT_MIN = BigInt(RENT_MIN_LAM);

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

/* ------------------------------------------------------------------ privacy options (random delay range, order) */

export const NO_DELAY: DelayRange = { minMs: 0, maxMs: 0 };

function secIn(v: unknown, what: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${what}: a number of seconds ≥ 0 is required.`);
  if (n > MAX_DELAY_SEC) throw new HttpError(400, `${what}: 24 h max (${MAX_DELAY_SEC} s).`);
  return n;
}

/** request → delay range. `delayMinSec`/`delayMaxSec` = each payment waits a random draw in that range;
 *  the legacy `delayMinutes` = the same fixed delay between payments. 400 beyond 24 h or when min > max. */
export function delayRangeOf(b: { delayMinSec?: unknown; delayMaxSec?: unknown; delayMinutes?: unknown }): DelayRange {
  const lo = secIn(b.delayMinSec, "delayMinSec");
  const hi = secIn(b.delayMaxSec, "delayMaxSec");
  if (lo !== null || hi !== null) {
    const min = lo ?? hi!;
    const max = hi ?? lo!;
    if (min > max) throw new HttpError(400, `delayMinSec (${min}) must be ≤ delayMaxSec (${max}).`);
    return { minMs: Math.round(min * 1000), maxMs: Math.round(max * 1000) };
  }
  const m = secIn(b.delayMinutes === undefined || b.delayMinutes === null || b.delayMinutes === "" ? undefined : Number(b.delayMinutes) * 60, "delayMinutes");
  return m ? { minMs: Math.round(m * 1000), maxMs: Math.round(m * 1000) } : NO_DELAY;
}

/** transfer split: 1..5 parts (400 otherwise) */
export function partsOf(v: unknown): number {
  if (v === undefined || v === null || v === "") return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) throw new HttpError(400, `parts: an integer from 1 to ${MAX_PARTS} is required.`);
  return n;
}

export const shuffleOf = (v: unknown): boolean => v === true || v === "true" || v === 1;

const rangeLabel = (r: DelayRange) => (r.maxMs > 0 ? ` · delays ${fmtRange(r)}` : "");
const rangeExtra = (r: DelayRange) => ({ delayMinSec: r.minMs / 1000, delayMaxSec: r.maxMs / 1000, delayMinutes: r.minMs === r.maxMs ? r.maxMs / 60000 : null });
/** rough wall time: the drawn delays + ~2 s per signature */
const etaOf = (delays: number[], viaRelay: boolean) => delays.reduce((s, d) => s + d, 0) + delays.length * (viaRelay ? 4000 : 2000);

/** wait the payment's drawn delay (cooperative stop); the step says how long and from which range */
async function waitTurn(job: Job, ms: number, i: number, n: number, range: DelayRange): Promise<boolean> {
  if (i === 0 || ms <= 0) return !job.stop;
  jobNote(job, `Waiting ${fmtDuration(ms)} before payment ${i + 1}/${n}${range.maxMs > range.minMs ? ` (random in ${fmtRange(range)})` : ""}`, { phase: "wait" });
  const ok = await pause(job, ms);
  if (!ok) jobNote(job, `Stopped before payment ${i + 1}/${n}.`, { phase: "wait" });
  return ok;
}

/** wait (cooperatively, `job.stop`) between payments; delays up to 24 h (no engine cap) */
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

/* ------------------------------------------------------------------ plans */

export type PlanRow = { address: string; label: string; lamports: bigint; /** wait before this payment (0 for the first) */ delayMs: number };
type RowResult = { ok: boolean; waitedMs: number; relay: string | null; hop1: string | null; hop2: string | null; signature: string | null; error: string | null };

/** job.extra.plan: the drawn plan in execution order, each row completed as it runs */
function planView(plan: PlanRow[], res: (RowResult | undefined)[]) {
  return plan.map((p, i) => ({ address: p.address, label: p.label, sol: solString(p.lamports), delayMs: p.delayMs, status: res[i] ? (res[i]!.ok ? "sent" : "failed") : "pending", ...(res[i] ?? {}) }));
}

/** send a plan from one keypair, one payment at a time (direct or each through its own fresh relay), waiting each
 *  row's drawn delay first. `onRow` fires after every payment (job.extra refresh). */
async function sendPlan(job: Job, fromKp: Keypair, plan: PlanRow[], o: { viaRelay: boolean; range: DelayRange; cuPrice?: number; /** deposit wallet: the last payment sends what is really left (minus its fee) so the wallet ends at 0 */ drainLast?: boolean; onRow?: (res: (RowResult | undefined)[]) => void }): Promise<{ sent: number; results: (RowResult | undefined)[] }> {
  const st = store();
  const conn = readConn();
  const cuPrice = o.cuPrice ?? st.sol.config.priorityMicroLamports;
  let sent = 0;
  const results: (RowResult | undefined)[] = plan.map(() => undefined);
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (!(await waitTurn(job, p.delayMs, i, plan.length, o.range))) break;
    // a deposit wallet must end at exactly 0: a few lamports off the planned fees (6 000 on 2026-10-07) left it between
    // 0 and the rent minimum and the runtime refused the last payment (InsufficientFundsForRent) — re-read and drain
    if (o.drainLast && i === plan.length - 1) {
      const bal = await getSolBalance(conn, fromKp.publicKey.toBase58()).catch(() => null);
      if (bal !== null) {
        const target = bal - BASE_FEE - (o.viaRelay ? RELAY_FEE : BigInt(0));
        const diff = target > p.lamports ? target - p.lamports : p.lamports - target;
        if (target > BigInt(0) && target !== p.lamports && diff <= BigInt(1_000_000)) {
          jobNote(job, `Last payment set to what the deposit really holds: ${solString(target)} SOL (planned ${solString(p.lamports)}) so it ends at 0.`, { address: p.address });
          p.lamports = target;
        }
      }
    }
    if (plan.length > 1) jobNote(job, `Payment ${i + 1}/${plan.length} · ${solString(p.lamports)} SOL → ${p.label}`, { phase: "pay", address: p.address });
    let res: RowResult;
    const waitedMs = i > 0 ? p.delayMs : 0;
    if (o.viaRelay) {
      const r = await relayHop(job, fromKp, p.address, p.lamports, cuPrice);
      res = { ok: r.ok, waitedMs, relay: r.relay, hop1: r.hop1, hop2: r.hop2, signature: r.hop2 ?? r.hop1, error: r.error };
      if (!r.ok) jobNote(job, `${p.label}: ${r.error}`, { ok: false, address: p.address });
    } else {
      const r = await distributeSol({ conn, sendConn: sendConn(), fromKeypair: fromKp, plan: [{ address: new PublicKey(p.address), lamports: p.lamports }], cuPrice, onStep: onStep(job) });
      const x = r.results[0];
      res = { ok: !!x?.ok, waitedMs, relay: null, hop1: null, hop2: null, signature: x?.signature ?? null, error: x?.ok ? null : (x?.error ?? "not confirmed") };
    }
    results[i] = res;
    if (res.ok) sent++;
    o.onRow?.(results);
  }
  return { sent, results };
}

const labelOf = (a: string): string => store().walletMeta.meta[a]?.label || store().sol.wallets.find((w) => w.address === a)?.label || a.slice(0, 6);
const isVault = (a: string) => store().sol.wallets.some((w) => w.address === a);

/** through a relay every payment must be at least the rent-exempt minimum (the relay — and a fresh destination — is
 *  a new account); refused before anything is sent */
function requireRelayMinimum(plan: { label: string; lamports: bigint }[]) {
  const low = plan.find((p) => p.lamports < RENT_MIN);
  if (low) throw new HttpError(400, `Through a relay each payment must be ≥ ${solString(RENT_MIN)} SOL (rent-exempt minimum of a fresh account); ${low.label} would get ${solString(low.lamports)} SOL. Raise the total, lower the variation or use fewer wallets/parts.`);
}

/** many vault wallets → one destination (any address), each sends its whole balance (ends at 0).
 *  `title` names the job ("Consolidate" from the transfer view, "Reverse Disperse" from the privacy drawer);
 *  `delay` = random wait before each wallet after the first; `shuffle` = random wallet order. */
export function consolidate(from: string[], to: string, viaRelay = false, delay: DelayRange = NO_DELAY, title = "Consolidate", shuffle = false): Job {
  requireUnlocked();
  const st = store();
  const picked = vaultWallets([...new Set(from)]).filter((w) => w.address !== to);
  if (picked.length === 0) throw new HttpError(400, "No source wallet (the destination cannot be a source).");
  const sources = shuffle ? shuffled(picked) : picked;
  const delays = randomDelays(sources.length, delay);
  const job = jobNew("consolidate", viaRelay ? sources.length * 2 : sources.length, `${title} ${sources.length} wallet(s) → ${to.slice(0, 6)}…${viaRelay ? " via relays" : ""}${rangeLabel(delay)}${shuffle ? " · random order" : ""}`);
  const order = sources.map((s, i) => ({ address: s.address, label: s.label, delayMs: delays[i], status: "pending" as string, sol: null as string | null, relay: null as string | null, hop1: null as string | null, hop2: null as string | null, signature: null as string | null, error: null as string | null }));
  job.extra = { to, sources: sources.map((s) => s.address), viaRelay, shuffle, ...rangeExtra(delay), plan: order, etaMs: etaOf(delays, viaRelay) };
  jobRun(job, async (j) => {
    if (delay.maxMs <= 0 && !viaRelay) {
      // ASAP, direct: one batched sweep
      const r = await sweepSol({ conn: readConn(), sendConn: sendConn(), wallets: sources.map((w) => w.address), to, keypairOf: (a) => st.sol.keypair(a), onStep: onStep(j) });
      j.extra = { ...(j.extra ?? {}), sent: r.sent, total: r.total };
      logActivity(st, { kind: "consolidate", ok: r.sent > 0, message: `${title} → ${to.slice(0, 6)}…: ${r.sent}/${r.total} wallet(s) swept.`, wallets: [...sources.map((s) => s.address), to], jobId: j.id });
      if (r.sent === 0) throw new Error(r.results[0]?.error === "empty" ? "Every source wallet is empty. Nothing was sent." : (r.results[0]?.error ?? "nothing swept"));
      return;
    }
    // one wallet at a time: random delay, then a sweep (direct, or source → its own fresh relay → destination)
    const conn = readConn();
    let sent = 0;
    const errors: string[] = [];
    for (let i = 0; i < sources.length; i++) {
      const w = sources[i];
      if (!(await waitTurn(j, delays[i], i, sources.length, delay))) break;
      jobNote(j, `Wallet ${i + 1}/${sources.length} · ${w.label} → ${to.slice(0, 6)}…`, { phase: "pay", address: w.address });
      const row = order[i];
      if (viaRelay) {
        const bal = await getSolBalance(conn, w.address).catch(() => null);
        // hop 1 is sent without compute-unit price so its fee is exactly BASE_FEE and the source ends at 0
        const lamports = bal === null ? BigInt(0) : bal - BASE_FEE - RELAY_FEE;
        if (bal === null || lamports < RENT_MIN) {
          const e = bal === null ? "RPC unreachable: balance could not be read" : bal === BigInt(0) ? "empty" : `${solString(bal)} SOL is too small for a relay hop (< ${solString(RENT_MIN + BASE_FEE + RELAY_FEE)} SOL)`;
          errors.push(e === "empty" ? "empty" : `${w.label}: ${e}`);
          jobPush(j, false, { phase: "hop1", address: w.address, error: e });
          jobPush(j, false, { phase: "hop2", address: w.address, error: "skipped" });
          Object.assign(row, { status: "skipped", error: e });
          continue;
        }
        const r = await relayHop(j, st.sol.keypair(w.address), to, lamports, 0);
        Object.assign(row, { status: r.ok ? "sent" : "failed", sol: solString(lamports), relay: r.relay, hop1: r.hop1, hop2: r.hop2, signature: r.hop2 ?? r.hop1, error: r.error, waitedMs: i > 0 ? delays[i] : 0 });
        if (r.ok) sent++;
        else errors.push(`${w.label}: ${r.error}`);
      } else {
        const r = await sweepSol({ conn, sendConn: sendConn(), wallets: [w.address], to, keypairOf: (a) => st.sol.keypair(a), onStep: onStep(j) });
        const x = r.results[0];
        Object.assign(row, { status: x?.ok ? "sent" : x?.error === "empty" ? "skipped" : "failed", sol: x?.sol ?? null, signature: x?.signature ?? null, error: x?.ok ? null : (x?.error ?? "nothing swept"), waitedMs: i > 0 ? delays[i] : 0 });
        if (r.sent) sent++;
        else errors.push(x?.error === "empty" ? "empty" : `${w.label}: ${x?.error ?? "nothing swept"}`);
      }
      j.extra = { ...(j.extra ?? {}), plan: order };
    }
    j.extra = { ...(j.extra ?? {}), plan: order, sent, total: sources.length };
    logActivity(st, { kind: "consolidate", ok: sent > 0, message: `${title}${viaRelay ? " via relays" : ""} → ${to.slice(0, 6)}…: ${sent}/${sources.length} wallet(s) swept.`, wallets: [...sources.map((s) => s.address), to], jobId: j.id });
    if (sent === 0) throw new Error(j.stop ? "Stopped before any wallet was swept." : errors.length && errors.every((e) => e === "empty") ? "Every source wallet is empty. Nothing was sent." : (errors.find((e) => e !== "empty") ?? "Nothing was sent."));
  });
  return job;
}

/* ------------------------------------------------------------------ Block X Portfolio flows */

export type DisperseOpts = {
  from?: string;
  createDeposit?: boolean;
  to: string[];
  totalLam?: bigint;
  amountLam?: bigint;
  amounts?: Record<string, bigint>;
  variationPct: number;
  delay: DelayRange;
  /** random destination order */
  shuffle: boolean;
  /** how long the job waits for the source to hold the total (deposit wallets) */
  waitMs: number;
  viaRelay: boolean;
  presetName?: string;
  kind?: "disperse" | "distribute";
};
export type DisperseStarted = { job: Job; from: { address: string; label: string; isDeposit: boolean }; plan: PlanRow[]; needLam: bigint; totalLam: bigint; etaMs: number };

/** Block X Disperse: an existing vault wallet or a fresh "Deposit N" wallet funds `to`. Amounts are drawn now
 *  (±variation, rescaled so Σ = total exactly), then the order is shuffled and one random delay per payment is drawn;
 *  the job waits until the source holds total + fees (deposit wallets, up to waitMs), then sends payment after payment. */
export function disperseV2(o: DisperseOpts): DisperseStarted {
  requireUnlocked();
  const st = store();
  let from: string;
  let isDeposit = false;
  if (o.createDeposit) {
    from = "";
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
    lamports = splitLamports(o.totalLam, targets.length, o.variationPct);
  } else throw new HttpError(400, "Amount missing: totalSol (split across the wallets), amountSol (per wallet) or amounts (per address).");
  const drawn = targets.map((t, i) => ({ address: t.address, label: t.label, lamports: lamports[i] }));
  if (o.viaRelay) requireRelayMinimum(drawn);
  const delays = randomDelays(drawn.length, o.delay);
  const plan: PlanRow[] = (o.shuffle ? shuffled(drawn) : drawn).map((p, i) => ({ ...p, delayMs: delays[i] }));
  // validated: now the deposit wallet may be created
  if (o.createDeposit) {
    const n = Object.values(st.walletMeta.meta).filter((m) => /^Deposit \d+$/.test(m.label ?? "")).length + 1;
    [from] = generateWallets(1, "Deposit");
    st.walletMeta.meta[from].label = `Deposit ${n}`;
    saveWalletMeta(st);
    isDeposit = true;
  }
  const totalLam = plan.reduce((s, p) => s + p.lamports, BigInt(0));
  // a deposit wallet sends without compute-unit price: exact fees, so it ends at 0 when funded with exactly needLam
  const perSend = (isDeposit ? BASE_FEE : TX_FEE_MARGIN) + (o.viaRelay ? RELAY_FEE : BigInt(0));
  const needLam = totalLam + BigInt(plan.length) * perSend;
  const kind = o.kind ?? "disperse";
  const srcLabel = labelOf(from);
  const etaMs = etaOf(delays, o.viaRelay);
  const job = jobNew(kind, o.viaRelay ? plan.length * 2 : plan.length, `${kind === "distribute" ? "Distribute" : "Disperse"} ${srcLabel} → ${plan.length} wallet(s) · ${solString(totalLam)} SOL${o.viaRelay ? " via relays" : ""}${rangeLabel(o.delay)}${o.shuffle ? " · random order" : ""}`);
  const results: (RowResult | undefined)[] = plan.map(() => undefined);
  job.extra = { from, isDeposit, plan: planView(plan, results), totalSol: solString(totalLam), needSol: solString(needLam), variationPct: o.variationPct, ...rangeExtra(o.delay), shuffle: o.shuffle, viaRelay: o.viaRelay, etaMs, presetName: o.presetName ?? null, phase: "waiting" };
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
    const left = bal! - needLam;
    if (left > BigInt(0) && left < RENT_MIN) {
      if (isDeposit) {
        // the runtime refuses to leave dust under the rent minimum: the last payment takes it, the deposit ends at 0
        plan[plan.length - 1].lamports += left;
        jobNote(j, `${solString(left)} SOL above the plan (under the rent minimum) is added to the last payment so ${srcLabel} ends at 0.`);
      } else throw new Error(`${srcLabel} would keep ${solString(left)} SOL after the plan — under the ${solString(RENT_MIN)} SOL rent minimum, which the network refuses. Lower the total by ${solString(RENT_MIN - left)} SOL or more (Max does it). Nothing was sent.`);
    }
    j.extra = { ...(j.extra ?? {}), phase: "sending", balanceSol: solString(bal!), plan: planView(plan, results) };
    jobNote(j, `${srcLabel} holds ${solString(bal!)} SOL — sending to ${plan.length} wallet(s)${o.shuffle ? " in random order" : ""}.`);
    const r = await sendPlan(j, st.sol.keypair(from), plan, { viaRelay: o.viaRelay, range: o.delay, cuPrice: isDeposit ? 0 : undefined, drainLast: isDeposit, onRow: (res) => (j.extra = { ...(j.extra ?? {}), plan: planView(plan, res) }) });
    j.extra = { ...(j.extra ?? {}), phase: "done", sent: r.sent, total: plan.length, plan: planView(plan, r.results) };
    logActivity(st, { kind, ok: r.sent > 0, message: `${kind === "distribute" ? "Distribute" : "Disperse"} from ${srcLabel}${o.viaRelay ? " via relays" : ""}: ${r.sent}/${plan.length} wallet(s) funded.`, wallets: [from, ...plan.map((p) => p.address)], jobId: j.id });
    if (r.sent === 0) throw new Error(j.stop ? "Stopped before any wallet was funded." : "No wallet funded.");
  });
  return { job, from: { address: from, label: srcLabel, isDeposit }, plan, needLam, totalLam, etaMs };
}

/** Block X Distribute drop zone: ONE source → targets, total = the source's whole balance minus fees when not given */
export async function distribute(o: { source: string; targets: string[]; totalLam?: bigint; variationPct: number; delay: DelayRange; shuffle: boolean; viaRelay: boolean }): Promise<DisperseStarted> {
  requireUnlocked();
  const [src] = vaultWallets([o.source]);
  const targets = [...new Set(o.targets)].filter((t) => t !== src.address);
  if (targets.length === 0) throw new HttpError(400, "Target Wallet: drag at least one wallet (not the source).");
  let totalLam = o.totalLam;
  if (totalLam === undefined) {
    const bal = await getSolBalance(readConn(), src.address).catch(() => null);
    if (bal === null) throw new HttpError(503, "RPC unreachable: the source balance could not be read. Nothing was sent.");
    const perSend = TX_FEE_MARGIN + (o.viaRelay ? RELAY_FEE : BigInt(0));
    // keep the rent minimum on the source (a balance between 0 and it is refused by the network)
    totalLam = bal - BigInt(targets.length) * perSend - RENT_MIN;
    if (totalLam <= BigInt(0)) throw new HttpError(402, `${src.label} holds ${solString(bal)} SOL: nothing left to distribute after fees for ${targets.length} wallet(s). Nothing was sent.`);
  }
  return disperseV2({ from: src.address, to: targets, totalLam, variationPct: o.variationPct, delay: o.delay, shuffle: o.shuffle, waitMs: 0, viaRelay: o.viaRelay, kind: "distribute" });
}

/** Block X Transfer drop zone: sources[i] → targets[i % targets.length]; `lamports` each, or the whole balance (ends at 0) */
export function transferPairs(sources: string[], targets: string[], lamports: bigint | null, viaRelay: boolean, delay: DelayRange = NO_DELAY, shuffle = false): Job {
  requireUnlocked();
  const st = store();
  const src = vaultWallets([...new Set(sources)]);
  const tg = vaultWallets([...new Set(targets)]);
  if (src.length === 0 || tg.length === 0) throw new HttpError(400, "Transfer needs at least one source and one target wallet.");
  const all = src.map((s, i) => ({ from: s, to: tg[i % tg.length] })).filter((p) => p.from.address !== p.to.address);
  if (all.length === 0) throw new HttpError(400, "Every source is also its target: nothing to transfer.");
  if (viaRelay && lamports !== null) requireRelayMinimum([{ label: "each transfer", lamports }]);
  const pairs = shuffle ? shuffled(all) : all;
  const delays = randomDelays(pairs.length, delay);
  const job = jobNew("transfer", viaRelay ? pairs.length * 2 : pairs.length, `Transfer ${pairs.length} wallet(s) → ${tg.length} target(s)${lamports ? ` · ${solString(lamports)} SOL each` : " · whole balance"}${viaRelay ? " via relays" : ""}${rangeLabel(delay)}${shuffle ? " · random order" : ""}`);
  job.extra = { pairs: pairs.map((p, i) => ({ from: p.from.address, to: p.to.address, delayMs: delays[i] })), sol: lamports ? solString(lamports) : null, viaRelay, shuffle, ...rangeExtra(delay), etaMs: etaOf(delays, viaRelay) };
  jobRun(job, async (j) => {
    const conn = readConn();
    let sent = 0;
    const errors: string[] = [];
    for (let i = 0; i < pairs.length; i++) {
      if (!(await waitTurn(j, delays[i], i, pairs.length, delay))) break;
      const p = pairs[i];
      const bal = await getSolBalance(conn, p.from.address).catch(() => null);
      if (bal === null) {
        errors.push(`${p.from.label}: RPC unreachable`);
        jobPush(j, false, { address: p.from.address, error: "RPC unreachable: balance could not be read" });
        continue;
      }
      // whole balance: no compute-unit price so the fees are exact and the source ends at 0
      const exact = BASE_FEE + (viaRelay ? RELAY_FEE : BigInt(0));
      const margin = TX_FEE_MARGIN + (viaRelay ? RELAY_FEE : BigInt(0));
      const amount = lamports ?? bal - exact;
      const short = lamports === null ? amount < (viaRelay ? RENT_MIN : BigInt(1)) : bal < amount + margin;
      if (short) {
        const msg = `${p.from.label} holds ${solString(bal)} SOL but needs ${solString((lamports ?? (viaRelay ? RENT_MIN : BigInt(0))) + margin)} SOL (amount + fee). Skipped.`;
        errors.push(msg);
        jobPush(j, false, { address: p.from.address, error: msg });
        continue;
      }
      const r = await sendPlan(j, st.sol.keypair(p.from.address), [{ address: p.to.address, label: p.to.label, lamports: amount, delayMs: 0 }], { viaRelay, range: delay, cuPrice: lamports === null ? 0 : undefined });
      if (r.sent) sent++;
    }
    j.extra = { ...(j.extra ?? {}), sent, total: pairs.length };
    logActivity(st, { kind: "transfer", ok: sent > 0, message: `Transfer: ${sent}/${pairs.length} wallet(s) sent.`, wallets: pairs.flatMap((p) => [p.from.address, p.to.address]), jobId: j.id });
    if (sent === 0) throw new Error(j.stop ? "Stopped before any transfer." : (errors[0] ?? "Nothing was sent."));
  });
  return job;
}

export type PrivateSendStarted = { job: Job; plan: PlanRow[] | null; totalLam: bigint | null; needLam: bigint | null; etaMs: number };

/** Private send: one vault wallet → one address (vault wallet or any address), optionally split into `parts` (1–5)
 *  random amounts (±variation, Σ = amount exactly), each part after a random delay and — viaRelay — through its own
 *  fresh relay wallet. `lamports: null` = Max: the whole balance, fees exact, the source ends at 0. */
export function privateSend(o: { from: string; to: string; lamports: bigint | null; parts: number; variationPct: number; delay: DelayRange; viaRelay: boolean; /** exact part amounts (the previewed draw); overrides lamports/parts */ amounts?: bigint[] }): PrivateSendStarted {
  requireUnlocked();
  const st = store();
  const [src] = vaultWallets([o.from]);
  if (o.from === o.to) throw new HttpError(400, "Source and destination are the same wallet.");
  const toVault = isVault(o.to);
  const toLabel = toVault ? labelOf(o.to) : `${o.to.slice(0, 4)}…${o.to.slice(-4)}`;
  const kind = toVault ? "transfer" : "withdraw";
  const delays = randomDelays(o.parts, o.delay);
  const mk = (amounts: bigint[]): PlanRow[] => amounts.map((l, i) => ({ address: o.to, label: o.parts > 1 ? `${toLabel} (part ${i + 1}/${o.parts})` : toLabel, lamports: l, delayMs: delays[i] }));
  let plan: PlanRow[] | null = null;
  let needLam: bigint | null = null;
  const margin = TX_FEE_MARGIN + (o.viaRelay ? RELAY_FEE : BigInt(0));
  if (o.amounts) {
    if (o.amounts.length !== o.parts) throw new HttpError(400, `partsSol: ${o.parts} amount(s) expected, got ${o.amounts.length}.`);
    o = { ...o, lamports: o.amounts.reduce((s, x) => s + x, BigInt(0)) };
  }
  if (o.lamports !== null) {
    if (o.lamports < BigInt(o.parts)) throw new HttpError(400, "Amount too small for that many parts.");
    plan = mk(o.amounts ?? splitLamports(o.lamports, o.parts, o.variationPct));
    if (o.viaRelay) requireRelayMinimum(plan);
    needLam = o.lamports + BigInt(o.parts) * margin;
  }
  const etaMs = etaOf(delays, o.viaRelay);
  const job = jobNew(kind, o.viaRelay ? o.parts * 2 : o.parts, `Private send ${o.lamports === null ? "max" : solString(o.lamports)} SOL ${src.label} → ${toLabel}${o.parts > 1 ? ` · ${o.parts} parts` : ""}${o.viaRelay ? " via relays" : ""}${rangeLabel(o.delay)}`);
  job.extra = { from: o.from, to: o.to, parts: o.parts, max: o.lamports === null, viaRelay: o.viaRelay, variationPct: o.variationPct, ...rangeExtra(o.delay), etaMs, plan: plan ? planView(plan, []) : null, sol: o.lamports === null ? null : solString(o.lamports) };
  jobRun(job, async (j) => {
    const bal = await getSolBalance(readConn(), o.from).catch(() => null);
    if (bal === null) throw new Error("RPC unreachable: balance could not be read. Nothing was sent.");
    let cuPrice: number | undefined;
    if (plan === null) {
      // Max: exact fees (no compute-unit price) so the source ends at exactly 0
      const exact = BASE_FEE + (o.viaRelay ? RELAY_FEE : BigInt(0));
      const total = bal - BigInt(o.parts) * exact;
      if (total < BigInt(o.parts) * (o.viaRelay ? RENT_MIN : BigInt(1))) throw new Error(`${src.label} holds ${solString(bal)} SOL — not enough to send${o.parts > 1 ? ` in ${o.parts} parts` : ""}${o.viaRelay ? ` through relays (each part ≥ ${solString(RENT_MIN)} SOL)` : ""} after fees. Nothing was sent.`);
      plan = mk(splitLamports(total, o.parts, o.variationPct));
      if (o.viaRelay && plan.some((p) => p.lamports < RENT_MIN)) plan = mk(splitLamports(total, o.parts, 0));
      cuPrice = 0;
      j.extra = { ...(j.extra ?? {}), sol: solString(total), plan: planView(plan, []) };
    } else {
      if (bal < needLam!) throw new Error(`${src.label} holds ${solString(bal)} SOL but needs ${solString(needLam!)} SOL (amount + fees${o.viaRelay ? " + relay fees" : ""}). Nothing was sent.`);
      const left = bal - needLam!;
      if (left < RENT_MIN) throw new Error(`${src.label} would keep ~${solString(left)} SOL — under the ${solString(RENT_MIN)} SOL rent minimum, which the network refuses. Use Max to empty it, or send ${solString(RENT_MIN - left)} SOL less. Nothing was sent.`);
    }
    const p = plan;
    const r = await sendPlan(j, st.sol.keypair(o.from), p, { viaRelay: o.viaRelay, range: o.delay, cuPrice, onRow: (res) => (j.extra = { ...(j.extra ?? {}), plan: planView(p, res) }) });
    const sentLam = p.reduce((s, x, i) => s + (r.results[i]?.ok ? x.lamports : BigInt(0)), BigInt(0));
    j.extra = { ...(j.extra ?? {}), plan: planView(p, r.results), sent: r.sent, total: p.length, sentSol: solString(sentLam) };
    logActivity(st, {
      kind,
      ok: r.sent > 0,
      message: `Private send ${solString(sentLam)} SOL ${src.label} → ${toLabel}${o.parts > 1 ? ` (${r.sent}/${o.parts} parts)` : ""}${o.viaRelay ? " via relays" : ""} ${r.sent === p.length ? "confirmed" : r.sent ? "partly sent" : "failed"}`,
      wallets: [o.from, o.to],
      signature: r.results.find((x) => x?.ok)?.signature ?? undefined,
      jobId: j.id,
      data: { relays: r.results.map((x) => x?.relay ?? null) },
    });
    if (r.sent === 0) throw new Error(j.stop ? "Stopped before any part was sent." : (r.results.find((x) => x?.error)?.error ?? "Nothing was sent."));
  });
  return { job, plan, totalLam: o.lamports, needLam, etaMs };
}

/** Most source wallets one deposit transaction can carry (each adds a 64-byte signature + a key + a transfer;
 *  9 still fit in 1232 bytes, 8 keeps room for the compute-budget instructions). */
export const MAX_DEPOSIT_SOURCES = 8;

/** Several vault wallets → ONE address in ONE transaction (all transfers land together or none does): a deposit
 *  address that expects one exact amount receives exactly that, under one signature. The wallet left with the most
 *  SOL pays the fee; every wallet must end at 0 or at least rent-exempt, checked before anything is signed. */
export function sendSolFromMany(sources: { address: string; lamports: bigint }[], to: string, label: string): Job {
  requireUnlocked();
  const st = store();
  if (!sources.length || sources.length > MAX_DEPOSIT_SOURCES) throw new HttpError(400, `Pick 1 to ${MAX_DEPOSIT_SOURCES} sending wallets.`);
  if (new Set(sources.map((s) => s.address)).size !== sources.length) throw new HttpError(400, "A sending wallet appears twice.");
  const named = vaultWallets(sources.map((s) => s.address));
  if (sources.some((s) => s.address === to)) throw new HttpError(400, "A sending wallet cannot be the destination.");
  if (sources.some((s) => s.lamports <= BigInt(0))) throw new HttpError(400, "Every sending wallet needs an amount above 0.");
  const total = sources.reduce((a, s) => a + s.lamports, BigInt(0));
  const job = jobNew("withdraw", 1, `${label}: ${solString(total)} SOL from ${sources.length} wallet${sources.length > 1 ? "s" : ""} → ${to.slice(0, 6)}… (one transaction)`);
  jobRun(job, async (j) => {
    const conn = readConn();
    const cuPrice = st.sol.config.priorityMicroLamports;
    const cuLimit = 600 + 300 * sources.length;
    const fee = BigInt(5_000 * sources.length) + BigInt(Math.ceil((Math.max(0, cuPrice) * cuLimit) / 1e6));
    const bals = await Promise.all(sources.map((s) => getSolBalance(conn, s.address).catch(() => null)));
    if (bals.some((b) => b === null)) throw new Error("RPC unreachable: balances could not be read. Nothing was sent.");
    const left = sources.map((s, i) => (bals[i] as bigint) - s.lamports);
    const fine = (v: bigint) => v === BigInt(0) || v >= RENT_MIN;
    const short = sources.findIndex((_, i) => left[i] < BigInt(0));
    if (short >= 0) throw new Error(`${named[short].label} holds ${solString(bals[short] as bigint)} SOL but sends ${solString(sources[short].lamports)} SOL. Nothing was sent.`);
    const order = sources.map((_, i) => i).sort((a, b) => (left[b] > left[a] ? 1 : left[b] < left[a] ? -1 : 0));
    const payer = order.find((p) => left[p] - fee >= BigInt(0) && fine(left[p] - fee) && sources.every((_, i) => i === p || fine(left[i])));
    if (payer === undefined) {
      const bad = sources.findIndex((_, i) => !fine(left[i]));
      throw new Error(bad >= 0
        ? `${named[bad].label} would keep ${solString(left[bad])} SOL — below the rent minimum ${solString(RENT_MIN)} SOL. Send its full balance or leave at least ${solString(RENT_MIN)} SOL. Nothing was sent.`
        : `No sending wallet can pay the ${solString(fee)} SOL network fee and stay rent-exempt. Lower one amount by 0.001 SOL. Nothing was sent.`);
    }
    const dest = new PublicKey(to);
    const kps = sources.map((s) => st.sol.keypair(s.address));
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit })];
    if (cuPrice > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }));
    sources.forEach((s, i) => ixs.push(SystemProgram.transfer({ fromPubkey: kps[i].publicKey, toPubkey: dest, lamports: Number(s.lamports) })));
    const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kps[payer].publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign(kps);
    const r = await sendAndConfirm(conn, sendConn(), tx, { lastValidBlockHeight });
    const ok = !!r.confirmed;
    jobPush(j, ok, { phase: "deposit", address: to, sol: solString(total), signature: r.signature ?? null, error: ok ? undefined : r.error });
    j.extra = { to, sol: solString(total), signature: r.signature ?? null, sources: sources.map((s) => ({ address: s.address, sol: solString(s.lamports) })), payer: sources[payer].address };
    logActivity(st, {
      kind: "withdraw", ok,
      message: `${label}: ${solString(total)} SOL from ${sources.length} wallet(s) → ${to.slice(0, 6)}… ${ok ? "confirmed" : "failed: " + (r.error ?? "not confirmed")}`,
      wallets: [...sources.map((s) => s.address), to], signature: r.signature ?? undefined, jobId: j.id,
    });
    if (!ok) throw new Error(r.error ?? "not confirmed");
  });
  return job;
}
