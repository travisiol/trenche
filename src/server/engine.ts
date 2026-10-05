/* Typed wrappers over the untyped donchain engine. Amounts are lamports/BigInt here. */
import { PublicKey, type Connection, type VersionedTransaction } from "@solana/web3.js";
import { isHeliusSender, SENDER_TIP_LAMPORTS } from "@/engine/solana/config.js";
import { base58Encode } from "@/engine/solana/keys.js";
import { latestBlockhash, sendBundleAndConfirm, sendMany, type Rebuilt, type SendResult } from "@/engine/solana/send.js";
import {
  INITIAL_REAL_TOKENS,
  TOKEN_2022_PROGRAM,
  associatedTokenAddress,
  bondingCurvePda,
  parseBondingCurve,
  tokenProgramFor,
  type BondingCurve,
} from "@/engine/solana/pump/pdas.js";
import { buildBuyTx, buildSellTx, planBuys, planSells, signWith, type BuyRow, type SellRow } from "@/engine/solana/pump/math.js";
import type { CurveState, JobStep } from "@/lib/types";
import { HttpError, lamportsOf, solString } from "./api";
import { jobPush, jobNote } from "./jobs";
import { syncPumpCluster } from "./pumpcluster";
import { invalidateRpcCache } from "./rpcqueue";
import { solPriceCached } from "./price";
import { isDevnet, logActivity, store, track, type Job } from "./store";
import { blockhashNow, cachedTokenProgram, hotDirty, hotSnapshot, rememberTokenProgram } from "./hot";
import { CU_LIMITS, priorityFee, priorityFeeCached } from "./priority";
import { SenderConnection, simulateSends } from "./sender";
import { watchSignature } from "./sigsub";

export { solString };

export function requireUnlocked(): void {
  const st = store();
  if (!st.sol.unlocked || !st.passphrase) throw new HttpError(423, "Keystore locked. Unlock it in Settings first.");
}

export const readConn = (): Connection => store().sol.connection();
export const sendConn = (): Connection => store().sol.sendConnection();

/** publicnode (the free default) blocks getMultipleAccounts above 10 keys ("Request blocked", probed
 *  2026-10-04: 10 ok, 12+ blocked; bursts of 8 parallel calls fine). Private RPCs take 100. */
export function rpcChunk(): number {
  return /publicnode/i.test(store().sol.config.rpcUrl) ? 10 : 100;
}
export const isPublicRpc = (): boolean => rpcChunk() === 10;

/** getMultipleAccountsInfo in RPC-sized chunks, up to 6 in flight; throws on the first failed chunk */
export async function getAccountsChunked(conn: Connection, keys: PublicKey[]): Promise<(import("@solana/web3.js").AccountInfo<Buffer> | null)[]> {
  const size = rpcChunk();
  const chunks: PublicKey[][] = [];
  for (let i = 0; i < keys.length; i += size) chunks.push(keys.slice(i, i + size));
  const out = new Array<import("@solana/web3.js").AccountInfo<Buffer> | null>(keys.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, chunks.length) }, async () => {
      while (next < chunks.length) {
        const k = next++;
        const res = await conn.getMultipleAccountsInfo(chunks[k], "confirmed");
        res.forEach((r, i) => {
          out[k * size + i] = r;
        });
      }
    }),
  );
  return out;
}

/** SOL + token balance of each owner on `mint` (chunked replacement of the engine's readSolanaBalances) */
export async function readBalancesChunked(conn: Connection, owners: string[], mint: string, tokenProgram: PublicKey): Promise<{ owner: string; sol: bigint; tokens: bigint | null }[]> {
  if (owners.length === 0) return [];
  const mintPk = new PublicKey(mint);
  const ownerPks = owners.map((o) => new PublicKey(o));
  const atas = ownerPks.map((o) => associatedTokenAddress(o, mintPk, tokenProgram));
  const infos = await getAccountsChunked(conn, [...ownerPks, ...atas]);
  return owners.map((owner, i) => {
    const ata = infos[owners.length + i];
    let tokens: bigint | null = BigInt(0);
    if (ata?.data) {
      try {
        tokens = Buffer.from(ata.data).readBigUInt64LE(64);
      } catch {
        tokens = null;
      }
    }
    return { owner, sol: BigInt(infos[i]?.lamports ?? 0), tokens };
  });
}

