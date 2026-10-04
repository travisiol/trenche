/* Launch status reconciliation: a create whose confirmation timed out (RPC 429, blockhash window closed before
 * the status read answered) is NOT a failed launch. For every record with a create signature and no confirmation,
 * the chain is asked twice — the signature in the transaction history, then the bonding curve of the mint — and the
 * record, the in-memory run (status "live") and the job are corrected. Runs when the launch registry loads, every
 * 30 s at most from GET /api/dev/launches, and right away from runLaunch when a create looks lost. */
import { PublicKey } from "@solana/web3.js";
import { bondingCurvePda } from "@/engine/solana/pump/pdas.js";
import type { LaunchRecord, LaunchRecordStatus } from "@/lib/types";
import { readConn } from "./engine";
import { launchRuns } from "./launch";
import { logActivity, saveJobsSoon, saveLaunches, store, writeJson } from "./store";

/** sidebar word for a record: launched (create confirmed), failed (a definitive error), pending (still unknown) */
export function launchRecordStatus(l: LaunchRecord): LaunchRecordStatus {
  if (l.createConfirmed) return "launched";
  if (!l.createSignature) return l.createError ? "failed" : "pending";
  // a signature exists: only a reverted transaction / simulation refusal is final; expiry and RPC noise are "pending"
  return l.createError && !/expired|not found|timed out|timeout|rate.?limit|429|unreachable|could not confirm|restarted/i.test(l.createError) ? "failed" : "pending";
}

export type CreateCheck = { landed: boolean; how: "history" | "curve" | null; reverted: string | null; unreadable: boolean };

/** is the create of `mint` on chain? signature history first, then the curve account (both read through the queue) */
export async function checkCreateOnChain(mint: string, signature: string | null, attempts = 3): Promise<CreateCheck> {
  const conn = readConn();
  let unreadable = false;
  for (let i = 0; i < attempts; i++) {
    if (signature) {
      const st = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => undefined);
      if (st === undefined) unreadable = true;
      const v = st?.value?.[0];
      if (v?.err) return { landed: false, how: null, reverted: JSON.stringify(v.err), unreadable: false };
      if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) return { landed: true, how: "history", reverted: null, unreadable: false };
    }
    const curve = await conn.getAccountInfo(bondingCurvePda(new PublicKey(mint)), "confirmed").catch(() => undefined);
    if (curve === undefined) unreadable = true;
    else if (curve) return { landed: true, how: "curve", reverted: null, unreadable: false };
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 + 1000 * i));
  }
  return { landed: false, how: null, reverted: null, unreadable };
}

/** apply a positive on-chain check to the record, the live run and the launch job */
export function markLaunched(mint: string, how: CreateCheck["how"], signature?: string | null): void {
  const st = store();
  const rec = st.launches.find((l) => l.mint === mint);
  const note = `Create confirmed on chain (${how === "history" ? "signature found in the transaction history" : "bonding curve exists"}) — the confirmation window had closed on a rate-limited RPC.`;
  if (rec && !rec.createConfirmed) {
    rec.createConfirmed = true;
    rec.createError = null;
    if (signature && !rec.createSignature) rec.createSignature = signature;
    saveLaunches(st);
    logActivity(st, { kind: "launch", ok: true, message: `Launch ${rec.symbol} reconciled: ${note}`, mint, signature: rec.createSignature ?? undefined, jobId: rec.jobId });
  }
  const run = launchRuns().find((r) => r.state.mint === mint);
  if (run && run.state.status === "failed") {
    run.state.status = "live";
    run.state.error = null;
    run.state.createConfirmed = true;
    run.record.createConfirmed = true;
    run.record.createError = null;
    run.state.steps.push({ at: Date.now(), phase: "create", ok: true, message: note, signature: run.state.createSignature });
  }
  const job = rec ? st.jobs.get(rec.jobId) : undefined;
  if (job && job.status === "error" && /expired|not found|timed out|timeout|rate.?limit|429|could not confirm/i.test(job.error ?? "")) {
    job.status = "done";
    job.error = null;
    job.steps.push({ ok: true, at: Date.now(), phase: "create", note });
    job.extra = { ...(job.extra ?? {}), phase: "live", reconciled: true };
    saveJobsSoon(st);
  }
}

