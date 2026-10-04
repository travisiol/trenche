import { PublicKey } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { claimPumpCreatorFees, readPumpCreatorFees } from "@/engine/solana/pump/fees.js";
import { HttpError, intIn, json, readBody, requireAddress, requireAddresses, route, solString } from "@/server/api";
import { fetchCurve, labelOf, readConn, requireUnlocked, sendConn, tipLamportsFor } from "@/server/engine";
import { logActivity, store } from "@/server/store";
import type { FeesClaimRequest, FeesClaimResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** claims the creator vault(s) of the given wallets (or of the mint's creator); the payer is the richest vault wallet */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<FeesClaimRequest>(req);
  const st = store();
  const conn = readConn();
  let owners: string[];
  if (body.wallets?.length) owners = requireAddresses(body.wallets, "wallets");
  else if (body.mint) {
    const m = requireAddress(body.mint, "mint");
    const found = await fetchCurve(conn, new PublicKey(m));
    const creator = found?.curve.creator.toBase58() ?? st.launches.find((l) => l.mint === m)?.dev;
    if (!creator) throw new HttpError(404, "Creator unknown for this mint.");
    owners = [creator];
  } else owners = st.sol.wallets.map((w) => w.address);
  const mine = owners.filter((o) => st.sol.wallets.some((w) => w.address === o));
  if (mine.length === 0) throw new HttpError(400, "None of these creators is a vault wallet: nothing to claim from here.");
  const fees = (await readPumpCreatorFees(conn, mine.map((a) => ({ label: labelOf(a), address: a })))).filter((f) => f.claimable > BigInt(0) || f.cashback > BigInt(0));
  if (fees.length === 0) throw new HttpError(409, "No creator fees to claim right now.");
  const payers = await Promise.all(st.sol.wallets.map(async (w) => ({ w, sol: await getSolBalance(conn, w.address).catch(() => BigInt(0)) })));
  const payer = payers.sort((a, b) => (b.sol > a.sol ? 1 : -1))[0];
  if (!payer || payer.sol < BigInt(5_000_000)) throw new HttpError(402, "No vault wallet holds the ~0.005 SOL needed to pay the claim transaction.");
  const r = await claimPumpCreatorFees(conn, sendConn(), st.sol.keypair(payer.w.address), fees, { cuPrice: intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice), tipLamports: tipLamportsFor(undefined) });
  const confirmed = r.sends.filter((s) => s.confirmed).length;
  const res: FeesClaimResponse = {
    claimed: r.claimed.map((c) => ({ address: c.owner, label: c.label, sol: solString(c.lamports) })),
    totalSol: solString(r.total),
    signatures: r.sends.map((s) => s.signature),
    confirmed,
    error: confirmed > 0 ? null : (r.sends[0]?.error ?? r.error ?? "claim not confirmed"),
  };
  logActivity(st, { kind: "fees", ok: confirmed > 0, message: confirmed > 0 ? `Creator fees claimed: ${res.totalSol} SOL on ${res.claimed.length} wallet(s).` : `Claim not confirmed: ${res.error}`, mint: body.mint, wallets: mine, signature: res.signatures[0] });
  return json(res);
});