export function labelOf(address: string): string {
  const st = store();
  return st.walletMeta.meta[address]?.label || st.sol.wallets.find((w) => w.address === address)?.label || address.slice(0, 6);
}

/** resolve addresses to vault wallets; throws 400 when one is unknown */
export function vaultWallets(addresses: string[]): { label: string; address: string }[] {
  const st = store();
  const known = new Map(st.sol.wallets.map((w) => [w.address, w]));
  return addresses.map((a) => {
    const w = known.get(a);
    if (!w) throw new HttpError(400, `Wallet ${a.slice(0, 8)}… is not in the vault.`);
    return { label: labelOf(a), address: a };
  });
}

/** expand group ids to active (non-archived) wallet addresses */
export function groupWallets(groupId: string): string[] {
  const st = store();
  return st.sol.wallets
    .map((w) => w.address)
    .filter((a) => st.walletMeta.meta[a]?.group === groupId && !st.walletMeta.meta[a]?.archived);
}

/** explicit tip wins; else the Helius sender needs its 5000-lamport tip; else none */
export function tipLamportsFor(tipSol: unknown): bigint {
  if (isDevnet()) return BigInt(0); // no Jito, no Helius Sender on devnet: a tip would just burn SOL
  if (tipSol !== undefined && tipSol !== null && tipSol !== "") {
    const l = lamportsOf(tipSol, "tipSol", true);
    if (l > BigInt(0)) return l;
  }
  return isHeliusSender(store().sol.config.sendRpcUrl) ? SENDER_TIP_LAMPORTS : BigInt(0);
}

export const PUMP_SUPPLY_TOKENS = 1_000_000_000; // 1e9 tokens, 6 decimals

export type CurveMetrics = { progress: number; marketCapSol: number; priceSol: number };

export function curveMetrics(c: { virtualSolReserves: bigint; virtualTokenReserves: bigint; realTokenReserves: bigint }): CurveMetrics {
  const vSol = Number(c.virtualSolReserves) / 1e9;
  const vTok = Number(c.virtualTokenReserves) / 1e6;
  const priceSol = vTok > 0 ? vSol / vTok : 0;
  const sold = INITIAL_REAL_TOKENS - c.realTokenReserves;
  const progress = Math.max(0, Math.min(100, Number((sold * BigInt(10000)) / INITIAL_REAL_TOKENS) / 100));
  return { progress, marketCapSol: priceSol * PUMP_SUPPLY_TOKENS, priceSol };
}

export async function fetchCurve(conn: Connection, mint: PublicKey): Promise<{ curve: BondingCurve; pda: PublicKey } | null> {
  const pda = bondingCurvePda(mint);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  try {
    return { curve: parseBondingCurve(info.data), pda };
  } catch {
    return null;
  }
}

export function toCurveState(curve: BondingCurve, pda: PublicKey, solUsd: number | null): CurveState {
  const m = curveMetrics(curve);
  return {
    bondingCurve: pda.toBase58(),
    virtualTokenReserves: curve.virtualTokenReserves.toString(),
    virtualSolReserves: curve.virtualSolReserves.toString(),
    realTokenReserves: curve.realTokenReserves.toString(),
    realSolReserves: curve.realSolReserves.toString(),
    tokenTotalSupply: curve.tokenTotalSupply.toString(),
    complete: curve.complete,
    creator: curve.creator.toBase58(),
    isCashbackCoin: curve.isCashbackCoin,
    progress: m.progress,
    marketCapSol: m.marketCapSol,
    marketCapUsd: solUsd ? m.marketCapSol * solUsd : null,
    priceSol: m.priceSol,
  };
}

