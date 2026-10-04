import { intIn, json, lamportsOf, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { buyWithWallets, requireUnlocked, tipLamportsFor } from "@/server/engine";
import { jobNew, jobRun } from "@/server/jobs";
import { store } from "@/server/store";
import type { JobCreated, TradeBuyRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<TradeBuyRequest>(req);
  const st = store();
  const mint = requireAddress(body.mint, "mint");
  const wallets = requireAddresses(body.wallets, "wallets");
  const lamportsEach = lamportsOf(body.sol, "sol");
  const slippageBps = intIn(body.slippageBps, 0, 9000, st.settings.slippageBps, "slippageBps");
  const cuPrice = intIn(body.cuPrice, 0, 50_000_000, st.settings.cuPrice, "cuPrice");
  const explicitTip = body.tipSol !== undefined && body.tipSol !== "" && lamportsOf(body.tipSol, "tipSol", true) > BigInt(0);
  const tipLamports = tipLamportsFor(body.tipSol);
  const bundle = explicitTip || (st.settings.jitoEnabled && tipLamportsFor(st.settings.tipSol) > BigInt(0) && body.tipSol === undefined);
  const job = jobNew("buy", wallets.length, `Buy ${body.sol} SOL × ${wallets.length} · ${mint.slice(0, 6)}…`);
  job.extra = { mint, side: "buy", sol: String(body.sol), bundle };
  jobRun(job, async (j) => {
    await buyWithWallets({ mint, wallets, lamportsEach, slippageBps, cuPrice, tipLamports: bundle ? (explicitTip ? tipLamports : tipLamportsFor(st.settings.tipSol)) : tipLamports, bundle, job: j });
  });
  const res: JobCreated = { jobId: job.id };
  return json(res);
});
