/* Launch and trade on Pons V2 (Robinhood Chain) from the Robinhood dev wallet.
 *  · launch: forwarder.launchAndBuy (dev buy in the same tx, the dev is exempt from the 3 s snipe tax) or
 *    factory.launchToken without a dev buy; value = factory.launchFee() (+ dev buy); economics pinned with
 *    previewLaunchEconomics(0, ETH); creator fees go to the dev wallet.
 *  · logo: the image is pinned through pump.fun's IPFS upload (the same one the Solana launches use) and passed as
 *    ipfs://<cid>, the format Pons tokens carry (Pons' own upload refuses other origins).
 *  · trades: curve.buy / curve.sell (sell needs an approve to the curve), min-out from getReserves (constant product
 *    on quote + 1.68 ETH phantom, fee on the input when buying, on the output when selling).
 *  · fees: Pons sweeps creator fees to the escrow, claim() pays them to the dev wallet. */
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { formatEther, getAddress, isAddress, parseEther, parseEventLogs, type Hash } from "viem";
import { uploadPumpMetadata } from "@/engine/solana/pump/metadata.js";
import { HttpError } from "../api";
import { requireUnlocked } from "../engine";
import { fetchUriJson } from "../metadata";
import { logActivity, readJson, store, writeJson } from "../store";
import { CURVE_ABI, ERC20_ABI, ESCROW_ABI, FACTORY_ABI, LAUNCH_AND_BUY_ABI, PONS, ZERO, ethUsd, rhPublic, rhWallet } from "./chain";
import { evmAccount, evmWallets, rhDir, type EvmWallet } from "./wallet";

export type RhLaunch = {
  token: string;
  curve: string;
  name: string;
  symbol: string;
  logo: string;
  image: string | null;
  txHash: string;
  at: number;
  /** the Robinhood wallet that launched it (creator fees go there); missing on records older than multi-wallet = main */
  dev?: string;
  devBuyWei: string;
  /** ETH spent on buys (dev buy included) / received from sells by the dev wallet through DONCHAIN */
  spentWei: string;
  receivedWei: string;
};

const launchesPath = () => join(rhDir(), "launches.json");
function launches(): RhLaunch[] {
  const rt = store().runtime as { rhLaunches?: RhLaunch[] };
  if (!rt.rhLaunches) rt.rhLaunches = readJson<RhLaunch[]>(launchesPath(), []);
  return rt.rhLaunches;
}
function saveLaunches(): void {
  writeJson(launchesPath(), launches());
}
function findLaunch(token: string): RhLaunch {
  const l = launches().find((x) => x.token.toLowerCase() === token.toLowerCase());
  if (!l) throw new HttpError(404, "Token not launched from DONCHAIN.");
  return l;
}

const ethStr = (wei: bigint, dp = 6) => Number(formatEther(wei)).toFixed(dp);

/** gas reserve for a call: estimate × 1.3 at the current max fee (viem fills the real fee; the difference stays) */
async function gasReserve(gas: bigint): Promise<bigint> {
  const fees = await rhPublic().estimateFeesPerGas();
  return ((gas * BigInt(13)) / BigInt(10)) * (fees.maxFeePerGas ?? BigInt(0));
}

async function needBalance(address: `0x${string}`, value: bigint, gas: bigint, what: string): Promise<void> {
  const [bal, reserve] = await Promise.all([rhPublic().getBalance({ address }), gasReserve(gas)]);
  if (bal < value + reserve)
    throw new HttpError(400, `The Robinhood wallet holds ${ethStr(bal)} ETH: ${what} needs ${ethStr(value + reserve)} ETH (${ethStr(value)} + ${ethStr(reserve, 7)} gas). Bridge SOL to it first. Nothing was sent.`);
}

async function receiptOf(hash: Hash) {
  const r = await rhPublic().waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 500 });
  if (r.status !== "success") throw new HttpError(502, `Transaction reverted: ${hash}`);
  return r;
}

/* ------------------------------------------------------------------ logo */

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

