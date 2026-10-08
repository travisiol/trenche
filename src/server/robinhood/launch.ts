/* Launch on Pons V2 (Robinhood Chain) with a bundle: the dev launches (dev buy inside the launch transaction through
 * the forwarder's launchAndBuy), and every bundle wallet buys in ITS OWN transaction, fired at the same instant:
 *  1. the launch is simulated from the dev wallet with a fresh salt — the token and curve addresses are fixed by
 *     (dev, salt), so the simulation gives the real addresses before anything is sent;
 *  2. each bundle buy is signed up front against that curve, its min-out computed as if every other buy of the
 *     launch (dev + the other wallets) landed first, minus the slippage of Settings;
 *  3. the bundle wallets are on the launch's snipe-tax exemption list (else Pons takes ~99 % of a buy in the first
 *     second): exempt wallets pay the normal 1 % fee;
 *  4. the launch goes to the sequencer, and at the same instant every buy goes as eth_sendRawTransactionConditional
 *     guarded by {curve: slot 0 = token}: the sequencer refuses it until the launch has executed, we resend every
 *     ~15 ms, so each buy is ordered right behind the launch, and a buy can never land on a curve that does not exist
 *     (if the launch fails, no buy is ever accepted: nothing spent). The sequencer orders by arrival (FCFS).
 * One launch at a time; the record (launches.json) keeps the dev, the bundle and every hash. */
import { randomBytes } from "node:crypto";
import { encodeFunctionData, getAddress, keccak256, parseEther, parseEventLogs, type Hash, type Hex } from "viem";
import { uploadPumpMetadata } from "@/engine/solana/pump/metadata.js";
import { HttpError } from "../api";
import { requireUnlocked } from "../engine";
import { fetchUriJson } from "../metadata";
import { logActivity, store } from "../store";
import { CURVE_ABI, FACTORY_ABI, FRESH_QUOTE, FRESH_TOKENS, LAUNCH_AND_BUY_ABI, PONS, ZERO, logoUrl, rhPublic } from "./chain";
import { curveGuard, feeCaps, sendConditional, sendRaw, sleep } from "./send";
import { ethStr, rhLaunches, saveRhLaunches, type RhBundleBuy, type RhLaunch } from "./pons";
import { rhSettings } from "./settings";
import { evmAccount, evmWallets } from "./wallet";

export type RhLaunchRequest = {
  name?: string;
  symbol?: string;
  description?: string;
  /** a new image (data URL) — or `logo`: an ipfs://cid already pinned (Vamp keeps the original logo) */
  imageDataUrl?: string;
  logo?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
  devBuyEth?: string | number;
  creatorTaxBps?: number;
  /** launching Robinhood wallet (main by default) */
  wallet?: string;
  /** the bundle: each wallet buys in its own transaction right behind the launch */
  bundle?: { address: string; eth: string | number }[];
};

export type RhLaunchResult = RhLaunch & { steps: string[] };

const BPS = BigInt(10_000);
/** Pons' snipe-tax exemption list is capped at 32 addresses */
const MAX_BUNDLE = 30;

async function pinLogo(name: string, symbol: string, description: string, dataUrl: string): Promise<{ logo: string; image: string }> {
  const m = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new HttpError(400, "image must be a base64 data URL (data:image/png;base64,…).");
  const imageBase64 = m[2].replace(/\s+/g, "");
  if (imageBase64.length > 6_000_000) throw new HttpError(400, "Image too large (4 MB max).");
  let uri: string;
  try {
    uri = await uploadPumpMetadata({ name, symbol, description, imageBase64, imageType: m[1] });
  } catch (e) {
    throw new HttpError(502, `Logo upload failed: ${e instanceof Error ? e.message : e}. Nothing was sent.`);
  }
  const meta = await fetchUriJson(uri, 10_000);
  const img = typeof meta?.image === "string" ? meta.image : "";
  const cid = img.match(/\/ipfs\/([A-Za-z0-9]+)/)?.[1] ?? img.match(/^ipfs:\/\/([A-Za-z0-9]+)/)?.[1];
  if (!cid) throw new HttpError(502, "Logo upload: no image CID in the pinned metadata. Nothing was sent.");
  return { logo: `ipfs://${cid}`, image: `https://pump.mypinata.cloud/ipfs/${cid}` };
}

