import { HttpError, intIn, json, numIn, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { armAutodump, autodumpStatus, disarmAutodump } from "@/server/autodump";
import { requireUnlocked } from "@/server/engine";
import { store } from "@/server/store";
import type { AutoDumpArmRequest, AutoDumpDisarmRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const mint = requireAddress(new URL(req.url).searchParams.get("mint"), "mint");
  return json(autodumpStatus(mint));
});

export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<AutoDumpArmRequest | AutoDumpDisarmRequest>(req);
  const mint = requireAddress(body.mint, "mint");
  if (body.action === "disarm") return json(disarmAutodump(mint));
  if (body.action !== "arm") throw new HttpError(400, "action must be arm or disarm.");
  const st = store();
  const wallets = body.wallets?.length ? requireAddresses(body.wallets, "wallets") : (st.launches.find((l) => l.mint === mint)?.wallets ?? st.sol.wallets.map((w) => w.address));
  const config = {
    percent: intIn(body.percent, 1, 100, 100, "percent"),
    mcUsd: body.mcUsd !== undefined ? numIn(body.mcUsd, 1, 1e12, 0, "mcUsd") : undefined,
    afterSec: body.afterSec !== undefined ? intIn(body.afterSec, 1, 86400 * 7, 0, "afterSec") : undefined,
    bundle: !!body.bundle,
    wallets,
  };
  return json(armAutodump(mint, config, wallets));
});