/* ------------------------------------------------------------------ launch */

export type RhLaunchRequest = {
  name?: string;
  symbol?: string;
  description?: string;
  imageDataUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  devBuyEth?: string | number;
  creatorTaxBps?: number;
  /** launching Robinhood wallet (main by default) */
  wallet?: string;
};

export async function rhLaunch(req: RhLaunchRequest): Promise<RhLaunch> {
  requireUnlocked();
  const st = store();
  const name = String(req.name ?? "").trim().slice(0, 34);
  const symbol = String(req.symbol ?? "").trim().slice(0, 11);
  const description = String(req.description ?? "").trim().slice(0, 1000);
  if (!name) throw new HttpError(400, "name required.");
  if (!symbol) throw new HttpError(400, "ticker required.");
  if (!req.imageDataUrl) throw new HttpError(400, "image required.");
  let devBuy: bigint;
  try {
    devBuy = parseEther(String(req.devBuyEth ?? "0").replace(",", ".").trim() || "0");
  } catch {
    throw new HttpError(400, "Dev buy: an ETH amount (e.g. 0.01).");
  }
  if (devBuy < BigInt(0)) throw new HttpError(400, "Dev buy cannot be negative.");
  const taxBps = Math.round(Number(req.creatorTaxBps ?? 0));
  if (!Number.isFinite(taxBps) || taxBps < 0 || taxBps > 1000) throw new HttpError(400, "Creator tax: 0–10 %.");
  const url = (s?: string) => String(s ?? "").trim().slice(0, 200);

  const acct = evmAccount(req.wallet || null);
  const pub = rhPublic();
  const [fee, pin, allowed] = await Promise.all([
    pub.readContract({ address: PONS.factory, abi: FACTORY_ABI, functionName: "launchFee" }),
    pub.readContract({ address: PONS.factory, abi: FACTORY_ABI, functionName: "previewLaunchEconomics", args: [BigInt(0), ZERO] }),
    pub.readContract({ address: PONS.factory, abi: FACTORY_ABI, functionName: "canLaunch", args: [acct.address] }),
  ]);
  if (!allowed) throw new HttpError(403, "Pons refuses launches from this wallet (canLaunch = false).");
  // a balance check before pinning the logo: no upload for a launch that cannot be paid
  const value = fee + devBuy;
  const bal0 = await pub.getBalance({ address: acct.address });
  if (bal0 < value) throw new HttpError(400, `The Robinhood wallet holds ${ethStr(bal0)} ETH: the launch needs ${ethStr(value)} ETH (fee ${ethStr(fee)} + dev buy ${ethStr(devBuy)}) + gas. Bridge SOL to it first. Nothing was sent.`);

  const { logo, image } = await pinLogo(name, symbol, description, req.imageDataUrl);
  const params = {
    name,
    symbol,
    logo,
    description,
    socials: { twitter: url(req.twitter), telegram: url(req.telegram), discord: "", website: url(req.website), farcaster: "" },
    creatorFeeRecipient: acct.address,
    creatorTaxBps: taxBps,
    buybackEnabled: false,
    expectedEconomics: pin,
    salt: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
  };
  const wallet = rhWallet(acct);
  let hash: Hash;
  if (devBuy > BigInt(0)) {
    const sim = await pub
      .simulateContract({ account: acct, address: PONS.launchAndBuy, abi: LAUNCH_AND_BUY_ABI, functionName: "launchAndBuy", args: [params, BigInt(0), ZERO, devBuy, BigInt(0), acct.address, []], value })
      .catch((e) => {
        throw new HttpError(400, `Launch simulation failed: ${e instanceof Error ? e.message.split("\n")[0] : e}. Nothing was sent.`);
      });
    const gas = await pub.estimateContractGas({ account: acct, address: PONS.launchAndBuy, abi: LAUNCH_AND_BUY_ABI, functionName: "launchAndBuy", args: sim.request.args, value });
    await needBalance(acct.address, value, gas, "the launch");
    hash = await wallet.writeContract({ ...sim.request, gas: (gas * BigInt(13)) / BigInt(10) });
  } else {
    const sim = await pub
      .simulateContract({ account: acct, address: PONS.factory, abi: FACTORY_ABI, functionName: "launchToken", args: [params, BigInt(0), ZERO, []], value })
      .catch((e) => {
        throw new HttpError(400, `Launch simulation failed: ${e instanceof Error ? e.message.split("\n")[0] : e}. Nothing was sent.`);
      });
    const gas = await pub.estimateContractGas({ account: acct, address: PONS.factory, abi: FACTORY_ABI, functionName: "launchToken", args: sim.request.args, value });
    await needBalance(acct.address, value, gas, "the launch");
    hash = await wallet.writeContract({ ...sim.request, gas: (gas * BigInt(13)) / BigInt(10) });
  }
  let receipt;
  try {
    receipt = await receiptOf(hash);
  } catch (e) {
    logActivity(st, { kind: "launch", ok: false, message: `Robinhood launch ${symbol}: ${e instanceof Error ? e.message : e} — DO NOT relaunch before checking ${hash} on the explorer.` });
    throw e;
  }
  const ev = parseEventLogs({ abi: FACTORY_ABI, eventName: "TokenLaunched", logs: receipt.logs })[0];
  if (!ev) throw new HttpError(502, `Launch mined (${hash}) but no TokenLaunched event — check the explorer.`);
  const rec: RhLaunch = {
    token: getAddress(ev.args.token),
    curve: getAddress(ev.args.curve),
    name,
    symbol,
    logo,
    image,
    txHash: hash,
    at: Date.now(),
    dev: acct.address,
    devBuyWei: devBuy.toString(),
    spentWei: devBuy.toString(),
    receivedWei: "0",
  };
  launches().unshift(rec);
  saveLaunches();
  logActivity(st, { kind: "launch", ok: true, message: `Robinhood launch: ${name} ($${symbol}) ${rec.token} — dev buy ${ethStr(devBuy)} ETH.`, data: { chain: "robinhood", tx: hash } });
  return rec;
}