export async function tokenProgramOf(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const known = cachedTokenProgram(mint.toBase58());
  if (known) return tokenProgramFor(known);
  const info = await conn.getAccountInfo(mint, "confirmed").catch(() => null);
  if (info) rememberTokenProgram(mint.toBase58(), info.owner.toBase58());
  return tokenProgramFor(info?.owner.toBase58() ?? TOKEN_2022_PROGRAM);
}

export type TradeOpts = {
  mint: string;
  wallets: string[];
  slippageBps: number;
  /** priority fee CEILING (µLamports / CU): the price paid is the 5 s cached estimate (priority.ts), capped here */
  cuPrice: number;
  /** pay exactly `cuPrice` (an explicit price in the request), no estimate */
  cuPriceFixed?: boolean;
  tipLamports: bigint;
  /** send through Jito bundles of 5 txs (needs tipLamports > 0) */
  bundle: boolean;
  job: Job | null;
  /** activity kind label */
  kind?: string;
};

export type TradeOutcome = { address: string; label: string; ok: boolean; signature: string | null; error: string | null; sol: string };

/** per-transaction hooks for sendMany: re-sign with a fresh blockhash / prove by token balance (see send.js) */
type DispatchHooks = {
  rebuild?: (i: number) => Promise<Rebuilt>;
  verify?: (i: number) => Promise<boolean>;
};

/** a snapshot older than this is re-read on the hot path (the ticker refreshes every 2 s while the page is open) */
const HOT_MAX_AGE = 3500;

const sigOf = (tx: VersionedTransaction): string => base58Encode(tx.signatures[0]);

