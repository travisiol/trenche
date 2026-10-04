import { intIn, json, lamportsOf, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { requireUnlocked, sellWithWallets, tipLamportsFor } from "@/server/engine";
import { jobNew, jobRun } from "@/server/jobs";
import { store } from "@/server/store";
import type { JobCreated, TradeSellRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<TradeSellRequest>(req);
  const st = store();
  const mint = requireAddress(body.mint, "mint");
  const wallets = requireAddresses(body.wallets, "wallets");
  const percent = intIn(body.percent, 1, 100, 100, "percent");
  const slippageBps = intIn(body.slippageBps, 0, 9000, st.settings.slippageBps, "slippageBps");
  const cuPrice = intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice, "cuPrice");
  const explicitTip = body.tipSol !== undefined && body.tipSol !== "" && lamportsOf(body.tipSol, "tipSol", true) > BigInt(0);
  const bundle = explicitTip || (st.settings.jitoEnabled && body.tipSol === undefined && tipLamportsFor(st.settings.tipSol) > BigInt(0));
  const tipLamports = explicitTip ? tipLamportsFor(body.tipSol) : bundle ? tipLamportsFor(st.settings.tipSol) : tipLamportsFor(undefined);
  const job = jobNew("sell", wallets.length, `Sell ${percent}% × ${wallets.length} · ${mint.slice(0, 6)}…`);
  job.extra = { mint, side: "sell", percent, bundle };
  jobRun(job, async (j) => {
    await sellWithWallets({ mint, wallets, percent, slippageBps, cuPrice, tipLamports, bundle, job: j });
  });
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