/* ------------------------------------------------------------------ trades */

const SLIPPAGE_BPS = BigInt(2000);

export async function rhBuy(token: string, ethAmount: string, wallet?: string | null): Promise<{ hash: string; tokensOut: string }> {
  requireUnlocked();
  const l = findLaunch(token);
  let quoteIn: bigint;
  try {
    quoteIn = parseEther(String(ethAmount).replace(",", ".").trim());
  } catch {
    throw new HttpError(400, "Amount: ETH (e.g. 0.01).");
  }
  if (quoteIn <= BigInt(0)) throw new HttpError(400, "Amount must be above 0.");
  const acct = evmAccount(wallet || l.dev || null);
  const pub = rhPublic();
  const curve = l.curve as `0x${string}`;
  const [[q, t], feeBps, graduated] = await Promise.all([
    pub.readContract({ address: curve, abi: CURVE_ABI, functionName: "getReserves" }),
    pub.readContract({ address: curve, abi: CURVE_ABI, functionName: "feeBps" }),
    pub.readContract({ address: curve, abi: CURVE_ABI, functionName: "graduated" }),
  ]);
  if (graduated) throw new HttpError(400, "This token graduated: trade it on Pons.");
  const net = quoteIn - (quoteIn * feeBps) / BigInt(10_000);
  const expected = (t * net) / (q + net);
  const minOut = (expected * (BigInt(10_000) - SLIPPAGE_BPS)) / BigInt(10_000);
  const sim = await pub.simulateContract({ account: acct, address: curve, abi: CURVE_ABI, functionName: "buy", args: [quoteIn, minOut, acct.address], value: quoteIn }).catch((e) => {
    throw new HttpError(400, `Buy simulation failed: ${e instanceof Error ? e.message.split("\n")[0] : e}. Nothing was sent.`);
  });
  const gas = await pub.estimateContractGas({ account: acct, address: curve, abi: CURVE_ABI, functionName: "buy", args: sim.request.args, value: quoteIn });
  await needBalance(acct.address, quoteIn, gas, "this buy");
  const hash = await rhWallet(acct).writeContract({ ...sim.request, gas: (gas * BigInt(13)) / BigInt(10) });
  const r = await receiptOf(hash);
  const ev = parseEventLogs({ abi: CURVE_ABI, eventName: "CurveBuy", logs: r.logs })[0];
  l.spentWei = (BigInt(l.spentWei) + quoteIn).toString();
  saveLaunches();
  logActivity(store(), { kind: "trade", ok: true, message: `Robinhood buy ${l.symbol}: ${ethStr(quoteIn)} ETH.`, data: { chain: "robinhood", tx: hash } });
  return { hash, tokensOut: (ev?.args.tokensOut ?? sim.result).toString() };
}

