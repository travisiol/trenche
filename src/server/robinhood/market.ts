/* The market of a Pons V2 token, read from the chain only:
 *  · curve state (reserves, progress, graduation) in one multicall;
 *  · every trade = the curve's CurveBuy / CurveSell events, read incrementally from the launch block (publicnode serves
 *    the real head) and cached in memory; the dev buy of a launchAndBuy emits no CurveBuy of its own, it comes from the
 *    launch record;
 *  · your wallets: ETH, tokens, ETH in / out on this token → PnL = sells − buys + value held (at the curve's spot);
 *  · buys and sells from several wallets at once, each in its own transaction, all fired together: min-out assumes
 *    the other wallets of the same click land first (else the last ones revert), minus the slippage of Settings. */
import { encodeFunctionData, formatEther, getAddress, isAddress, maxUint256, parseEther, parseEventLogs, type Hash } from "viem";
import { HttpError } from "../api";
import { requireUnlocked } from "../engine";
import { logActivity, store } from "../store";
import { CURVE_ABI, ERC20_ABI, FACTORY_ABI, PONS, PONS_TOKEN_ABI, ethUsd, logoUrl, rhLogs, rhPublic } from "./chain";
import { buyOut } from "./launch";
import { ethStr, receiptOf, rhLaunchOf, rhLaunches, type RhLaunch } from "./pons";
import { feeCaps, sendRaw } from "./send";
import { rhSettings } from "./settings";
import { evmAccount, evmWallets } from "./wallet";

const BPS = BigInt(10_000);
const ZERO_BI = BigInt(0);
/** getLogs span the public nodes accept */
const SPAN = BigInt(400_000);

export type RhTrade = { tx: string; block: number; li: number; ts: number; side: "buy" | "sell"; wallet: string; eth: string; tokens: string };

type Cache = { curve: `0x${string}`; startBlock: bigint; toBlock: bigint; trades: RhTrade[]; blockTs: Map<number, number>; busy: Promise<void> | null; at: number };
const caches = (): Map<string, Cache> => {
  const rt = store().runtime as { rhTrades?: Map<string, Cache> };
  if (!rt.rhTrades) rt.rhTrades = new Map();
  return rt.rhTrades;
};

/* ------------------------------------------------------------------ token identity */

export type RhTokenMeta = { token: string; curve: string; name: string; symbol: string; logo: string | null; image: string | null; description: string; socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string }; deployer: string | null };