function weiOrZero(v: unknown, what: string): bigint {
  const s = String(v ?? "").replace(",", ".").trim() || "0";
  try {
    const w = parseEther(s);
    if (w < BigInt(0)) throw new Error();
    return w;
  } catch {
    throw new HttpError(400, `${what}: an ETH amount (e.g. 0.01).`);
  }
}

/** tokens out of a buy on reserves (q, t): fee (+ creator tax) taken on the input — exact constant product */
export function buyOut(q: bigint, t: bigint, quoteIn: bigint, feeBps: bigint): bigint {
  const net = quoteIn - (quoteIn * feeBps) / BPS;
  return (t * net) / (q + net);
}

type Bag = { busy: boolean };
const bag = (): Bag => {
  const rt = store().runtime as { rhLaunchBag?: Bag };
  if (!rt.rhLaunchBag) rt.rhLaunchBag = { busy: false };
  return rt.rhLaunchBag;
};

export async function rhLaunch(req: RhLaunchRequest): Promise<RhLaunchResult> {
  requireUnlocked();
  const b = bag();
  if (b.busy) throw new HttpError(409, "A Robinhood launch is already running — wait for it to finish.");
  b.busy = true;
  try {
    return await launchInner(req);
  } finally {
    b.busy = false;
  }
}