async function dispatch(
  txs: VersionedTransaction[],
  rows: { address: string; label: string; sol: string }[],
  opts: TradeOpts,
  lastValidBlockHeight: number,
  hooks: DispatchHooks = {},
): Promise<TradeOutcome[]> {
  const conn = readConn();
  const out: TradeOutcome[] = [];
  const noteRecovery = (r: { recovered?: "history" | "verify"; rebuilds?: number }, label: string) => {
    if (r.recovered === "history") jobNote(opts.job, `${label}: found in the transaction history after the confirmation window (RPC was rate-limited).`, { phase: "confirm" });
    if (r.recovered === "verify") jobNote(opts.job, `${label}: proven by the token balance after the confirmation window.`, { phase: "confirm" });
    if (r.rebuilds) jobNote(opts.job, `${label}: re-signed with a fresh blockhash (${r.rebuilds}×).`, { phase: "confirm" });
  };
  if (opts.bundle) {
    for (let i = 0; i < txs.length; i += 5) {
      const chunk = txs.slice(i, i + 5);
      const r = await sendBundleAndConfirm(conn, chunk, { timeoutMs: 45_000, verify: hooks.verify ? () => hooks.verify!(i) : undefined });
      if (r.recovered) noteRecovery(r, `bundle ${i / 5 + 1}`);
      chunk.forEach((_tx, k) => {
        const row = rows[i + k];
        const o: TradeOutcome = { address: row.address, label: row.label, ok: r.ok, signature: r.sigs[k] ?? null, error: r.ok ? null : (r.error ?? "bundle not landed"), sol: row.sol };
        out.push(o);
        jobPush(opts.job, o.ok, { label: o.label, address: o.address, sol: o.sol, signature: o.signature, error: o.error ?? undefined, phase: "bundle" });
      });
    }
    invalidateRpcCache((k) => rows.some((r) => k.includes(r.address)) || k.includes(opts.mint));
    hotDirty(opts.mint);
    return out;
  }
  // push confirmation: processed + confirmed subscriptions opened BEFORE the send (the socket is kept warm by the
  // hot-state ticker), so "landed" shows ~0.4–0.8 s after the send and "confirmed" settles without polling
  const readUrl = store().sol.config.rpcUrl;
  const watches = new Map<string, ReturnType<typeof watchSignature>>();
  const watch = (sig: string, k: number | null) => {
    let w = watches.get(sig);
    if (!w) {
      w = watchSignature(readUrl, sig);
      watches.set(sig, w);
      w.processed.then((ev) => {
        if (!ev || k === null) return;
        hotDirty(opts.mint);
        if (!ev.err || ev.simulated) jobNote(opts.job, `${rows[k].label}: landed (processed)`, { phase: "landed", address: rows[k].address, signature: sig, sol: rows[k].sol, ok: !ev.err });
      });
    }
    return w;
  };
  txs.forEach((tx, k) => watch(sigOf(tx), k));
  const sender = sendConn();
  // every transaction is journaled the moment it is broadcast ("sent") and again the moment ITS confirmation settles:
  // the UI shows per-wallet progress within milliseconds instead of waiting for the slowest wallet
  const settled = new Array<TradeOutcome | null>(txs.length).fill(null);
  const results: SendResult[] = await sendMany(conn, sender, txs, {
    lastValidBlockHeight,
    staggerMs: 0,
    rebuild: hooks.rebuild,
    verify: hooks.verify,
    subscribe: (sig) => watch(sig, null).confirmed,
    // with the socket the poll is only the safety net; without it, the fast poll
    pollMs: 1500,
    pollFallbackMs: isPublicRpc() ? 600 : 400,
    pollGrowth: isPublicRpc() ? 1.35 : 1,
    onSent: (k, sig) => jobNote(opts.job, `${rows[k].label}: sent`, { phase: "sent", address: rows[k].address, signature: sig, sol: rows[k].sol }),
    onResult: (k, r) => {
      const row = rows[k];
      noteRecovery(r, row.label);
      const o: TradeOutcome = { address: row.address, label: row.label, ok: r.confirmed, signature: r.signature ?? null, error: r.confirmed ? null : (r.error ?? "not confirmed"), sol: row.sol };
      settled[k] = o;
      jobPush(opts.job, o.ok, { label: o.label, address: o.address, sol: o.sol, signature: o.signature, error: o.error ?? undefined, phase: "send" });
    },
  });
  if (sender instanceof SenderConnection && sender.lastSkip) jobNote(opts.job, `Helius Sender skipped (${sender.lastSkip}): sent through the read RPC only.`, { phase: "send" });
  results.forEach((r, k) => {
    if (settled[k]) return out.push(settled[k]!);
    const row = rows[k];
    const o: TradeOutcome = { address: row.address, label: row.label, ok: r.confirmed, signature: r.signature ?? null, error: r.confirmed ? null : (r.error ?? "not confirmed"), sol: row.sol };
    out.push(o);
    jobPush(opts.job, o.ok, { label: o.label, address: o.address, sol: o.sol, signature: o.signature, error: o.error ?? undefined, phase: "send" });
  });
  invalidateRpcCache((k) => rows.some((r) => k.includes(r.address)) || k.includes(opts.mint));
  hotDirty(opts.mint);
  return out;
}

/** token balance of one wallet's ATA right now (null when the RPC cannot read it) */
async function tokenBalanceOf(conn: Connection, owner: string, mint: PublicKey, tokenProgram: PublicKey): Promise<bigint | null> {
  const ata = associatedTokenAddress(new PublicKey(owner), mint, tokenProgram);
  const info = await conn.getAccountInfo(ata, "confirmed").catch(() => undefined);
  if (info === undefined) return null;
  if (!info?.data) return BigInt(0);
  try {
    return Buffer.from(info.data).readBigUInt64LE(64);
  } catch {
    return null;
  }
}