export async function rhTokenMeta(token: string): Promise<RhTokenMeta> {
  if (!isAddress(token)) throw new HttpError(400, "token: an 0x address.");
  const address = getAddress(token);
  const res = (await rhPublic().multicall({
    contracts: (["name", "symbol", "curve", "logo", "description", "socials", "deployer"] as const).map((fn) => ({ address, abi: PONS_TOKEN_ABI, functionName: fn })) as never,
    allowFailure: true,
  })) as { status: "success" | "failure"; result?: unknown }[];
  const v = <T>(i: number) => (res[i]?.status === "success" ? (res[i].result as T) : null);
  const curve = v<string>(2);
  if (!curve || !v<string>(1)) throw new HttpError(404, `${short(address)} is not a Pons V2 token (no curve() on it).`);
  const s = v<readonly [string, string, string, string, string]>(5);
  const logo = v<string>(3);
  return {
    token: address,
    curve: getAddress(curve),
    name: v<string>(0) ?? "",
    symbol: v<string>(1) ?? "",
    logo,
    image: logoUrl(logo),
    description: v<string>(4) ?? "",
    socials: { twitter: s?.[0] ?? "", telegram: s?.[1] ?? "", discord: s?.[2] ?? "", website: s?.[3] ?? "", farcaster: s?.[4] ?? "" },
    deployer: v<string>(6),
  };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** the block a token was launched in: our record, else its TokenLaunched event (searched back in 400k-block spans) */
async function launchBlock(token: string, rec: RhLaunch | null): Promise<bigint> {
  if (rec?.blockNumber) return BigInt(rec.blockNumber);
  if (rec?.txHash) {
    const r = await rhPublic().getTransactionReceipt({ hash: rec.txHash as Hash }).catch(() => null);
    if (r) {
      rec.blockNumber = r.blockNumber.toString();
      return r.blockNumber;
    }
  }
  const logs = rhLogs();
  const head = await logs.getBlockNumber();
  for (let i = 0; i < 40; i++) {
    const to = head - SPAN * BigInt(i);
    const from = to > SPAN ? to - SPAN + BigInt(1) : BigInt(0);
    const hit = await logs.getLogs({ address: PONS.factory, event: FACTORY_ABI.find((x) => x.type === "event")!, args: { token: getAddress(token) }, fromBlock: from, toBlock: to }).catch(() => []);
    if (hit.length) return hit[0].blockNumber!;
    if (from === BigInt(0)) break;
  }
  throw new HttpError(404, "Launch block of this token not found.");
}

/** read the curve's new events since the last call (one call at a time per token) */
async function refreshTrades(token: string, rec: RhLaunch | null, curve: `0x${string}`): Promise<Cache> {
  const key = token.toLowerCase();
  let c = caches().get(key);
  if (!c) {
    const start = await launchBlock(token, rec);
    c = { curve, startBlock: start, toBlock: start - BigInt(1), trades: [], blockTs: new Map(), busy: null, at: 0 };
    caches().set(key, c);
  }
  if (c.busy) {
    await c.busy;
    return c;
  }
  if (Date.now() - c.at < 700) return c;
  const cache = c;
  cache.busy = (async () => {
    const logs = rhLogs();
    const head = await logs.getBlockNumber();
    const fresh: RhTrade[] = [];
    let from = cache.toBlock + BigInt(1);
    while (from <= head) {
      const to = from + SPAN - BigInt(1) < head ? from + SPAN - BigInt(1) : head;
      const raw = await logs.getLogs({ address: cache.curve, events: CURVE_ABI.filter((x) => x.type === "event"), fromBlock: from, toBlock: to });
      for (const l of parseEventLogs({ abi: CURVE_ABI, logs: raw })) {
        if (l.eventName === "CurveBuy") fresh.push({ tx: l.transactionHash!, block: Number(l.blockNumber), li: l.logIndex!, ts: 0, side: "buy", wallet: getAddress(l.args.recipient), eth: l.args.quoteIn.toString(), tokens: l.args.tokensOut.toString() });
        else if (l.eventName === "CurveSell") fresh.push({ tx: l.transactionHash!, block: Number(l.blockNumber), li: l.logIndex!, ts: 0, side: "sell", wallet: getAddress(l.args.seller), eth: l.args.quoteOut.toString(), tokens: l.args.tokensIn.toString() });
      }
      from = to + BigInt(1);
    }
    // the dev buy inside launchAndBuy: no CurveBuy of its own
    if (rec && cache.trades.length === 0 && BigInt(rec.devTokens ?? "0") > ZERO_BI && !fresh.some((t) => t.tx.toLowerCase() === rec.txHash.toLowerCase() && t.side === "buy")) {
      fresh.unshift({ tx: rec.txHash, block: Number(cache.startBlock), li: -1, ts: 0, side: "buy", wallet: getAddress(rec.dev!), eth: rec.devBuyWei, tokens: rec.devTokens! });
    }
    await stamp(cache, fresh);
    cache.trades.push(...fresh);
    cache.trades.sort((a, b) => a.block - b.block || a.li - b.li);
    cache.toBlock = head;
    cache.at = Date.now();
  })().finally(() => {
    cache.busy = null;
  });
  await cache.busy;
  return cache;
}

/** block timestamps: read for up to 60 blocks per refresh, interpolated in between (blocks only come with traffic) */
async function stamp(c: Cache, trades: RhTrade[]): Promise<void> {
  const want = [...new Set(trades.map((t) => t.block))].filter((b) => !c.blockTs.has(b)).sort((a, b) => a - b);
  if (!want.length) return;
  const pick = want.length <= 60 ? want : Array.from({ length: 60 }, (_, i) => want[Math.round((i * (want.length - 1)) / 59)]);
  const pub = rhLogs();
  for (let i = 0; i < pick.length; i += 8) {
    await Promise.all(
      pick.slice(i, i + 8).map(async (b) => {
        const blk = await pub.getBlock({ blockNumber: BigInt(b) }).catch(() => null);
        if (blk) c.blockTs.set(b, Number(blk.timestamp) * 1000);
      }),
    );
  }
  const known = [...c.blockTs.entries()].sort((a, b) => a[0] - b[0]);
  const tsOf = (b: number) => {
    const hit = c.blockTs.get(b);
    if (hit !== undefined) return hit;
    let lo = known[0], hi = known[known.length - 1];
    for (const k of known) {
      if (k[0] <= b) lo = k;
      if (k[0] >= b) {
        hi = k;
        break;
      }
    }
    if (!lo || !hi) return Date.now();
    if (hi[0] === lo[0]) return lo[1];
    return Math.round(lo[1] + ((hi[1] - lo[1]) * (b - lo[0])) / (hi[0] - lo[0]));
  };
  for (const t of trades) t.ts = tsOf(t.block);
}

/* ------------------------------------------------------------------ view */

export type RhCurveState = { quoteReserve: string; tokenReserve: string; realQuote: string; threshold: string; graduated: boolean; feeBps: number; creatorTaxBps: number; priceEth: number | null; mcapEth: number | null; progress: number | null };

async function curveState(curve: `0x${string}`): Promise<RhCurveState> {
  const res = (await rhPublic().multicall({
    contracts: (["getReserves", "realQuoteReserve", "graduationThreshold", "graduated", "feeBps", "creatorTaxBps"] as const).map((fn) => ({ address: curve, abi: CURVE_ABI, functionName: fn })) as never,
    allowFailure: true,
  })) as { status: "success" | "failure"; result?: unknown }[];
  const v = <T>(i: number) => (res[i]?.status === "success" ? (res[i].result as T) : null);
  const r = v<readonly [bigint, bigint]>(0);
  const real = v<bigint>(1);
  const thr = v<bigint>(2);
  const price = r && r[1] > ZERO_BI ? Number(formatEther(r[0])) / Number(formatEther(r[1])) : null;
  return {
    quoteReserve: (r?.[0] ?? ZERO_BI).toString(),
    tokenReserve: (r?.[1] ?? ZERO_BI).toString(),
    realQuote: (real ?? ZERO_BI).toString(),
    threshold: (thr ?? ZERO_BI).toString(),
    graduated: v<boolean>(3) ?? false,
    feeBps: Number(v<bigint>(4) ?? BigInt(100)),
    creatorTaxBps: Number(v<bigint>(5) ?? ZERO_BI),
    priceEth: price,
    mcapEth: price !== null ? price * 1e9 : null,
    progress: real !== null && thr ? Math.min(1, Number(real) / Number(thr)) : null,
  };
}

export type RhHolder = { address: string; label: string; group: string | null; main: boolean; ethWei: string; tokensWei: string; boughtWei: string; soldWei: string; valueEth: number | null; pnlEth: number | null; dev: boolean; bundle: boolean };

export async function rhTokenView(token: string, opts: { trades?: number } = {}) {
  requireUnlocked();
  if (!isAddress(token)) throw new HttpError(400, "token: an 0x address.");
  const rec = rhLaunchOf(token);
  const meta = rec
    ? { token: getAddress(rec.token), curve: getAddress(rec.curve), name: rec.name, symbol: rec.symbol, logo: rec.logo, image: rec.image ?? logoUrl(rec.logo), description: "", socials: null, deployer: rec.dev ?? null }
    : await rhTokenMeta(token);
  const curve = meta.curve as `0x${string}`;
  const own = evmWallets();
  const [state, cache, usd, balances] = await Promise.all([
    curveState(curve),
    refreshTrades(meta.token, rec, curve),
    ethUsd(),
    rhPublic().multicall({
      contracts: own.flatMap((w) => [
        { address: meta.token as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf", args: [w.address] },
        { address: "0xcA11bde05977b3631167028862bE2a173976CA11", abi: [{ type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const, functionName: "getEthBalance", args: [w.address] },
      ]) as never,
      allowFailure: true,
    }) as Promise<{ status: "success" | "failure"; result?: unknown }[]>,
  ]);
  const flows = new Map<string, { in: bigint; out: bigint }>();
  for (const t of cache.trades) {
    const k = t.wallet.toLowerCase();
    const f = flows.get(k) ?? { in: ZERO_BI, out: ZERO_BI };
    if (t.side === "buy") f.in += BigInt(t.eth);
    else f.out += BigInt(t.eth);
    flows.set(k, f);
  }
  const bundleSet = new Set((rec?.bundle ?? []).map((b) => b.address.toLowerCase()));
  const devLc = (rec?.dev ?? "").toLowerCase();
  const holders: RhHolder[] = own
    .map((w, i) => {
      const tok = res(balances, i * 2) ?? ZERO_BI;
      const ethWei = res(balances, i * 2 + 1) ?? ZERO_BI;
      const f = flows.get(w.address.toLowerCase()) ?? { in: ZERO_BI, out: ZERO_BI };
      const value = state.priceEth !== null ? Number(formatEther(tok)) * state.priceEth : null;
      const traded = f.in > ZERO_BI || f.out > ZERO_BI;
      return {
        address: w.address,
        label: w.label,
        group: w.group,
        main: w.main,
        ethWei: ethWei.toString(),
        tokensWei: tok.toString(),
        boughtWei: f.in.toString(),
        soldWei: f.out.toString(),
        valueEth: value,
        pnlEth: traded && value !== null ? value + Number(formatEther(f.out)) - Number(formatEther(f.in)) : null,
        dev: w.address.toLowerCase() === devLc,
        bundle: bundleSet.has(w.address.toLowerCase()),
      };
    });
  const mine = holders.filter((h) => BigInt(h.boughtWei) > ZERO_BI || BigInt(h.soldWei) > ZERO_BI || BigInt(h.tokensWei) > ZERO_BI);
  const spent = mine.reduce((t, h) => t + BigInt(h.boughtWei), ZERO_BI);
  const received = mine.reduce((t, h) => t + BigInt(h.soldWei), ZERO_BI);
  const heldTokens = mine.reduce((t, h) => t + BigInt(h.tokensWei), ZERO_BI);
  const heldValue = state.priceEth !== null ? Number(formatEther(heldTokens)) * state.priceEth : null;
  const launchFee = rec ? 0.0005 : 0;
  const n = Math.max(50, Math.min(5000, opts.trades ?? 2000));
  return {
    ...meta,
    ours: !!rec,
    launch: rec ? { txHash: rec.txHash, at: rec.at, dev: rec.dev ?? null, devBuyWei: rec.devBuyWei, bundle: rec.bundle ?? [], blockNumber: rec.blockNumber ?? null, creatorTaxBps: rec.creatorTaxBps ?? 0 } : null,
    state,
    ethUsd: usd,
    head: Number(cache.toBlock),
    tradeCount: cache.trades.length,
    trades: cache.trades.slice(-n),
    holders,
    pnl: {
      spentWei: spent.toString(),
      receivedWei: received.toString(),
      heldTokens: heldTokens.toString(),
      heldValueEth: heldValue,
      launchFeeEth: launchFee,
      netEth: heldValue !== null ? heldValue + Number(formatEther(received)) - Number(formatEther(spent)) - launchFee : null,
    },
  };
}

const res = (r: { status: "success" | "failure"; result?: unknown }[], i: number) => (r[i]?.status === "success" ? (r[i].result as bigint) : null);

/* ------------------------------------------------------------------ trading */

export type RhTradeResult = { wallet: string; ok: boolean; hash: string | null; ethWei: string | null; tokensWei: string | null; error: string | null };

async function liveCurve(token: string) {
  const rec = rhLaunchOf(token);
  const curve = (rec ? getAddress(rec.curve) : (await rhTokenMeta(token)).curve) as `0x${string}`;
  const st = await curveState(curve);
  if (st.graduated) throw new HttpError(400, "This token graduated: it trades on Pons' pool now, not on the curve.");
  return { curve, st, rec };
}

/** every wallet buys `eth` in its own transaction, all sent together */
export async function rhBuyMany(token: string, wallets: string[], eth: string): Promise<RhTradeResult[]> {
  requireUnlocked();
  let quoteIn: bigint;
  try {
    quoteIn = parseEther(String(eth).replace(",", ".").trim());
  } catch {
    throw new HttpError(400, "Amount: ETH (e.g. 0.01).");
  }
  if (quoteIn <= ZERO_BI) throw new HttpError(400, "Amount must be above 0.");
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (!list.length) throw new HttpError(400, "Pick at least one wallet.");
  const { curve, st, rec } = await liveCurve(token);
  const pub = rhPublic();
  const fees = await feeCaps();
  const feeBps = BigInt(st.feeBps + st.creatorTaxBps);
  const slip = BigInt(Math.round(rhSettings().slippagePct * 100));
  const net = quoteIn - (quoteIn * feeBps) / BPS;
  const q0 = BigInt(st.quoteReserve);
  const t0 = BigInt(st.tokenReserve);
  // worst case for each: the n-1 others (same amount) land first
  const others = BigInt(list.length - 1);
  const qW = q0 + net * others;
  let tW = t0;
  for (let i = 0; i < list.length - 1; i++) tW -= buyOut(q0 + net * BigInt(i), tW, quoteIn, feeBps);
  const minOut = (buyOut(qW, tW, quoteIn, feeBps) * (BPS - slip)) / BPS;
  const gas = BigInt(260_000);
  const out = await Promise.all(
    list.map(async (w): Promise<RhTradeResult> => {
      try {
        const acct = evmAccount(w);
        const [bal, nonce] = await Promise.all([pub.getBalance({ address: acct.address }), pub.getTransactionCount({ address: acct.address, blockTag: "pending" })]);
        if (bal < quoteIn + gas * fees.maxFeePerGas) return { wallet: acct.address, ok: false, hash: null, ethWei: null, tokensWei: null, error: `holds ${ethStr(bal)} ETH` };
        const tx = await acct.signTransaction({ chainId: 4663, type: "eip1559", to: curve, value: quoteIn, nonce, gas, ...fees, data: encodeFunctionData({ abi: CURVE_ABI, functionName: "buy", args: [quoteIn, minOut, acct.address] }) });
        const hash = await sendRaw(tx);
        const r = await receiptOf(hash, 60_000);
        const ev = parseEventLogs({ abi: CURVE_ABI, eventName: "CurveBuy", logs: r.logs })[0];
        return { wallet: acct.address, ok: true, hash, ethWei: quoteIn.toString(), tokensWei: ev ? ev.args.tokensOut.toString() : null, error: null };
      } catch (e) {
        return { wallet: w, ok: false, hash: null, ethWei: null, tokensWei: null, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
      }
    }),
  );
  const ok = out.filter((r) => r.ok);
  logActivity(store(), { kind: "trade", ok: ok.length === out.length, message: `Robinhood buy ${rec?.symbol ?? short(token)}: ${ok.length}/${out.length} wallet(s) × ${ethStr(quoteIn)} ETH.`, wallets: ok.map((r) => r.wallet), data: { chain: "robinhood", side: "buy", mint: token } });
  return out;
}

/** every wallet sells `percent` % of what it holds — approve (if needed) and sell signed together, all wallets at once */
export async function rhSellMany(token: string, wallets: string[], percent: number): Promise<RhTradeResult[]> {
  requireUnlocked();
  const pct = Math.round(Number(percent));
  if (!(pct >= 1 && pct <= 100)) throw new HttpError(400, "Percent: 1–100.");
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (!list.length) throw new HttpError(400, "Pick at least one wallet.");
  const { curve, st, rec } = await liveCurve(token);
  const tok = getAddress(token);
  const pub = rhPublic();
  const fees = await feeCaps();
  const feeBps = BigInt(st.feeBps + st.creatorTaxBps);
  const slip = BigInt(Math.round(rhSettings().slippagePct * 100));
  const reads = (await pub.multicall({
    contracts: list.flatMap((w) => [
      { address: tok, abi: ERC20_ABI, functionName: "balanceOf", args: [w] },
      { address: tok, abi: ERC20_ABI, functionName: "allowance", args: [w, curve] },
    ]) as never,
    allowFailure: true,
  })) as { status: "success" | "failure"; result?: unknown }[];
  const legs = list.map((w, i) => {
    const bal = res(reads, i * 2) ?? ZERO_BI;
    return { w, amount: pct === 100 ? bal : (bal * BigInt(pct)) / BigInt(100), allowance: res(reads, i * 2 + 1) ?? ZERO_BI };
  });
  const selling = legs.filter((l) => l.amount > ZERO_BI);
  if (!selling.length) throw new HttpError(400, "None of these wallets holds this token.");
  // worst case for each: every other sell of this click lands first (the price only goes down)
  const q = BigInt(st.quoteReserve);
  const t = BigInt(st.tokenReserve);
  const total = selling.reduce((s, l) => s + l.amount, ZERO_BI);
  const sellOut = (qq: bigint, tt: bigint, amt: bigint) => {
    const g = (qq * amt) / (tt + amt);
    return g - (g * feeBps) / BPS;
  };
  const out = await Promise.all(
    legs.map(async (l): Promise<RhTradeResult> => {
      if (l.amount <= ZERO_BI) return { wallet: getAddress(l.w), ok: false, hash: null, ethWei: null, tokensWei: null, error: "holds none" };
      try {
        const others = total - l.amount;
        const qq = q - (q * others) / (t + others);
        const tt = t + others;
        const minOut = (sellOut(qq, tt, l.amount) * (BPS - slip)) / BPS;
        const acct = evmAccount(l.w);
        let nonce = await pub.getTransactionCount({ address: acct.address, blockTag: "pending" });
        if (l.allowance < l.amount) {
          const ap = await acct.signTransaction({ chainId: 4663, type: "eip1559", to: tok, nonce, gas: BigInt(120_000), ...fees, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [curve, maxUint256] }) });
          await sendRaw(ap);
          nonce += 1;
        }
        const tx = await acct.signTransaction({ chainId: 4663, type: "eip1559", to: curve, nonce, gas: BigInt(260_000), ...fees, data: encodeFunctionData({ abi: CURVE_ABI, functionName: "sell", args: [l.amount, minOut, acct.address] }) });
        const hash = await sendRaw(tx);
        const r = await receiptOf(hash, 60_000);
        const ev = parseEventLogs({ abi: CURVE_ABI, eventName: "CurveSell", logs: r.logs })[0];
        return { wallet: acct.address, ok: true, hash, ethWei: ev ? ev.args.quoteOut.toString() : null, tokensWei: l.amount.toString(), error: null };
      } catch (e) {
        return { wallet: getAddress(l.w), ok: false, hash: null, ethWei: null, tokensWei: null, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
      }
    }),
  );
  const ok = out.filter((r) => r.ok);
  const got = ok.reduce((s, r) => s + BigInt(r.ethWei ?? "0"), ZERO_BI);
  logActivity(store(), { kind: "trade", ok: ok.length === selling.length, message: `Robinhood sell ${rec?.symbol ?? short(token)}: ${pct} % from ${ok.length}/${selling.length} wallet(s) → ${ethStr(got)} ETH.`, wallets: ok.map((r) => r.wallet), data: { chain: "robinhood", side: "sell", mint: token } });
  return out;
}

/* ------------------------------------------------------------------ dashboard */

export type RhLaunchRow = { token: string; name: string; symbol: string; image: string | null; at: number; dev: string | null; bundle: number; mcapEth: number | null; progress: number | null; graduated: boolean; netEth: number | null; spentEth: number | null; heldValueEth: number | null };

/** every launch with its market cap and its PnL (all your wallets on it) */
export async function rhLaunchRows(): Promise<RhLaunchRow[]> {
  requireUnlocked();
  const list = rhLaunches().slice(0, 40);
  const rows: RhLaunchRow[] = [];
  for (let i = 0; i < list.length; i += 4) {
    const part = await Promise.all(
      list.slice(i, i + 4).map(async (l): Promise<RhLaunchRow> => {
        try {
          const v = await rhTokenView(l.token, { trades: 50 });
          return { token: v.token, name: l.name, symbol: l.symbol, image: l.image ?? logoUrl(l.logo), at: l.at, dev: l.dev ?? null, bundle: l.bundle?.length ?? 0, mcapEth: v.state.mcapEth, progress: v.state.progress, graduated: v.state.graduated, netEth: v.pnl.netEth, spentEth: Number(formatEther(BigInt(v.pnl.spentWei))), heldValueEth: v.pnl.heldValueEth };
        } catch {
          return { token: l.token, name: l.name, symbol: l.symbol, image: l.image ?? logoUrl(l.logo), at: l.at, dev: l.dev ?? null, bundle: l.bundle?.length ?? 0, mcapEth: null, progress: null, graduated: false, netEth: null, spentEth: null, heldValueEth: null };
        }
      }),
    );
    rows.push(...part);
  }
  return rows;
}

