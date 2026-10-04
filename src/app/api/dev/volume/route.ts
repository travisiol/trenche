import { HttpError, json, readBody, requireAddress, requireAddresses, route } from "@/server/api";
import { groupWallets, requireUnlocked } from "@/server/engine";
import { loopGet, volumeLoopFromConfig } from "@/server/tradeloop";
import { logActivity, store } from "@/server/store";
import type { JobCreated, VolumeStartRequest, VolumeStatus, VolumeStopRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

function status(mint: string): VolumeStatus {
  const loop = loopGet(`vol:${mint}`);
  if (!loop) return { mint, running: false, jobId: null, round: 0, rounds: 0, config: null };
  const c = loop.cfg;
  return {
    mint,
    running: loop.status === "running" || loop.status === "paused",
    jobId: loop.job.id,
    round: Math.ceil(loop.done / c.wallets.length),
    rounds: Math.ceil(c.totalTrades / c.wallets.length),
    config: { wallets: c.wallets, minSol: String(Number(c.minLamports) / 1e9), maxSol: String(Number(c.maxLamports) / 1e9), minDelayMs: c.minDelayMs, maxDelayMs: c.maxDelayMs, rounds: Math.ceil(c.totalTrades / c.wallets.length), slippageBps: c.slippageBps, cuPrice: c.cuPrice },
  };
}

export const GET = route(async (req: Request) => {
  const mint = requireAddress(new URL(req.url).searchParams.get("mint"), "mint");
  return json(status(mint));
});

export const POST = route(async (req: Request) => {
  requireUnlocked();
  const body = await readBody<VolumeStartRequest | VolumeStopRequest>(req);
  const mint = requireAddress(body.mint, "mint");
  if (body.action === "stop") {
    const loop = loopGet(`vol:${mint}`);
    if (loop) {
      loop.stop();
      logActivity(store(), { kind: "volume", ok: true, message: `Volume bot stopped on ${mint.slice(0, 6)}…`, mint });
    }
    return json(status(mint));
  }
  if (body.action !== "start") throw new HttpError(400, "action must be start or stop.");
  const wallets = body.group ? groupWallets(String(body.group)) : requireAddresses(body.wallets, "wallets");
  if (wallets.length === 0) throw new HttpError(400, "The group has no active wallet.");
  let loop;
  try {
    loop = volumeLoopFromConfig(mint, body, wallets, `Volume bot · ${mint.slice(0, 6)}…`);
  } catch (e) {
    throw new HttpError(409, e instanceof Error ? e.message : String(e));
  }
  loop.start();
  logActivity(store(), { kind: "volume", ok: true, message: `Volume bot started on ${mint.slice(0, 6)}…: ${wallets.length} wallet(s), ${body.rounds} round(s), ${body.minSol}–${body.maxSol} SOL`, mint, wallets, jobId: loop.job.id });
  const res: JobCreated & VolumeStatus = { ...status(mint), jobId: loop.job.id };
  return json(res);
});