async function launchInner(req: RhLaunchRequest): Promise<RhLaunchResult> {
  const st = store();
  const settings = rhSettings();
  const steps: string[] = [];
  const name = String(req.name ?? "").trim().slice(0, 34);
  const symbol = String(req.symbol ?? "").trim().slice(0, 11);
  const description = String(req.description ?? "").trim().slice(0, 1000);
  if (!name) throw new HttpError(400, "name required.");
  if (!symbol) throw new HttpError(400, "ticker required.");
  const presetLogo = /^ipfs:\/\/[A-Za-z0-9]+$/.test(String(req.logo ?? "").trim()) ? String(req.logo).trim() : null;
  if (!req.imageDataUrl && !presetLogo) throw new HttpError(400, "image required.");
  const devBuy = weiOrZero(req.devBuyEth, "Dev buy");
  const taxBps = Math.round(Number(req.creatorTaxBps ?? 0));
  if (!Number.isFinite(taxBps) || taxBps < 0 || taxBps > 1000) throw new HttpError(400, "Creator tax: 0–10 %.");
  const url = (s?: string) => String(s ?? "").trim().slice(0, 200);

  const acct = evmAccount(req.wallet || null);
  const own = new Map(evmWallets().map((w) => [w.address.toLowerCase(), w]));
  const seen = new Set<string>();
  const bundle = (req.bundle ?? [])
    .map((x) => ({ address: String(x.address ?? ""), wei: weiOrZero(x.eth, `Bundle amount of ${String(x.address).slice(0, 8)}…`) }))
    .filter((x) => x.wei > BigInt(0));
  for (const x of bundle) {
    const k = x.address.toLowerCase();
    if (!own.has(k)) throw new HttpError(400, `${x.address.slice(0, 10)}… is not one of your Robinhood wallets.`);
    if (k === acct.address.toLowerCase()) throw new HttpError(400, "The dev wallet buys through the dev buy, not the bundle.");
    if (seen.has(k)) throw new HttpError(400, `${own.get(k)!.label} is twice in the bundle.`);
    seen.add(k);
  }
  if (bundle.length > MAX_BUNDLE) throw new HttpError(400, `${MAX_BUNDLE} bundle wallets maximum (Pons exempts 32 addresses from the snipe tax).`);
  const label = (a: string) => own.get(a.toLowerCase())?.label ?? a.slice(0, 8);

  const pub = rhPublic();
  const [fee, pin, allowed, fees, devBal, devNonce] = await Promise.all([
    pub.readContract({ address: PONS.factory, abi: FACTORY_ABI, functionName: "launchFee" }),
    pub.readContract({ address: PONS.factory, abi: FACTORY_ABI, functionName: "previewLaunchEconomics", args: [BigInt(0), ZERO] }),
    pub.readContract({ address: PONS.factory, abi: FACTORY_ABI, functionName: "canLaunch", args: [acct.address] }),
    feeCaps(),
    pub.getBalance({ address: acct.address }),
    pub.getTransactionCount({ address: acct.address, blockTag: "pending" }),
  ]);
  if (!allowed) throw new HttpError(403, "Pons refuses launches from this wallet (canLaunch = false).");
  const value = fee + devBuy;
  if (devBal < value) throw new HttpError(400, `${label(acct.address)} holds ${ethStr(devBal)} ETH: the launch needs ${ethStr(value)} ETH (Pons fee ${ethStr(fee)} + dev buy ${ethStr(devBuy)}) + gas. Nothing was sent.`);

  // every bundle wallet must afford its buy + gas BEFORE anything is pinned or sent
  const gasLimit = BigInt(settings.bundleGasLimit);
  const gasCost = gasLimit * fees.maxFeePerGas;
  const wallets = await Promise.all(
    bundle.map(async (x) => {
      const address = getAddress(x.address);
      const [bal, nonce] = await Promise.all([pub.getBalance({ address }), pub.getTransactionCount({ address, blockTag: "pending" })]);
      return { ...x, address, bal, nonce };
    }),
  );
  const short = wallets.filter((w) => w.bal < w.wei + gasCost);
  if (short.length)
    throw new HttpError(
      400,
      `Not enough ETH on ${short.map((w) => `${label(w.address)} (holds ${ethStr(w.bal)}, needs ${ethStr(w.wei + gasCost)})`).join(", ")}. Fund them (Portfolio › Disperse) or lower the amounts. Nothing was sent.`,
    );

  const { logo, image } = presetLogo ? { logo: presetLogo, image: logoUrl(presetLogo) ?? "" } : await pinLogo(name, symbol, description, req.imageDataUrl!);
  steps.push(presetLogo ? "Logo: kept from the source token" : "Logo pinned on IPFS");
  const params = {
    name,
    symbol,
    logo,
    description,
    socials: { twitter: url(req.twitter), telegram: url(req.telegram), discord: url(req.discord), website: url(req.website), farcaster: "" },
    creatorFeeRecipient: acct.address,
    creatorTaxBps: taxBps,
    buybackEnabled: false,
    expectedEconomics: pin,
    salt: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  const exempt = wallets.map((w) => w.address);

  // 1. simulate → the real token + curve addresses (fixed by dev + salt)
  let token: `0x${string}`, curve: `0x${string}`, devTokens = BigInt(0), data: Hex, to: `0x${string}`;
  try {
    if (devBuy > BigInt(0)) {
      const args = [params, BigInt(0), ZERO, devBuy, BigInt(0), acct.address, exempt] as const;
      const sim = await pub.simulateContract({ account: acct, address: PONS.launchAndBuy, abi: LAUNCH_AND_BUY_ABI, functionName: "launchAndBuy", args, value });
      [token, curve, devTokens] = sim.result;
      data = encodeFunctionData({ abi: LAUNCH_AND_BUY_ABI, functionName: "launchAndBuy", args });
      to = PONS.launchAndBuy;
    } else {
      const args = [params, BigInt(0), ZERO, exempt] as const;
      const sim = await pub.simulateContract({ account: acct, address: PONS.factory, abi: FACTORY_ABI, functionName: "launchToken", args, value });
      [token, curve] = sim.result;
      data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "launchToken", args });
      to = PONS.factory;
    }
  } catch (e) {
    throw new HttpError(400, `Launch simulation failed: ${e instanceof Error ? e.message.split("\n")[0] : e}. Nothing was sent.`);
  }
  const launchGas = (await pub.estimateGas({ account: acct, to, data, value })) * BigInt(13) / BigInt(10);
  if (devBal < value + launchGas * fees.maxFeePerGas) throw new HttpError(400, `${label(acct.address)} holds ${ethStr(devBal)} ETH: the launch needs ${ethStr(value + launchGas * fees.maxFeePerGas)} ETH with the gas. Nothing was sent.`);
  steps.push(`Simulated: token ${token}`);

  // 2. the bundle buys, signed against the predicted curve; min-out = every other buy of the launch lands first
  const feeBps = BigInt(100 + taxBps);
  const slip = BigInt(Math.round(settings.slippagePct * 100));
  const outOf = (wei: bigint) => buyOut(FRESH_QUOTE, FRESH_TOKENS, wei, feeBps);
  const netOf = (wei: bigint) => wei - (wei * feeBps) / BPS;
  const allNet = netOf(devBuy) + wallets.reduce((t, w) => t + netOf(w.wei), BigInt(0));
  const allOut = (devBuy > BigInt(0) ? devTokens : BigInt(0)) + wallets.reduce((t, w) => t + outOf(w.wei), BigInt(0));
  const signed = await Promise.all(
    wallets.map(async (w) => {
      // reserves once everything but this wallet has bought
      const q = FRESH_QUOTE + allNet - netOf(w.wei);
      const t = FRESH_TOKENS - (allOut - outOf(w.wei));
      const minOut = (buyOut(q, t, w.wei, feeBps) * (BPS - slip)) / BPS;
      const tx = await evmAccount(w.address).signTransaction({
        chainId: 4663,
        type: "eip1559",
        to: curve,
        value: w.wei,
        nonce: w.nonce,
        gas: gasLimit,
        ...fees,
        data: encodeFunctionData({ abi: CURVE_ABI, functionName: "buy", args: [w.wei, minOut, w.address] }),
      });
      return { ...w, tx, hash: keccak256(tx), minOut };
    }),
  );
  const launchTx = await acct.signTransaction({ chainId: 4663, type: "eip1559", to, data, value, nonce: devNonce, gas: launchGas, ...fees });
  const launchHash = keccak256(launchTx);

  // 3. fire: the launch to the sequencer, every guarded buy at the same instant
  const guard = curveGuard(curve, token);
  const t0 = Date.now();
  const L: { dead: string | null; mined: boolean } = { dead: null, mined: false };
  const ack = sendRaw(launchTx).then(
    (h) => h,
    (e) => {
      L.dead = `the sequencer refused the launch: ${e instanceof Error ? e.message : e}`;
      return null;
    },
  );
  const mined = ack.then(async (h) => {
    if (!h) return null;
    try {
      const r = await pub.waitForTransactionReceipt({ hash: launchHash, timeout: 90_000, pollingInterval: 150 });
      if (r.status !== "success") L.dead = "the launch transaction reverted";
      else L.mined = true;
      return r;
    } catch (e) {
      L.dead = `the launch was not seen on chain (${e instanceof Error ? e.message.split("\n")[0] : e})`;
      return null;
    }
  });
  const fired: RhBundleBuy[] = await Promise.all(
    signed.map(async (w): Promise<RhBundleBuy> => {
      const base = { address: w.address, ethWei: w.wei.toString(), tokens: null };
      const deadline = t0 + 25_000;
      let last = "";
      while (Date.now() < deadline) {
        if (L.dead) return { ...base, hash: null, status: "withheld", error: `${L.dead} — buy withheld, nothing sent`, sentMs: null };
        const r = await sendConditional(w.tx, guard);
        if (r.ok) return { ...base, hash: r.hash, status: "sent", error: null, sentMs: Date.now() - t0 };
        last = r.message;
        if (r.reason === "fatal") return { ...base, hash: null, status: "failed", error: r.message, sentMs: null };
        if (r.reason === "unsupported") {
          // no conditional send on this endpoint: wait for the launch itself, then a plain send (curve exists)
          await mined;
          if (!L.mined) continue;
          try {
            return { ...base, hash: await sendRaw(w.tx), status: "sent", error: null, sentMs: Date.now() - t0 };
          } catch (e) {
            return { ...base, hash: null, status: "failed", error: e instanceof Error ? e.message : String(e), sentMs: null };
          }
        }
        await sleep(r.reason === "not-ready" ? 15 : 120);
      }
      return { ...base, hash: null, status: "failed", error: `not accepted within 25 s (${last || "launch not executed"}) — nothing sent`, sentMs: null };
    }),
  );
  const receipt = await mined;
  if (!receipt || receipt.status !== "success") {
    const why = L.dead ?? "the launch was not confirmed";
    logActivity(st, { kind: "launch", ok: false, message: `Robinhood launch ${symbol}: ${why}. Check ${launchHash} on the explorer before relaunching.`, wallets: [acct.address], data: { chain: "robinhood", tx: launchHash } });
    throw new HttpError(502, `Launch failed: ${why}. The bundle buys were withheld (they can only land once the curve exists). Check ${launchHash} on the explorer before relaunching.`);
  }
  const ev = parseEventLogs({ abi: FACTORY_ABI, eventName: "TokenLaunched", logs: receipt.logs })[0];
  const realToken = ev ? getAddress(ev.args.token) : token;
  const realCurve = ev ? getAddress(ev.args.curve) : curve;
  steps.push(`Launched in block ${receipt.blockNumber} (+${Date.now() - t0} ms)`);

  const rec: RhLaunch = {
    token: realToken,
    curve: realCurve,
    name,
    symbol,
    logo,
    image: image || null,
    txHash: launchHash,
    at: Date.now(),
    dev: acct.address,
    devBuyWei: devBuy.toString(),
    devTokens: devTokens.toString(),
    blockNumber: receipt.blockNumber.toString(),
    bundle: fired,
    creatorTaxBps: taxBps,
    spentWei: devBuy.toString(),
    receivedWei: "0",
  };
  rhLaunches().unshift(rec);
  saveRhLaunches();

  // 4. the bundle's receipts (CurveBuy tokens), saved on the record as they come
  await Promise.all(
    fired.map(async (f) => {
      if (!f.hash) return;
      try {
        const r = await pub.waitForTransactionReceipt({ hash: f.hash as Hash, timeout: 45_000, pollingInterval: 200 });
        if (r.status !== "success") {
          f.status = "failed";
          f.error = "reverted on chain (min-out not met: someone bought before it)";
          return;
        }
        const e = parseEventLogs({ abi: CURVE_ABI, eventName: "CurveBuy", logs: r.logs })[0];
        f.status = "landed";
        f.tokens = e ? e.args.tokensOut.toString() : null;
        const gap = r.blockNumber - receipt.blockNumber;
        steps.push(`${label(f.address)}: landed ${gap === BigInt(0) ? "in the launch block" : `${gap} block(s) after`} (+${f.sentMs} ms)`);
      } catch (e) {
        f.error = `not confirmed yet (${e instanceof Error ? e.message.split("\n")[0] : e})`;
      }
    }),
  );
  saveRhLaunches();
  const landed = fired.filter((f) => f.status === "landed").length;
  logActivity(st, {
    kind: "launch",
    ok: landed === fired.length,
    message: `Robinhood launch: ${name} ($${symbol}) ${rec.token} — dev buy ${ethStr(devBuy)} ETH${fired.length ? `, bundle ${landed}/${fired.length} landed` : ""}.`,
    wallets: [acct.address, ...fired.map((f) => f.address)],
    data: { chain: "robinhood", tx: launchHash, mint: rec.token },
  });
  return { ...rec, steps };
}
