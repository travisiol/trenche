/* pump.fun creator-fee claims, shared by POST /api/dev/fees/claim (manual "Claim") and the auto-claim watcher
 * (autoclaim.ts). Where the SOL goes — verified in src/engine/solana/pump/instructions.js:
 *   collect_creator_fee accounts = [creator (writable), creator_vault PDA (writable), system, event authority, program]
 *   claim_cashback       accounts = [owner (writable), user_volume PDA (writable), system, event authority, program]
 * Neither account #0 is a signer: the program moves the vault's lamports to the CREATOR account itself, so the fees
 * always land on the wallet that launched the token (the dev wallet). The transaction payer only signs and pays the
 * ~0.000005 SOL fee (+ optional tip); it never receives anything.
 *
 * Sending is done here, not through engine/send.js: public RPCs answer 429 under polling and a blockhash fetched before
 * the balance reads expires before the send. So: every RPC call retries with exponential backoff on 429/5xx/network,
 * the blockhash is fetched right before signing, the signature is polled with getSignatureStatuses (rebroadcast while
 * waiting), and when the blockhash expires the creator vault is re-read before anything is reported as failed — a claim
 * whose vault went empty landed, whatever the RPC said. Up to 3 blockhash cycles per transaction. */
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { readPumpCreatorFees } from "@/engine/solana/pump/fees.js";
import { claimCashbackInstruction, collectCreatorFeeInstruction } from "@/engine/solana/pump/instructions.js";
import { tipInstruction } from "@/engine/solana/pump/math.js";
import { encodeBase58 } from "@/lib/base58";
import { sleep, solString } from "./api";
import { fetchCurve, labelOf, readConn, sendConn, tipLamportsFor } from "./engine";
import { jobNew, jobNote, jobPush, jobRun } from "./jobs";
import { logActivity, store, type Job } from "./store";

export type CreatorFeeRead = Awaited<ReturnType<typeof readPumpCreatorFees>>[number];

/* ------------------------------------------------------------------ RPC retry wrapper (local to this module) */

const RETRYABLE = /429|rate limit|too many requests|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|50[234]|Service Unavailable|Gateway|timeout/i;

/** run `fn`, retrying on 429 / 5xx / network errors with exponential backoff (0.8 s, 1.6 s, 3.2 s, 6.4 s…) */
export async function withBackoff<T>(fn: () => Promise<T>, what: string, tries = 5): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!RETRYABLE.test(msg) || i === tries - 1) break;
      await sleep(800 * 2 ** i + Math.floor(Math.random() * 300));
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  throw new Error(`${what}: ${/429|rate limit|too many/i.test(msg) ? "RPC rate limit (429) after retries — set a Helius key or a private RPC in Settings › Workspace" : msg.slice(0, 200)}`);
}

/** the creator of `mint`: the bonding curve's `creator` (authoritative, survives migration), else the dev of a launch made here */
export async function creatorOf(mint: string): Promise<string | null> {
  const found = await withBackoff(() => fetchCurve(readConn(), new PublicKey(mint)), "bonding curve read").catch(() => null);
  return found?.curve.creator.toBase58() ?? store().launches.find((l) => l.mint === mint)?.dev ?? null;
}

/** ONE getMultipleAccountsInfo for every owner (vault PDA + user-volume PDA + AMM vault ATA), with backoff */
export async function readCreatorFees(owners: string[]): Promise<CreatorFeeRead[]> {
  if (owners.length === 0) return [];
  return withBackoff(() => readPumpCreatorFees(readConn(), owners.map((a) => ({ label: labelOf(a), address: a }))), "creator vault read");
}

export const CLAIM_PAYER_MIN_LAMPORTS = BigInt(5_000_000);
const MAX_TX_BYTES = 1232;
const CLAIM_CU_PER_WALLET = 16_000;

/* ------------------------------------------------------------------ robust send */

export type SendResult = { signature: string; confirmed: boolean; error: string | null; broadcasts: number; cycles: number; /** landed per the vault balance although the RPC never confirmed the signature */ verifiedByBalance?: boolean };

