import { intIn, json, lamportsOf, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { requireUnlocked, sellWithWallets, tipLamportsFor } from "@/server/engine";
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
  const wallets = body.wallets?.length ? requireAddresses(body.wallets, "wallets") : st.sol.wallets.map((w) => w.address);
  const percent = intIn(body.percent, 1, 100, 100, "percent");
  const bundle = !!body.bundle;
  const tipLamports = body.tipSol !== undefined && body.tipSol !== "" && lamportsOf(body.tipSol, "tipSol", true) > BigInt(0) ? tipLamportsFor(body.tipSol) : bundle ? tipLamportsFor(st.settings.tipSol) : tipLamportsFor(undefined);
  const job = jobNew("dump", wallets.length, `Dump ${percent}% × ${wallets.length} · ${mint.slice(0, 6)}…${bundle ? " · bundle" : ""}`);
  job.extra = { mint, percent, bundle };
  jobRun(job, async (j) => {
    await sellWithWallets({ mint, wallets, percent, slippageBps: intIn(body.slippageBps, 0, 9000, st.settings.slippageBps), cuPrice: intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice), tipLamports, bundle, job: j, kind: "dump" });
  });
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
