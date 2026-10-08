/* Pons V2 (Robinhood Chain) records and wallet-level actions:
 *  · launches.json — every launch made from DONCHAIN (dev, bundle wallets, block, tx);
 *  · claim: Pons sweeps creator fees to the escrow, claim() pays them to the dev wallet;
 *  · withdraw / disperse / consolidate: plain ETH transfers between wallets (one nonce sequence per source);
 *  · status: every Robinhood wallet with its ETH and its creator fees waiting, the groups.
 * The launch (with its bundle) lives in launch.ts, the market (curve, trades, buys, sells) in market.ts. */
import { join } from "node:path";
import { formatEther, getAddress, isAddress, parseEther, type Hash, type Hex } from "viem";
import { HttpError } from "../api";
import { requireUnlocked } from "../engine";
import { logActivity, readJson, store, writeJson } from "../store";
import { ESCROW_ABI, PONS, ethUsd, rhPublic, rhWallet } from "./chain";
import { feeCaps, sendRaw } from "./send";
import { evmAccount, evmGroups, evmIsOwn, evmWallets, rhDir, type EvmWallet } from "./wallet";

export type RhBundleBuy = {
  address: string;
  ethWei: string;
  hash: string | null;
  /** sent = accepted by the sequencer, landed = mined with its CurveBuy, failed / withheld = nothing bought */
  status: "sent" | "landed" | "failed" | "withheld";
  tokens: string | null;
  error: string | null;
  /** ms after the launch was sent */
  sentMs: number | null;
};

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
  /** tokens of the dev buy (the launchAndBuy transaction emits no CurveBuy of its own) */
  devTokens?: string;
  blockNumber?: string;
  bundle?: RhBundleBuy[];
  creatorTaxBps?: number;
  /** kept for the records made before the market view (spent/received are now read from the curve's events) */
  spentWei: string;
  receivedWei: string;
};

const launchesPath = () => join(rhDir(), "launches.json");
export function rhLaunches(): RhLaunch[] {
  const rt = store().runtime as { rhLaunches?: RhLaunch[] };
  if (!rt.rhLaunches) rt.rhLaunches = readJson<RhLaunch[]>(launchesPath(), []);
  return rt.rhLaunches;
}
export function saveRhLaunches(): void {
  writeJson(launchesPath(), rhLaunches());
}
export function rhLaunchOf(token: string): RhLaunch | null {
  return rhLaunches().find((x) => x.token.toLowerCase() === token.toLowerCase()) ?? null;
}

export const ethStr = (wei: bigint, dp = 6) => Number(formatEther(wei)).toFixed(dp);

export async function receiptOf(hash: Hash, timeout = 120_000) {
  const r = await rhPublic().waitForTransactionReceipt({ hash, timeout, pollingInterval: 250 });
  if (r.status !== "success") throw new HttpError(502, `Transaction reverted: ${hash}`);
  return r;
}

/* ------------------------------------------------------------------ creator fees */

export async function rhClaim(wallet?: string | null): Promise<{ hash: string; amountWei: string }> {
  requireUnlocked();
  const acct = evmAccount(wallet || null);
  const pub = rhPublic();
  const pending = await pub.readContract({ address: PONS.feeEscrow, abi: ESCROW_ABI, functionName: "balanceOf", args: [acct.address] });
  if (pending <= BigInt(0)) throw new HttpError(400, "No creator fees in the Pons escrow yet (Pons sweeps them from the curves from time to time).");
  const sim = await pub.simulateContract({ account: acct, address: PONS.feeEscrow, abi: ESCROW_ABI, functionName: "claim" });
  const gas = await pub.estimateContractGas({ account: acct, address: PONS.feeEscrow, abi: ESCROW_ABI, functionName: "claim" });
  const hash = await rhWallet(acct).writeContract({ ...sim.request, gas: (gas * BigInt(13)) / BigInt(10) });
  await receiptOf(hash);
  logActivity(store(), { kind: "claim", ok: true, message: `Robinhood creator fees claimed: ${ethStr(pending)} ETH.`, wallets: [acct.address], data: { chain: "robinhood", tx: hash } });
  return { hash, amountWei: pending.toString() };
}

/* ------------------------------------------------------------------ ETH transfers */

const TRANSFER_GAS = BigInt(21_000);