const TRADE_LIKE = new Set(["buy", "sell", "dump", "autodump", "sniper", "volume", "buy-loop", "buy_loop", "fees", "claim"]);
type Outcome = { address?: string; ok?: boolean; signature?: string | null; sol?: string; error?: string | null };

/** Journal reconciliation: a sell / dump / claim journaled ok:false ("blockhash expired", confirmation timed out)
 *  whose signature IS on chain (no error) is flipped to ok:true, its outcomes corrected and solTotal recomputed. Entries
 *  of the last 7 days with at least one signature are checked once (`data.reconciledAt`); the PnL itself does not
 *  depend on this (on-chain ledger), Activity and the calendar of the journal do. Returns how many were flipped. */
export async function reconcileActivity(limit = 20): Promise<number> {
  const st = store();
  const now = Date.now();
  const todo = st.activity
    .filter((a) => !a.ok && TRADE_LIKE.has(a.kind) && a.at > now - 7 * 86_400_000 && !(a.data && a.data.reconciledAt) && (a.signature || (Array.isArray(a.data?.outcomes) && (a.data!.outcomes as Outcome[]).some((o) => o.signature))))
    .slice(0, limit);
  if (!todo.length) return 0;
  const conn = readConn();
  let flipped = 0;
  for (const a of todo) {
    const outcomes = Array.isArray(a.data?.outcomes) ? (a.data!.outcomes as Outcome[]) : [];
    const sigs = [...new Set([a.signature, ...outcomes.map((o) => o.signature)].filter((s): s is string => !!s))];
    const statuses = await conn.getSignatureStatuses(sigs, { searchTransactionHistory: true }).catch(() => null);
    if (!statuses) continue; // RPC unreadable: retry next pass
    const landed = new Set(sigs.filter((s, i) => {
      const v = statuses.value[i];
      return v && !v.err && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized");
    }));
    a.data = { ...(a.data ?? {}), reconciledAt: now };
    if (!landed.size) {
      if (now - a.at < 10 * 60_000) delete a.data.reconciledAt; // too young to be sure: check again later
      continue;
    }
    let solTotal = 0;
    let anyOutcome = false;
    for (const o of outcomes) {
      if (o.signature && landed.has(o.signature)) {
        o.ok = true;
        o.error = null;
        anyOutcome = true;
      }
      if (o.ok) solTotal += Number(o.sol ?? 0) || 0;
    }
    if (!anyOutcome && !(a.signature && landed.has(a.signature))) continue;
    a.ok = true;
    if (outcomes.length) a.data.solTotal = solTotal;
    a.data.reconciled = "landed on chain although the confirmation had failed";
    a.message = `${a.message.replace(/\s*—\s*0\/\d+ confirmed.*$/, "")} — reconciled: landed on chain (${landed.size} signature${landed.size > 1 ? "s" : ""}).`;
    flipped++;
  }
  try {
    writeJson(st.paths.activity, st.activity);
  } catch {
    /* disk error: kept in memory */
  }
  return flipped;
}

let lastRun = 0;
let running: Promise<number> | null = null;

/** check every unconfirmed record that has a create signature; returns how many were marked launched */
export function reconcileLaunches(opts: { force?: boolean; minIntervalMs?: number } = {}): Promise<number> {
  const now = Date.now();
  if (running) return running;
  if (!opts.force && now - lastRun < (opts.minIntervalMs ?? 30_000)) return Promise.resolve(0);
  lastRun = now;
  running = (async () => {
    const st = store();
    const todo = st.launches.filter((l) => !l.createConfirmed && l.createSignature && launchRecordStatus(l) === "pending").slice(0, 10);
    let fixed = 0;
    fixed += await reconcileActivity().catch(() => 0);
    for (const l of todo) {
      const r = await checkCreateOnChain(l.mint, l.createSignature, 1).catch(() => null);
      if (!r) continue;
      if (r.landed) {
        markLaunched(l.mint, r.how);
        fixed++;
      } else if (r.reverted) {
        l.createError = `Create transaction reverted: ${r.reverted}`;
        saveLaunches(st);
      } else if (!r.unreadable && now - l.at > 10 * 60_000) {
        // ten minutes, chain readable, no curve: the create really never landed
        l.createError = `${l.createError ?? "blockhash expired"} — mint not found on chain after 10 minutes`;
        saveLaunches(st);
      }
    }
    return fixed;
  })().finally(() => {
    running = null;
  });
  return running;
}
