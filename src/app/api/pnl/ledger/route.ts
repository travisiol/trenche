import { json, route } from "@/server/api";
import { ledgerEntries, ledgerStatus, refreshLedger } from "@/server/ledger";

export const dynamic = "force-dynamic";

const sol = (lam: bigint) => Number(lam) / 1e9;

/** GET: the classified on-chain ledger of the vault wallets, newest first (diagnostics / "PnL from chain" list).
 *  ?refresh=1 forces a scan pass before answering. */
export const GET = route(async (req: Request) => {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  if (force) await refreshLedger({ force: true }).catch(() => null);
  const entries = [...ledgerEntries()].reverse().map((e) => ({
    signature: e.sig,
    at: e.at,
    kind: e.kind,
    mint: e.mint,
    deltaSol: sol(e.delta),
    buySol: sol(e.grossBuy),
    sellSol: sol(e.grossSell),
    networkSol: sol(e.base),
    prioritySol: sol(e.priority),
    tipSol: sol(e.tip),
    pumpFeeSol: sol(e.pumpFee),
    rentSol: sol(e.rent),
    launchSol: sol(e.launchRent),
    claimSol: sol(e.claim),
  }));
  return json({ status: ledgerStatus(), entries });
});