export async function rhSell(token: string, percent: number, fromWallet?: string | null): Promise<{ hash: string; ethOut: string }> {
  requireUnlocked();
  const l = findLaunch(token);
  const pct = Math.round(Number(percent));
  if (!(pct >= 1 && pct <= 100)) throw new HttpError(400, "Percent: 1–100.");
  const acct = evmAccount(fromWallet || l.dev || null);
  const pub = rhPublic();
  const tok = l.token as `0x${string}`;
  const curve = l.curve as `0x${string}`;
  const [bal, graduated, allowance] = await Promise.all([
    pub.readContract({ address: tok, abi: ERC20_ABI, functionName: "balanceOf", args: [acct.address] }),
    pub.readContract({ address: curve, abi: CURVE_ABI, functionName: "graduated" }),
    pub.readContract({ address: tok, abi: ERC20_ABI, functionName: "allowance", args: [acct.address, curve] }),
  ]);
  if (graduated) throw new HttpError(400, "This token graduated: sell it on Pons.");
  const amount = pct === 100 ? bal : (bal * BigInt(pct)) / BigInt(100);
  if (amount <= BigInt(0)) throw new HttpError(400, "No tokens to sell.");
  const wallet = rhWallet(acct);
  if (allowance < amount) {
    const max = BigInt(2) ** BigInt(256) - BigInt(1);
    const gasA = await pub.estimateContractGas({ account: acct, address: tok, abi: ERC20_ABI, functionName: "approve", args: [curve, max] });
    await needBalance(acct.address, BigInt(0), gasA * BigInt(3), "the approve + sell");
    const h = await wallet.writeContract({ account: acct, chain: wallet.chain, address: tok, abi: ERC20_ABI, functionName: "approve", args: [curve, max], gas: (gasA * BigInt(13)) / BigInt(10) });
    await receiptOf(h);
  }
  const [[q, t], feeBps] = await Promise.all([pub.readContract({ address: curve, abi: CURVE_ABI, functionName: "getReserves" }), pub.readContract({ address: curve, abi: CURVE_ABI, functionName: "feeBps" })]);
  const gross = (q * amount) / (t + amount);
  const expected = gross - (gross * feeBps) / BigInt(10_000);
  const minOut = (expected * (BigInt(10_000) - SLIPPAGE_BPS)) / BigInt(10_000);
  const sim = await pub.simulateContract({ account: acct, address: curve, abi: CURVE_ABI, functionName: "sell", args: [amount, minOut, acct.address] }).catch((e) => {
    throw new HttpError(400, `Sell simulation failed: ${e instanceof Error ? e.message.split("\n")[0] : e}. Nothing was sent.`);
  });
  const gas = await pub.estimateContractGas({ account: acct, address: curve, abi: CURVE_ABI, functionName: "sell", args: sim.request.args });
  await needBalance(acct.address, BigInt(0), gas, "this sell");
  const hash = await wallet.writeContract({ ...sim.request, gas: (gas * BigInt(13)) / BigInt(10) });
  const r = await receiptOf(hash);
  const ev = parseEventLogs({ abi: CURVE_ABI, eventName: "CurveSell", logs: r.logs })[0];
  const out = ev?.args.quoteOut ?? sim.result;
  l.receivedWei = (BigInt(l.receivedWei) + out).toString();
  saveLaunches();
  logActivity(store(), { kind: "trade", ok: true, message: `Robinhood sell ${l.symbol}: ${pct} % → ${ethStr(out)} ETH.`, data: { chain: "robinhood", tx: hash } });
  return { hash, ethOut: out.toString() };
}

