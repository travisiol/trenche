import { HttpError, intIn, json, lamportsOf, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { requireUnlocked, sellWithWallets, tipLamportsFor } from "@/server/engine";
import { hotSnapshot } from "@/server/hot";
import { simulateSends } from "@/server/sender";
import { jobNew, jobRun } from "@/server/jobs";
import { store } from "@/server/store";
import type { DumpRequest, JobCreated } from "@/lib/types";

export const dynamic = "force-dynamic";

/** sell `percent` of the mint from the listed wallets (default: every vault wallet), optional Jito bundle */
export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<DumpRequest>(req);
  const st = store();
  const mint = requireAddress(body.mint, "mint");
  const candidates = body.wallets?.length ? requireAddresses(body.wallets, "wallets") : st.sol.wallets.map((w) => w.address);
  // only wallets that actually hold the token, so the job counts (and waits on) real sellers only: from the hot
  // snapshot (memory while the page is open, else one batched read — the same one the sell then reuses)
  const snap = await hotSnapshot(mint, candidates, 3500).catch(() => null);
  const wallets = !snap || simulateSends() ? candidates : candidates.filter((a) => (snap.bal.get(a)?.tokens ?? BigInt(0)) > BigInt(0));
  if (!wallets.length) throw new HttpError(409, "Nothing to sell: no wallet of the vault holds this token.");
  const percent = intIn(body.percent, 1, 100, 100, "percent");
  const bundle = !!body.bundle;
  const tipLamports = body.tipSol !== undefined && body.tipSol !== "" && lamportsOf(body.tipSol, "tipSol", true) > BigInt(0) ? tipLamportsFor(body.tipSol) : bundle ? tipLamportsFor(st.settings.tipSol) : tipLamportsFor(undefined);
  const job = jobNew("dump", wallets.length, `Dump ${percent}% × ${wallets.length} · ${mint.slice(0, 6)}…${bundle ? " · bundle" : ""}`);
  job.extra = { mint, percent, bundle };
  jobRun(job, async (j) => {
    await sellWithWallets({ mint, wallets, percent, slippageBps: intIn(body.slippageBps, 0, 9000, st.settings.slippageBps), cuPrice: intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice), cuPriceFixed: body.cuPrice !== undefined && body.cuPrice !== null && String(body.cuPrice) !== "", tipLamports, bundle, job: j, kind: "dump" });
  });
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