function buildClaimTx(payer: Keypair, rows: CreatorFeeRead[], o: { cuPrice: number; tipLamports: bigint; recentBlockhash: string }): VersionedTransaction {
  const collect = rows.filter((r) => r.claimable > BigInt(0)).map((r) => collectCreatorFeeInstruction(new PublicKey(r.owner)));
  const cashback = rows.filter((r) => r.cashback > BigInt(0)).map((r) => claimCashbackInstruction(new PublicKey(r.owner)));
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 + CLAIM_CU_PER_WALLET * (collect.length + cashback.length) }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: o.cuPrice }),
    ...(o.tipLamports > BigInt(0) ? [tipInstruction(payer.publicKey, o.tipLamports)] : []),
    ...collect,
    ...cashback,
  ];
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: o.recentBlockhash, instructions: ixs }).compileToV0Message());
  tx.sign([payer]);
  return tx;
}

/** split rows into transactions that fit 1232 bytes (sized with a dummy blockhash) */
function chunkRows(payer: Keypair, rows: CreatorFeeRead[], cuPrice: number, tipLamports: bigint): CreatorFeeRead[][] {
  const chunks: CreatorFeeRead[][] = [];
  let cur: CreatorFeeRead[] = [];
  const dummy = "11111111111111111111111111111111";
  for (const r of rows) {
    const next = [...cur, r];
    if (cur.length > 0 && buildClaimTx(payer, next, { cuPrice, tipLamports, recentBlockhash: dummy }).serialize().length > MAX_TX_BYTES) {
      chunks.push(cur);
      cur = [r];
    } else cur = next;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** vault lamports (above rent) + cashback for `owners`, summed — the "did it land?" probe */
async function pendingOf(owners: string[]): Promise<bigint | null> {
  try {
    const fees = await readCreatorFees(owners);
    return fees.reduce((s, f) => s + f.claimable + f.cashback, BigInt(0));
  } catch {
    return null;
  }
}

/** send one claim transaction robustly; `pendingBefore` is what the vault(s) held when the rows were read */
async function sendClaimRobust(read: Connection, send: Connection, payer: Keypair, rows: CreatorFeeRead[], o: { cuPrice: number; tipLamports: bigint; pendingBefore: bigint; job: Job | null }): Promise<SendResult> {
  const owners = rows.map((r) => r.owner);
  let broadcasts = 0;
  let lastError: string | null = null;
  let lastSig = "";
  for (let cycle = 1; cycle <= 3; cycle++) {
    // fresh blockhash right before signing
    const bh = await withBackoff(() => read.getLatestBlockhash("confirmed"), "blockhash");
    const tx = buildClaimTx(payer, rows, { cuPrice: o.cuPrice, tipLamports: o.tipLamports, recentBlockhash: bh.blockhash });
    const raw = tx.serialize();
    const sig = encodeBase58(tx.signatures[0]);
    lastSig = sig;
    if (cycle === 1) {
      // readable program errors before anything is broadcast (a 429 here is not a reason to give up)
      try {
        const sim = await withBackoff(() => read.simulateTransaction(tx, { commitment: "confirmed", sigVerify: false, replaceRecentBlockhash: false }), "simulation", 3);
        if (sim.value.err) return { signature: sig, confirmed: false, broadcasts: 0, cycles: cycle, error: `simulation: ${JSON.stringify(sim.value.err)}${sim.value.logs?.length ? " — " + sim.value.logs.slice(-3).join(" | ") : ""}`.slice(0, 300) };
      } catch (e) {
        jobNote(o.job, `simulation skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const broadcast = async (): Promise<boolean> => {
      try {
        await withBackoff(() => send.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }), "send", 4);
        broadcasts++;
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already been processed|AlreadyProcessed/i.test(msg)) {
          broadcasts++;
          return true;
        }
        lastError = msg;
        return false;
      }
    };
    if (!(await broadcast())) {
      if (/Blockhash not found|blockhash/i.test(lastError ?? "")) continue; // next cycle, fresh blockhash
      return { signature: sig, confirmed: false, broadcasts, cycles: cycle, error: lastError };
    }
    // confirm: poll statuses every 1.5 s, rebroadcast every 3rd poll, check block height every 4th, 75 s max per cycle
    const t0 = Date.now();
    let polls = 0;
    let expired = false;
    while (Date.now() - t0 < 75_000) {
      await sleep(1500);
      polls++;
      const st = await read.getSignatureStatuses([sig]).then((r) => r.value[0]).catch(() => undefined);
      if (st) {
        if (st.err) return { signature: sig, confirmed: false, broadcasts, cycles: cycle, error: `transaction failed on chain: ${JSON.stringify(st.err)}` };
        if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return { signature: sig, confirmed: true, broadcasts, cycles: cycle, error: null };
      }
      if (polls % 4 === 0) {
        const h = await read.getBlockHeight("confirmed").catch(() => 0);
        if (h > bh.lastValidBlockHeight) {
          expired = true;
          break;
        }
      }
      if (polls % 3 === 0) await broadcast();
    }
    // the RPC never confirmed it: did it land anyway? (history search, then the vault itself)
    const late = await read.getSignatureStatuses([sig], { searchTransactionHistory: true }).then((r) => r.value[0]).catch(() => undefined);
    if (late && !late.err && (late.confirmationStatus === "confirmed" || late.confirmationStatus === "finalized")) return { signature: sig, confirmed: true, broadcasts, cycles: cycle, error: null };
    if (late?.err) return { signature: sig, confirmed: false, broadcasts, cycles: cycle, error: `transaction failed on chain: ${JSON.stringify(late.err)}` };
    const after = await pendingOf(owners);
    if (after !== null && after < o.pendingBefore) {
      jobNote(o.job, `signature not reported by the RPC but the creator vault dropped from ${solString(o.pendingBefore)} to ${solString(after)} SOL — the claim landed`, { signature: sig });
      return { signature: sig, confirmed: true, broadcasts, cycles: cycle, error: null, verifiedByBalance: true };
    }
    lastError = expired ? `blockhash expired before inclusion (cycle ${cycle}/3)` : `not confirmed within 75 s (cycle ${cycle}/3)`;
    jobNote(o.job, `${lastError} — retrying with a fresh blockhash`, { signature: sig });
  }
  return { signature: lastSig, confirmed: false, broadcasts, cycles: 3, error: `${lastError ?? "not confirmed"} — the creator vault still holds the fees; nothing was lost, claim again` };
}

/* ------------------------------------------------------------------ the claim job */

export type ClaimOutcome = { ok: boolean; totalSol: string; confirmed: number; signatures: string[]; error: string | null; /** creator vault total after the claim (null when unreadable) */ pendingAfterSol: string | null };

export type ClaimJobOptions = {
  mint?: string | null;
  cuPrice: number;
  /** activity.json kind: "fees" for a manual Claim, "claim" for the auto-claim watcher */
  kind: "fees" | "claim";
  label?: string;
  /** pays the transaction when it holds ≥ 0.005 SOL (the creator itself for an auto-claim), else the richest vault wallet */
  preferPayer?: string;
  /** activity message prefix, default "Creator fees claimed" */
  messagePrefix?: string;
  /** vault reads already done this tick (auto-claim): skips the second read */
  fees?: CreatorFeeRead[];
};

/** Build and run the claim job for the creator wallets `owners` (every one must be a vault wallet — checked by the
 *  caller). The job exists even when the claim fails (unreadable RPC, nothing to claim, no payer): the failure is its
 *  `error`, logged in activity.json. `done` resolves when the job ends — it never rejects; read `ok` / `error`.
 *  job.extra = { totalSol, signatures, claimed, confirmed, payer, pendingAfterSol } once done. */
export function runClaimJob(owners: string[], o: ClaimJobOptions): { job: Job; done: Promise<ClaimOutcome> } {
  const st = store();
  const job = jobNew(o.kind, Math.max(1, owners.length), o.label ?? `Claim creator fees · ${owners.length} creator${owners.length > 1 ? "s" : ""}`);
  job.extra = { mint: o.mint ?? null, wallets: owners, auto: o.kind === "claim" };
  let resolve!: (r: ClaimOutcome) => void;
  const done = new Promise<ClaimOutcome>((r) => (resolve = r));
  const prefix = o.messagePrefix ?? "Creator fees claimed";
  const failPrefix = o.kind === "claim" ? "Auto-claim failed" : "Claim failed";
  jobRun(job, async (j) => {
    let out: ClaimOutcome = { ok: false, totalSol: "0", confirmed: 0, signatures: [], error: null, pendingAfterSol: null };
    try {
      const notMine = owners.filter((a) => !st.sol.wallets.some((w) => w.address === a));
      if (notMine.length) throw new Error(`Creator ${notMine[0].slice(0, 6)}… is not a vault wallet — the fees would go to it, not to you; nothing to claim from here.`);
      const fees = o.fees ?? (await readCreatorFees(owners));
      const rows = fees.filter((f) => f.claimable > BigInt(0) || f.cashback > BigInt(0));
      if (rows.length === 0) throw new Error("No creator fees to claim right now (the vault only holds its rent).");
      const expected = rows.reduce((s, f) => s + f.claimable + f.cashback, BigInt(0));
      job.label = o.label ?? `Claim creator fees · ${solString(expected)} SOL`;
      job.total = rows.length;
      const read = readConn();
      const candidates = st.sol.wallets.map((w) => w.address);
      const balances = await Promise.all(candidates.map(async (a) => ({ a, sol: await withBackoff(() => getSolBalance(read, a), "balance", 3).catch(() => BigInt(0)) })));
      const preferred = o.preferPayer ? balances.find((b) => b.a === o.preferPayer) : undefined;
      const payer = preferred && preferred.sol >= CLAIM_PAYER_MIN_LAMPORTS ? preferred : balances.sort((x, y) => (y.sol > x.sol ? 1 : y.sol < x.sol ? -1 : 0))[0];
      if (!payer || payer.sol < CLAIM_PAYER_MIN_LAMPORTS) throw new Error(`No vault wallet holds the ~0.005 SOL needed to pay the claim transaction (richest: ${payer ? solString(payer.sol) : "0"} SOL).`);
      const kp = st.sol.keypair(payer.a);
      const tip = tipLamportsFor(undefined);
      const chunks = chunkRows(kp, rows, o.cuPrice, tip);
      jobNote(j, `payer ${labelOf(payer.a)} (${payer.a.slice(0, 4)}…${payer.a.slice(-4)}) · ${chunks.length} transaction(s) · fees go to the creator wallet(s)`);
      const results: SendResult[] = [];
      let claimedLamports = BigInt(0);
      for (const chunk of chunks) {
        const pendingBefore = chunk.reduce((s, f) => s + f.claimable + f.cashback, BigInt(0));
        const r = await sendClaimRobust(read, sendConn(), kp, chunk, { cuPrice: o.cuPrice, tipLamports: tip, pendingBefore, job: j });
        results.push(r);
        if (r.confirmed) claimedLamports += pendingBefore;
        jobPush(j, r.confirmed, { phase: "claim", signature: r.signature, sol: solString(pendingBefore), label: chunk.map((c) => labelOf(c.owner)).join(", "), error: r.confirmed ? undefined : (r.error ?? undefined), note: r.verifiedByBalance ? "landed (verified by the vault balance)" : undefined });
      }
      const confirmed = results.filter((r) => r.confirmed).length;
      const after = await pendingOf(owners);
      const totalSol = solString(claimedLamports);
      const error = confirmed > 0 ? null : (results[0]?.error ?? "claim not confirmed");
      j.extra = { ...(j.extra ?? {}), payer: payer.a, totalSol, signatures: results.map((r) => r.signature), claimed: rows.map((c) => ({ address: c.owner, label: c.label, sol: solString(c.claimable + c.cashback) })), confirmed, pendingAfterSol: after === null ? null : solString(after) };
      const to = rows.length === 1 ? ` → ${labelOf(rows[0].owner)} (${rows[0].owner.slice(0, 4)}…${rows[0].owner.slice(-4)})` : ` on ${rows.length} wallet(s)`;
      logActivity(st, {
        kind: o.kind,
        ok: confirmed > 0,
        message: confirmed > 0 ? `${prefix}: ${totalSol} SOL${to}.` : `${failPrefix}: ${error}`,
        mint: o.mint ?? undefined,
        wallets: owners,
        signature: results.find((r) => r.confirmed)?.signature ?? results[0]?.signature,
        jobId: j.id,
        data: { totalSol: confirmed > 0 ? totalSol : "0", auto: o.kind === "claim", payer: payer.a },
      });
      out = { ok: confirmed > 0, totalSol: confirmed > 0 ? totalSol : "0", confirmed, signatures: results.map((r) => r.signature), error, pendingAfterSol: after === null ? null : solString(after) };
      if (confirmed === 0) throw new Error(error ?? "claim not confirmed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!out.error) {
        out = { ...out, ok: false, error: msg };
        logActivity(st, { kind: o.kind, ok: false, message: `${failPrefix}: ${msg}`, mint: o.mint ?? undefined, wallets: owners, jobId: j.id, data: { totalSol: "0", auto: o.kind === "claim" } });
      }
      throw e;
    } finally {
      resolve(out);
    }
  });
  return { job, done };
}