export async function rhClaim(wallet?: string | null): Promise<{ hash: string; amountWei: string }> {
  requireUnlocked();
  const acct = evmAccount(wallet || null);
  const pub = rhPublic();
  const pending = await pub.readContract({ address: PONS.feeEscrow, abi: ESCROW_ABI, functionName: "balanceOf", args: [acct.address] });
  if (pending <= BigInt(0)) throw new HttpError(400, "No creator fees in the Pons escrow yet (Pons sweeps them from the curves from time to time).");
  const sim = await pub.simulateContract({ account: acct, address: PONS.feeEscrow, abi: ESCROW_ABI, functionName: "claim" });
  const gas = await pub.estimateContractGas({ account: acct, address: PONS.feeEscrow, abi: ESCROW_ABI, functionName: "claim" });
  await needBalance(acct.address, BigInt(0), gas, "the claim");
  const hash = await rhWallet(acct).writeContract({ ...sim.request, gas: (gas * BigInt(13)) / BigInt(10) });
  await receiptOf(hash);
  logActivity(store(), { kind: "claim", ok: true, message: `Robinhood creator fees claimed: ${ethStr(pending)} ETH.`, data: { chain: "robinhood", tx: hash } });
  return { hash, amountWei: pending.toString() };
}

/** send ETH from the Robinhood wallet ("max" = everything minus the gas) */
export async function rhWithdraw(to: string, amount: string, from?: string | null): Promise<{ hash: string; valueWei: string }> {
  requireUnlocked();
  if (!isAddress(to)) throw new HttpError(400, "Destination: an 0x address.");
  const acct = evmAccount(from || null);
  if (acct.address.toLowerCase() === to.toLowerCase()) throw new HttpError(400, "Same wallet on both sides.");
  const pub = rhPublic();
  const bal = await pub.getBalance({ address: acct.address });
  const gas = BigInt(21_000);
  const fees = await pub.estimateFeesPerGas();
  const maxFee = (fees.maxFeePerGas ?? BigInt(0)) * BigInt(2);
  let value: bigint;
  if (String(amount).trim().toLowerCase() === "max") value = bal - gas * maxFee;
  else {
    try {
      value = parseEther(String(amount).replace(",", ".").trim());
    } catch {
      throw new HttpError(400, "Amount: ETH or 'max'.");
    }
  }
  if (value <= BigInt(0)) throw new HttpError(400, "Nothing to send.");
  if (bal < value + gas * maxFee) throw new HttpError(400, `The Robinhood wallet holds ${ethStr(bal)} ETH. Nothing was sent.`);
  const hash = await rhWallet(acct).sendTransaction({ account: acct, chain: rhWallet(acct).chain, to: getAddress(to), value, gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: BigInt(0) });
  await receiptOf(hash);
  logActivity(store(), { kind: "fund", ok: true, message: `Robinhood send: ${ethStr(value)} ETH ${acct.address.slice(0, 8)}… → ${to.slice(0, 8)}….`, data: { chain: "robinhood", tx: hash } });
  return { hash, valueWei: value.toString() };
}

/* ------------------------------------------------------------------ status */

export type RhPosition = RhLaunch & {
  dev: string;
  balance: string;
  priceEth: number | null;
  mcapEth: number | null;
  valueEth: number | null;
  progress: number | null;
  graduated: boolean | null;
  pnlEth: number | null;
};