function amountWei(v: unknown): bigint | "max" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "max") return "max";
  try {
    const w = parseEther(s.replace(",", "."));
    if (w > BigInt(0)) return w;
  } catch {
    /* below */
  }
  throw new HttpError(400, `Amount "${String(v)}": ETH or "max".`);
}

/** send ETH from a Robinhood wallet ("max" = everything minus the gas) */
export async function rhWithdraw(to: string, amount: string, from?: string | null): Promise<{ hash: string; valueWei: string }> {
  requireUnlocked();
  if (!isAddress(to)) throw new HttpError(400, "Destination: an 0x address.");
  const acct = evmAccount(from || null);
  if (acct.address.toLowerCase() === to.toLowerCase()) throw new HttpError(400, "Same wallet on both sides.");
  const pub = rhPublic();
  const [bal, fees, nonce] = await Promise.all([pub.getBalance({ address: acct.address }), feeCaps(), pub.getTransactionCount({ address: acct.address, blockTag: "pending" })]);
  const gasCost = TRANSFER_GAS * fees.maxFeePerGas;
  const a = amountWei(amount);
  const value = a === "max" ? bal - gasCost : a;
  if (value <= BigInt(0)) throw new HttpError(400, "Nothing to send.");
  if (bal < value + gasCost) throw new HttpError(400, `The wallet holds ${ethStr(bal)} ETH. Nothing was sent.`);
  const tx = await acct.signTransaction({ chainId: 4663, type: "eip1559", to: getAddress(to), value, nonce, gas: TRANSFER_GAS, ...fees });
  const hash = await sendRaw(tx);
  await receiptOf(hash);
  logActivity(store(), { kind: "fund", ok: true, message: `Robinhood send: ${ethStr(value)} ETH ${acct.address.slice(0, 8)}… → ${to.slice(0, 8)}….`, wallets: [acct.address], data: { chain: "robinhood", tx: hash } });
  return { hash, valueWei: value.toString() };
}

export type TransferResult = { from: string; to: string; valueWei: string; hash: string | null; ok: boolean; error: string | null };