/** Sender tip floor + priority fee + one job line saying what the transaction pays. Pure memory when warm. */
async function feesFor(opts: TradeOpts): Promise<{ cuPrice: number; tipLamports: bigint }> {
  let tipLamports = opts.tipLamports;
  const sender = sendConn();
  const notes: string[] = [];
  if (!opts.bundle && sender instanceof SenderConnection && sender.requiresTip && tipLamports < sender.minTip) {
    tipLamports = sender.minTip;
    notes.push(`tip raised to ${solString(sender.minTip)} SOL (Helius Sender minimum, added automatically)`);
  } else if (!opts.bundle && sender instanceof SenderConnection && sender.requiresTip && tipLamports === sender.minTip) notes.push(`tip ${solString(tipLamports)} SOL (Helius Sender minimum — no tip set)`);
  let cuPrice = opts.cuPrice;
  if (!opts.cuPriceFixed && !isDevnet()) {
    const f = priorityFeeCached(opts.mint, opts.cuPrice) ?? (await priorityFee(opts.mint, opts.cuPrice));
    cuPrice = f.microLamports;
    notes.push(`priority ${cuPrice.toLocaleString("en-US")} µL/CU (${f.source === "helius" ? "Helius estimate, High" : f.source === "recent" ? "recent fees p75" : "estimate unavailable → cap"}, cap ${opts.cuPrice.toLocaleString("en-US")})`);
  }
  if (notes.length) jobNote(opts.job, `Fees: ${notes.join(" · ")}`, { phase: "fees" });
  return { cuPrice, tipLamports };
}

/** buy `lamportsEach` of SOL on `mint` from every wallet. Fails cleanly (readable error) on empty wallets. */
export async function buyWithWallets(opts: TradeOpts & { lamportsEach: bigint | ((address: string) => bigint) }): Promise<TradeOutcome[]> {
  requireUnlocked();
  await syncPumpCluster();
  opts = devnetPlain(opts);
  const st = store();
  const conn = readConn();
  const mintPk = new PublicKey(opts.mint);
  const wallets = vaultWallets(opts.wallets);
  const amountOf = (a: string) => (typeof opts.lamportsEach === "function" ? opts.lamportsEach(a) : opts.lamportsEach);
  // curve + SOL + token balances + token program from the hot snapshot (no read when the page keeps it warm),
  // blockhash from the warm cache, priority fee from its 5 s cache — all three in parallel when something is cold
  const [snap, bh, fees] = await Promise.all([hotSnapshot(opts.mint, wallets.map((w) => w.address), HOT_MAX_AGE), blockhashNow(), feesFor(opts)]);
  if (!snap.curve) throw new HttpError(404, "Bonding curve not found: not a pump.fun mint, or the token already migrated.");
  const curve = snap.curve;
  if (curve.complete) throw new HttpError(409, "Token graduated to PumpSwap: buying on the curve is not possible here.");
  const tokenProgram = snap.tokenProgram;
  // balance guard: a readable error instead of a failed broadcast; the token balance is the proof used when a
  // signature is not found after the blockhash window
  const FEE_MARGIN = BigInt(3_000_000); // ATA rent + fees + priority
  const sim = simulateSends();
  const poor: string[] = [];
  const balOf = (a: string) => snap.bal.get(a)?.sol ?? BigInt(0);
  wallets.forEach((w) => {
    if (balOf(w.address) < amountOf(w.address) + FEE_MARGIN + fees.tipLamports) poor.push(`${w.label} (${solString(balOf(w.address))} SOL)`);
  });
  if (poor.length === wallets.length && !sim)
    throw new HttpError(402, `Insufficient SOL: ${poor.join(", ")} — each wallet needs the buy amount + ~0.003 SOL for fees${fees.tipLamports > BigInt(0) ? " + the tip" : ""}.`);
  if (poor.length) jobNote(opts.job, `${sim ? "[simulated sends] would skip" : "Skipped"} (insufficient SOL): ${poor.join(", ")}`);
  const active = sim ? wallets : wallets.filter((w) => balOf(w.address) >= amountOf(w.address) + FEE_MARGIN + fees.tipLamports);
  const preTokens = new Map(active.map((w) => [w.address, snap.bal.get(w.address)?.tokens ?? null]));
  const rows: BuyRow[] = active.map((w) => ({ label: w.label, signer: st.sol.keypair(w.address), solIn: amountOf(w.address), cuPrice: fees.cuPrice }));
  const plans = planBuys(rows, { virtualTokenReserves: curve.virtualTokenReserves, virtualSolReserves: curve.virtualSolReserves, realTokenReserves: curve.realTokenReserves }, opts.slippageBps);
  const tip = opts.bundle || fees.tipLamports > BigInt(0) ? fees.tipLamports : BigInt(0);
  const build = (i: number, recentBlockhash: string) => {
    const ataExists = !!snap.bal.get(active[i].address)?.ataExists;
    return signWith(
      buildBuyTx({ mint: mintPk, creator: curve.creator, tokenProgram, cuPrice: fees.cuPrice, cuLimit: ataExists ? CU_LIMITS.buyAtaExists : CU_LIMITS.buyNewAta, ataExists, tipLamports: tip, jitoTip: opts.bundle, recentBlockhash }, plans[i]),
      rows[i].signer,
    );
  };
  const txs = plans.map((_p, i) => build(i, bh.blockhash));
  // click → signed (ms since the job started): the hot path's own cost, before the network
  if (opts.job) opts.job.extra = { ...(opts.job.extra ?? {}), signedMs: Date.now() - opts.job.startedAt, warm: snap.fromMemory && bh.cached };
  const out = await dispatch(txs, active.map((w) => ({ address: w.address, label: w.label, sol: solString(amountOf(w.address)) })), opts, bh.lastValidBlockHeight, {
    rebuild: async (i) => {
      const fresh = await latestBlockhash(conn);
      return { tx: build(i, fresh.blockhash), lastValidBlockHeight: fresh.lastValidBlockHeight };
    },
    // a buy landed when the wallet now holds more tokens than before the send
    verify: async (i) => {
      const before = preTokens.get(active[i].address);
      const now = await tokenBalanceOf(conn, active[i].address, mintPk, tokenProgram);
      return before !== null && before !== undefined && now !== null && now > before;
    },
  });
  track(st, opts.mint);
  const okSol = out.filter((o) => o.ok).reduce((s, o) => s + Number(o.sol), 0);
  logActivity(st, {
    kind: opts.kind ?? "buy",
    ok: out.some((o) => o.ok),
    message: `Buy ${opts.mint.slice(0, 6)}… — ${out.filter((o) => o.ok).length}/${out.length} confirmed (${okSol.toFixed(4)} SOL)`,
    mint: opts.mint,
    wallets: out.map((o) => o.address),
    signature: out.find((o) => o.ok)?.signature ?? undefined,
    jobId: opts.job?.id,
    data: { side: "buy", solTotal: okSol, solUsd: solPriceCached(), outcomes: out },
  });
  return out;
}

