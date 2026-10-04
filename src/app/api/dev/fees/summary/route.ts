import { readPumpCreatorFees } from "@/engine/solana/pump/fees.js";
import { json, route, solString } from "@/server/api";
import { labelOf, readConn } from "@/server/engine";
import { syncPumpCluster } from "@/server/pumpcluster";
import { store } from "@/server/store";
import type { FeesSummaryCreator, FeesSummaryResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET: pending creator fees over every launched mint in one call (Dashboard "Rewards" card). Fees accrue per
 *  CREATOR vault, so launches sharing a dev wallet share one row; the vault PDA is read for each distinct creator. */
export const GET = route(async () => {
  const st = store();
  await syncPumpCluster().catch(() => null);
  const byCreator = new Map<string, string[]>();
  for (const l of st.launches) byCreator.set(l.dev, [...(byCreator.get(l.dev) ?? []), l.mint]);
  const creators = [...byCreator.keys()];
  const rows: FeesSummaryCreator[] = [];
  const unreadable: string[] = [];
  if (creators.length) {
    let fees: Awaited<ReturnType<typeof readPumpCreatorFees>> | null = null;
    try {
      fees = await readPumpCreatorFees(readConn(), creators.map((a) => ({ label: labelOf(a), address: a })));
    } catch {
      fees = null;
    }
    for (const c of creators) {
      const f = fees?.find((x) => x.owner === c);
      if (!f) {
        unreadable.push(c);
        rows.push({ wallet: c, label: labelOf(c), vault: null, pendingSol: null, claimableSol: null, cashbackSol: null, ammPendingSol: null, mints: byCreator.get(c)! });
        continue;
      }
      rows.push({ wallet: c, label: labelOf(c), vault: f.vault, pendingSol: solString(f.claimable + f.cashback), claimableSol: solString(f.claimable), cashbackSol: solString(f.cashback), ammPendingSol: solString(f.ammPending), mints: byCreator.get(c)! });
    }
  }
  const sum = (k: "pendingSol" | "claimableSol" | "cashbackSol" | "ammPendingSol"): string | null => {
    const vals = rows.map((r) => r[k]).filter((v): v is string => v !== null);
    if (rows.length && vals.length === 0) return null;
    return (Math.round(vals.reduce((s, v) => s + Number(v), 0) * 1e9) / 1e9).toString();
  };
  const claimed = st.activity.filter((a) => a.kind === "fees" && a.ok && a.data && typeof a.data.totalSol === "string").reduce((s, a) => s + Number(a.data!.totalSol), 0);
  const res: FeesSummaryResponse = {
    at: Date.now(),
    pendingSol: sum("pendingSol"),
    claimableSol: sum("claimableSol"),
    cashbackSol: sum("cashbackSol"),
    ammPendingSol: sum("ammPendingSol"),
    claimedSol: (Math.round(claimed * 1e9) / 1e9).toString(),
    launches: st.launches.length,
    creators: rows,
    unreadable,
  };
  return json(res);
});