export async function rhPositions(mainAddr: `0x${string}`): Promise<RhPosition[]> {
  const list = launches();
  if (!list.length) return [];
  const pub = rhPublic();
  const calls = list.flatMap((l) => [
    { address: l.token as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf", args: [(l.dev ?? mainAddr) as `0x${string}`] },
    { address: l.curve as `0x${string}`, abi: CURVE_ABI, functionName: "getReserves" },
    { address: l.curve as `0x${string}`, abi: CURVE_ABI, functionName: "graduated" },
    { address: l.curve as `0x${string}`, abi: CURVE_ABI, functionName: "realQuoteReserve" },
    { address: l.curve as `0x${string}`, abi: CURVE_ABI, functionName: "graduationThreshold" },
  ]);
  const res = (await pub.multicall({ contracts: calls as never, allowFailure: true })) as { status: "success" | "failure"; result?: unknown }[];
  return list.map((l, i) => {
    const r = res.slice(i * 5, i * 5 + 5).map((x) => (x.status === "success" ? x.result : null));
    const bal = (r[0] as bigint | null) ?? BigInt(0);
    const reserves = r[1] as readonly [bigint, bigint] | null;
    const price = reserves && reserves[1] > BigInt(0) ? Number(formatEther(reserves[0])) / Number(formatEther(reserves[1])) : null;
    const value = price !== null ? Number(formatEther(bal)) * price : null;
    const real = r[3] as bigint | null;
    const thr = r[4] as bigint | null;
    return {
      ...l,
      dev: l.dev ?? mainAddr,
      balance: bal.toString(),
      priceEth: price,
      mcapEth: price !== null ? price * 1e9 : null,
      valueEth: value,
      progress: real !== null && thr ? Math.min(1, Number(real) / Number(thr)) : null,
      graduated: (r[2] as boolean | null) ?? null,
      pnlEth: value !== null ? value + Number(formatEther(BigInt(l.receivedWei))) - Number(formatEther(BigInt(l.spentWei))) : null,
    };
  });
}

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const GET_ETH_BALANCE_ABI = [{ type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "addr", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

export type RhWalletView = EvmWallet & { balanceWei: string | null; escrowWei: string | null; launches: number };

/** every Robinhood wallet with its ETH and its creator fees waiting in the Pons escrow (one multicall) */
export async function rhWallets(): Promise<RhWalletView[]> {
  const list = evmWallets();
  const calls = list.flatMap((w) => [
    { address: MULTICALL3, abi: GET_ETH_BALANCE_ABI, functionName: "getEthBalance", args: [w.address] },
    { address: PONS.feeEscrow, abi: ESCROW_ABI, functionName: "balanceOf", args: [w.address] },
  ]);
  const res = (await rhPublic()
    .multicall({ contracts: calls as never, allowFailure: true })
    .catch(() => [])) as { status: "success" | "failure"; result?: unknown }[];
  const main = list.find((w) => w.main)?.address.toLowerCase();
  return list.map((w, i) => {
    const b = res[i * 2];
    const e = res[i * 2 + 1];
    return {
      ...w,
      balanceWei: b?.status === "success" ? String(b.result) : null,
      escrowWei: e?.status === "success" ? String(e.result) : null,
      launches: launches().filter((l) => (l.dev ?? main)?.toLowerCase() === w.address.toLowerCase()).length,
    };
  });
}

export async function rhStatus() {
  requireUnlocked();
  const acct = evmAccount();
  const [wallets, usd, positions] = await Promise.all([rhWallets(), ethUsd(), rhPositions(acct.address).catch(() => [] as RhPosition[])]);
  const main = wallets.find((w) => w.main);
  const sum = (k: "balanceWei" | "escrowWei") => wallets.reduce((t, w) => t + BigInt(w[k] ?? "0"), BigInt(0)).toString();
  return { address: acct.address, balanceWei: main?.balanceWei ?? "0", escrowWei: main?.escrowWei ?? null, totalWei: sum("balanceWei"), totalEscrowWei: sum("escrowWei"), ethUsd: usd, wallets, positions };
}
