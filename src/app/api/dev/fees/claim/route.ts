import { PublicKey } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { claimPumpCreatorFees, readPumpCreatorFees } from "@/engine/solana/pump/fees.js";
import { HttpError, intIn, json, readBody, requireAddress, requireAddresses, route, solString } from "@/server/api";
import { fetchCurve, labelOf, readConn, requireUnlocked, sendConn, tipLamportsFor } from "@/server/engine";
import { jobNew, jobPush, jobRun } from "@/server/jobs";
import { logActivity, store } from "@/server/store";
import type { FeesClaimRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST {mint, wallet?} | {wallets} → { jobId }. Claims the creator vault(s); the payer is the richest vault wallet.
 *  job.extra = { totalSol, signatures, claimed } once done. */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<FeesClaimRequest>(req);
  const st = store();
  const conn = readConn();
  const mint = body.mint ? requireAddress(body.mint, "mint") : undefined;
  let owners: string[];
  if (body.wallets?.length) owners = requireAddresses(body.wallets, "wallets");
  else if (body.wallet) owners = [requireAddress(body.wallet, "wallet")];
  else if (mint) {
    const found = await fetchCurve(conn, new PublicKey(mint));
    const creator = found?.curve.creator.toBase58() ?? st.launches.find((l) => l.mint === mint)?.dev;
    if (!creator) throw new HttpError(404, "Creator unknown for this mint.");
    owners = [creator];
  } else owners = st.sol.wallets.map((w) => w.address);
  const mine = owners.filter((o) => st.sol.wallets.some((w) => w.address === o));
  if (mine.length === 0) throw new HttpError(400, "None of these creators is a vault wallet: nothing to claim from here.");
  const fees = (await readPumpCreatorFees(conn, mine.map((a) => ({ label: labelOf(a), address: a })))).filter((f) => f.claimable > BigInt(0) || f.cashback > BigInt(0));
  if (fees.length === 0) throw new HttpError(409, "No creator fees to claim right now.");
  const cuPrice = intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice);
  const job = jobNew("fees", fees.length, `Claim creator fees · ${solString(fees.reduce((s, f) => s + f.claimable + f.cashback, BigInt(0)))} SOL`);
  job.extra = { mint: mint ?? null, wallets: mine };
  jobRun(job, async (j) => {
    const payers = await Promise.all(st.sol.wallets.map(async (w) => ({ w, sol: await getSolBalance(conn, w.address).catch(() => BigInt(0)) })));
    const payer = payers.sort((a, b) => (b.sol > a.sol ? 1 : -1))[0];
    if (!payer || payer.sol < BigInt(5_000_000)) throw new Error("No vault wallet holds the ~0.005 SOL needed to pay the claim transaction.");
    const r = await claimPumpCreatorFees(conn, sendConn(), st.sol.keypair(payer.w.address), fees, { cuPrice, tipLamports: tipLamportsFor(undefined) });
    const confirmed = r.sends.filter((s) => s.confirmed).length;
    r.sends.forEach((s) => jobPush(j, s.confirmed, { phase: "claim", signature: s.signature, error: s.confirmed ? undefined : s.error }));
    const totalSol = solString(r.total);
    j.extra = { ...(j.extra ?? {}), totalSol, signatures: r.sends.map((s) => s.signature), claimed: r.claimed.map((c) => ({ address: c.owner, label: c.label, sol: solString(c.lamports) })), confirmed };
    logActivity(st, { kind: "fees", ok: confirmed > 0, message: confirmed > 0 ? `Creator fees claimed: ${totalSol} SOL on ${r.claimed.length} wallet(s).` : `Claim not confirmed: ${r.sends[0]?.error ?? r.error ?? "unknown"}`, mint, wallets: mine, signature: r.sends[0]?.signature, jobId: j.id, data: { totalSol: confirmed > 0 ? totalSol : "0" } });
    if (confirmed === 0) throw new Error(r.sends[0]?.error ?? r.error ?? "claim not confirmed");
  });
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