/** one wallet → many: one nonce sequence signed up front, sent in order, then confirmed together */
export async function rhDisperse(from: string, plan: { to: string; eth: string }[]): Promise<TransferResult[]> {
  requireUnlocked();
  if (!plan.length) throw new HttpError(400, "No destination.");
  if (plan.length > 100) throw new HttpError(400, "100 destinations maximum.");
  const acct = evmAccount(from);
  const legs = plan.map((p) => {
    if (!isAddress(p.to)) throw new HttpError(400, `Destination ${p.to}: an 0x address.`);
    if (p.to.toLowerCase() === acct.address.toLowerCase()) throw new HttpError(400, "The source cannot also be a destination.");
    const w = amountWei(p.eth);
    if (w === "max") throw new HttpError(400, "Disperse: an ETH amount per wallet.");
    return { to: getAddress(p.to), value: w };
  });
  const pub = rhPublic();
  const [bal, fees, nonce0] = await Promise.all([pub.getBalance({ address: acct.address }), feeCaps(), pub.getTransactionCount({ address: acct.address, blockTag: "pending" })]);
  const total = legs.reduce((t, l) => t + l.value, BigInt(0));
  const gas = TRANSFER_GAS * fees.maxFeePerGas * BigInt(legs.length);
  if (bal < total + gas) throw new HttpError(400, `The source holds ${ethStr(bal)} ETH: this disperse needs ${ethStr(total + gas)} ETH (${ethStr(total)} + gas). Nothing was sent.`);
  const signed = await Promise.all(legs.map((l, i) => acct.signTransaction({ chainId: 4663, type: "eip1559", to: l.to, value: l.value, nonce: nonce0 + i, gas: TRANSFER_GAS, ...fees })));
  const out: TransferResult[] = [];
  // in nonce order: a refused leg stops the ones after it (they could never be mined)
  let broken: string | null = null;
  for (const [i, tx] of signed.entries()) {
    const l = legs[i];
    if (broken) {
      out.push({ from: acct.address, to: l.to, valueWei: l.value.toString(), hash: null, ok: false, error: `not sent (${broken})` });
      continue;
    }
    try {
      out.push({ from: acct.address, to: l.to, valueWei: l.value.toString(), hash: await sendRaw(tx), ok: true, error: null });
    } catch (e) {
      broken = e instanceof Error ? e.message : String(e);
      out.push({ from: acct.address, to: l.to, valueWei: l.value.toString(), hash: null, ok: false, error: broken });
    }
  }
  await Promise.all(
    out.map(async (r) => {
      if (!r.hash) return;
      try {
        await receiptOf(r.hash as Hash, 60_000);
      } catch (e) {
        r.ok = false;
        r.error = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  const ok = out.filter((r) => r.ok);
  logActivity(store(), {
    kind: "fund",
    ok: ok.length === out.length,
    message: `Robinhood disperse: ${ethStr(ok.reduce((t, r) => t + BigInt(r.valueWei), BigInt(0)))} ETH from ${acct.address.slice(0, 8)}… to ${ok.length}/${out.length} wallet(s).`,
    wallets: [acct.address],
    data: { chain: "robinhood" },
  });
  return out;
}

/** many wallets → one: each source sends its own transfer, all in parallel ("max" = all minus the gas, or a %) */
export async function rhConsolidate(sources: string[], to: string, pct = 100): Promise<TransferResult[]> {
  requireUnlocked();
  if (!isAddress(to)) throw new HttpError(400, "Destination: an 0x address.");
  if (!sources.length) throw new HttpError(400, "No source wallet.");
  const p = Math.round(Number(pct));
  if (!(p >= 1 && p <= 100)) throw new HttpError(400, "Percent: 1–100.");
  const pub = rhPublic();
  const fees = await feeCaps();
  const gasCost = TRANSFER_GAS * fees.maxFeePerGas;
  const out = await Promise.all(
    [...new Set(sources.map((s) => s.toLowerCase()))].map(async (s): Promise<TransferResult> => {
      const acct = evmAccount(s);
      if (acct.address.toLowerCase() === to.toLowerCase()) return { from: acct.address, to, valueWei: "0", hash: null, ok: false, error: "is the destination" };
      try {
        const [bal, nonce] = await Promise.all([pub.getBalance({ address: acct.address }), pub.getTransactionCount({ address: acct.address, blockTag: "pending" })]);
        const spendable = bal - gasCost;
        const value = p === 100 ? spendable : (bal * BigInt(p)) / BigInt(100);
        if (value <= BigInt(0) || value > spendable) return { from: acct.address, to, valueWei: "0", hash: null, ok: false, error: `holds ${ethStr(bal)} ETH — not enough for the gas` };
        const tx = await acct.signTransaction({ chainId: 4663, type: "eip1559", to: getAddress(to), value, nonce, gas: TRANSFER_GAS, ...fees });
        const hash = await sendRaw(tx);
        await receiptOf(hash, 60_000);
        return { from: acct.address, to, valueWei: value.toString(), hash, ok: true, error: null };
      } catch (e) {
        return { from: acct.address, to, valueWei: "0", hash: null, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const ok = out.filter((r) => r.ok);
  logActivity(store(), {
    kind: "fund",
    ok: ok.length === out.length,
    message: `Robinhood consolidate: ${ethStr(ok.reduce((t, r) => t + BigInt(r.valueWei), BigInt(0)))} ETH from ${ok.length}/${out.length} wallet(s) → ${to.slice(0, 8)}….`,
    wallets: ok.map((r) => r.from),
    data: { chain: "robinhood" },
  });
  return out;
}

/* ------------------------------------------------------------------ status */

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
      launches: rhLaunches().filter((l) => (l.dev ?? main)?.toLowerCase() === w.address.toLowerCase()).length,
    };
  });
}

export async function rhStatus() {
  requireUnlocked();
  const acct = evmAccount();
  const [wallets, usd] = await Promise.all([rhWallets(), ethUsd()]);
  const main = wallets.find((w) => w.main);
  const sum = (k: "balanceWei" | "escrowWei") => wallets.reduce((t, w) => t + BigInt(w[k] ?? "0"), BigInt(0)).toString();
  return { address: acct.address, balanceWei: main?.balanceWei ?? "0", escrowWei: main?.escrowWei ?? null, totalWei: sum("balanceWei"), totalEscrowWei: sum("escrowWei"), ethUsd: usd, wallets, groups: evmGroups() };
}

export function requireOwn(address: string): string {
  if (!isAddress(address) || !evmIsOwn(address)) throw new HttpError(400, `${address.slice(0, 10)}… is not one of your Robinhood wallets.`);
  return getAddress(address);
}

export type { Hex };