/** sell `percent` of each wallet's balance. */
export async function sellWithWallets(opts: TradeOpts & { percent: number }): Promise<TradeOutcome[]> {
  requireUnlocked();
  await syncPumpCluster();
  opts = devnetPlain(opts);
  const st = store();
  const conn = readConn();
  const mintPk = new PublicKey(opts.mint);
  const wallets = vaultWallets(opts.wallets);
  const [snap, bh, fees] = await Promise.all([hotSnapshot(opts.mint, wallets.map((w) => w.address), HOT_MAX_AGE), blockhashNow(), feesFor(opts)]);
  if (!snap.curve) throw new HttpError(404, "Bonding curve not found: not a pump.fun mint, or the token already migrated.");
  const curve = snap.curve;
  if (curve.complete) throw new HttpError(409, "Token graduated to PumpSwap: selling on the curve is not possible here.");
  const tokenProgram = snap.tokenProgram;
  const sim = simulateSends();
  const unreadable: string[] = [];
  const rows: SellRow[] = [];
  const rowMeta: { address: string; label: string }[] = [];
  const pct = BigInt(Math.max(1, Math.min(100, Math.round(opts.percent))));
  for (const w of wallets) {
    const b = snap.bal.get(w.address);
    let held = b?.tokens ?? null;
    if (held === null) {
      unreadable.push(w.label);
      continue;
    }
    if (held <= BigInt(0) && sim) held = BigInt(1_000_000_000); // measurement mode: a nominal amount so the tx is built and simulated
    if (held <= BigInt(0)) continue;
    const tokens = pct >= BigInt(100) ? held : (held * pct) / BigInt(100);
    if (tokens <= BigInt(0)) continue;
    rows.push({ label: w.label, signer: st.sol.keypair(w.address), tokens });
    rowMeta.push({ address: w.address, label: w.label });
  }
  if (unreadable.length) jobNote(opts.job, `Unreadable balance (RPC): ${unreadable.join(", ")} — not sold.`);
  if (rows.length === 0)
    throw new HttpError(409, unreadable.length ? `RPC could not read the balance of ${unreadable.join(", ")}. Nothing was sold — retry.` : "Nothing to sell: these wallets hold no tokens of this mint.");
  const before = new Map(rowMeta.map((m) => [m.address, snap.bal.get(m.address)?.tokens ?? null]));
  const plans = planSells(rows, { virtualTokenReserves: curve.virtualTokenReserves, virtualSolReserves: curve.virtualSolReserves, realTokenReserves: curve.realTokenReserves }, opts.slippageBps);
  const tip = opts.bundle || fees.tipLamports > BigInt(0) ? fees.tipLamports : BigInt(0);
  const build = (i: number, recentBlockhash: string) =>
    signWith(
      buildSellTx({ mint: mintPk, creator: curve.creator, tokenProgram, cuPrice: fees.cuPrice, cuLimit: curve.isCashbackCoin ? CU_LIMITS.sellCashback : CU_LIMITS.sell, tipLamports: tip, jitoTip: opts.bundle, recentBlockhash, cashback: curve.isCashbackCoin }, plans[i]),
      rows[i].signer,
    );
  const txs = plans.map((_p, i) => build(i, bh.blockhash));
  // click → signed (ms since the job started): the hot path's own cost, before the network
  if (opts.job) opts.job.extra = { ...(opts.job.extra ?? {}), signedMs: Date.now() - opts.job.startedAt, warm: snap.fromMemory && bh.cached };
  const out = await dispatch(txs, rowMeta.map((m, i) => ({ ...m, sol: solString(plans[i].expectedSol) })), opts, bh.lastValidBlockHeight, {
    rebuild: async (i) => {
      const fresh = await latestBlockhash(conn);
      return { tx: build(i, fresh.blockhash), lastValidBlockHeight: fresh.lastValidBlockHeight };
    },
    // a sell landed when the wallet now holds fewer tokens than before the send
    verify: async (i) => {
      const b = before.get(rowMeta[i].address) ?? null;
      const now = await tokenBalanceOf(conn, rowMeta[i].address, mintPk, tokenProgram);
      return b !== null && now !== null && now < b;
    },
  });
  const okSol = out.filter((o) => o.ok).reduce((s, o) => s + Number(o.sol), 0);
  logActivity(st, {
    kind: opts.kind ?? "sell",
    ok: out.some((o) => o.ok),
    message: `Sell ${opts.percent}% ${opts.mint.slice(0, 6)}… — ${out.filter((o) => o.ok).length}/${out.length} confirmed (~${okSol.toFixed(4)} SOL)`,
    mint: opts.mint,
    wallets: out.map((o) => o.address),
    signature: out.find((o) => o.ok)?.signature ?? undefined,
    jobId: opts.job?.id,
    data: { side: "sell", solTotal: okSol, solUsd: solPriceCached(), percent: opts.percent, outcomes: out },
  });
  return out;
}

/** devnet has no Jito block engine: bundles become plain sequential sends and the job says so */
export function devnetPlain<T extends TradeOpts>(opts: T): T {
  if (!isDevnet() || (!opts.bundle && opts.tipLamports === BigInt(0))) return opts;
  jobNote(opts.job, "Devnet: Jito is mainnet-only — sent as sequential transactions without tip (no atomic bundle).", { phase: "cluster" });
  return { ...opts, bundle: false, tipLamports: BigInt(0) };
}

export const stepOf = (o: TradeOutcome): JobStep => ({ ok: o.ok, at: Date.now(), address: o.address, label: o.label, sol: o.sol, signature: o.signature, error: o.error ?? undefined });
