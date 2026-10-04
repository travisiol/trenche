/* Typed wrappers over the untyped donchain engine. Amounts are lamports/BigInt here. */
import { PublicKey, type Connection, type VersionedTransaction } from "@solana/web3.js";
import { isHeliusSender, SENDER_TIP_LAMPORTS } from "@/engine/solana/config.js";
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
import { isDevnet, logActivity, store, track, type Job } from "./store";

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
  const info = await conn.getAccountInfo(mint, "confirmed").catch(() => null);
  return tokenProgramFor(info?.owner.toBase58() ?? TOKEN_2022_PROGRAM);
}

export type TradeOpts = {
  mint: string;
  wallets: string[];
  slippageBps: number;
  cuPrice: number;
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
    return out;
  }
  // every transaction is journaled the moment it is broadcast ("sent") and again the moment ITS confirmation settles:
  // the UI shows per-wallet progress within seconds instead of waiting for the slowest wallet
  const settled = new Array<TradeOutcome | null>(txs.length).fill(null);
  const results: SendResult[] = await sendMany(conn, sendConn(), txs, {
    lastValidBlockHeight,
    staggerMs: 0,
    rebuild: hooks.rebuild,
    verify: hooks.verify,
    pollMs: isPublicRpc() ? 600 : 400,
    pollGrowth: isPublicRpc() ? 1.35 : 1,
    onSent: (k, sig) => jobNote(opts.job, `${rows[k].label}: sent`, { phase: "sent", address: rows[k].address, signature: sig }),
    onResult: (k, r) => {
      const row = rows[k];
      noteRecovery(r, row.label);
      const o: TradeOutcome = { address: row.address, label: row.label, ok: r.confirmed, signature: r.signature ?? null, error: r.confirmed ? null : (r.error ?? "not confirmed"), sol: row.sol };
      settled[k] = o;
      jobPush(opts.job, o.ok, { label: o.label, address: o.address, sol: o.sol, signature: o.signature, error: o.error ?? undefined, phase: "send" });
    },
  });
  results.forEach((r, k) => {
    if (settled[k]) return out.push(settled[k]!);
    const row = rows[k];
    const o: TradeOutcome = { address: row.address, label: row.label, ok: r.confirmed, signature: r.signature ?? null, error: r.confirmed ? null : (r.error ?? "not confirmed"), sol: row.sol };
    out.push(o);
    jobPush(opts.job, o.ok, { label: o.label, address: o.address, sol: o.sol, signature: o.signature, error: o.error ?? undefined, phase: "send" });
  });
  invalidateRpcCache((k) => rows.some((r) => k.includes(r.address)) || k.includes(opts.mint));
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

/** buy `lamportsEach` of SOL on `mint` from every wallet. Fails cleanly (readable error) on empty wallets. */
export async function buyWithWallets(opts: TradeOpts & { lamportsEach: bigint | ((address: string) => bigint) }): Promise<TradeOutcome[]> {
  requireUnlocked();
  await syncPumpCluster();
  opts = devnetPlain(opts);
  const st = store();
  const conn = readConn();
  const mintPk = new PublicKey(opts.mint);
  const found = await fetchCurve(conn, mintPk);
  if (!found) throw new HttpError(404, "Bonding curve not found: not a pump.fun mint, or the token already migrated.");
  const { curve } = found;
  if (curve.complete) throw new HttpError(409, "Token graduated to PumpSwap: buying on the curve is not possible here.");
  const wallets = vaultWallets(opts.wallets);
  const amountOf = (a: string) => (typeof opts.lamportsEach === "function" ? opts.lamportsEach(a) : opts.lamportsEach);
  // balance guard (SOL + current token balance in one chunked read): a readable error instead of a failed broadcast;
  // the token balance is the proof used when a signature is not found after the blockhash window
  const tokenProgram = await tokenProgramOf(conn, mintPk);
  const pre = await readBalancesChunked(conn, wallets.map((w) => w.address), opts.mint, tokenProgram).catch(() => null);
  const FEE_MARGIN = BigInt(3_000_000); // ATA rent + fees + priority
  const poor: string[] = [];
  wallets.forEach((w, i) => {
    const bal = pre?.[i]?.sol ?? BigInt(0);
    if (pre && bal < amountOf(w.address) + FEE_MARGIN + opts.tipLamports) poor.push(`${w.label} (${solString(bal)} SOL)`);
  });
  if (poor.length === wallets.length)
    throw new HttpError(402, `Insufficient SOL: ${poor.join(", ")} — each wallet needs the buy amount + ~0.003 SOL for fees${opts.tipLamports > BigInt(0) ? " + the tip" : ""}.`);
  if (poor.length) jobNote(opts.job, `Skipped (insufficient SOL): ${poor.join(", ")}`);
  const active = wallets.filter((_w, i) => !pre || (pre[i]?.sol ?? BigInt(0)) >= amountOf(_w.address) + FEE_MARGIN + opts.tipLamports);
  const preTokens = new Map(active.map((w) => [w.address, pre?.find((b) => b.owner === w.address)?.tokens ?? null]));
  const rows: BuyRow[] = active.map((w) => ({ label: w.label, signer: st.sol.keypair(w.address), solIn: amountOf(w.address), cuPrice: opts.cuPrice }));
  const plans = planBuys(rows, { virtualTokenReserves: curve.virtualTokenReserves, virtualSolReserves: curve.virtualSolReserves, realTokenReserves: curve.realTokenReserves }, opts.slippageBps);
  const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
  const build = (i: number, recentBlockhash: string) =>
    signWith(
      buildBuyTx({ mint: mintPk, creator: curve.creator, tokenProgram, cuPrice: opts.cuPrice, ataExists: false, tipLamports: opts.bundle || opts.tipLamports > BigInt(0) ? opts.tipLamports : BigInt(0), recentBlockhash }, plans[i]),
      rows[i].signer,
    );
  const txs = plans.map((_p, i) => build(i, blockhash));
  const out = await dispatch(txs, active.map((w) => ({ address: w.address, label: w.label, sol: solString(amountOf(w.address)) })), opts, lastValidBlockHeight, {
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
    data: { side: "buy", solTotal: okSol, outcomes: out },
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
  const found = await fetchCurve(conn, mintPk);
  if (!found) throw new HttpError(404, "Bonding curve not found: not a pump.fun mint, or the token already migrated.");
  const { curve } = found;
  if (curve.complete) throw new HttpError(409, "Token graduated to PumpSwap: selling on the curve is not possible here.");
  const wallets = vaultWallets(opts.wallets);
  const tokenProgram = await tokenProgramOf(conn, mintPk);
  const balances = await readBalancesChunked(conn, wallets.map((w) => w.address), opts.mint, tokenProgram);
  const byOwner = new Map(balances.map((b) => [b.owner, b]));
  const unreadable: string[] = [];
  const rows: SellRow[] = [];
  const rowMeta: { address: string; label: string }[] = [];
  const pct = BigInt(Math.max(1, Math.min(100, Math.round(opts.percent))));
  for (const w of wallets) {
    const b = byOwner.get(w.address);
    if (!b || b.tokens === null) {
      unreadable.push(w.label);
      continue;
    }
    if (b.tokens <= BigInt(0)) continue;
    const tokens = pct >= BigInt(100) ? b.tokens : (b.tokens * pct) / BigInt(100);
    if (tokens <= BigInt(0)) continue;
    rows.push({ label: w.label, signer: st.sol.keypair(w.address), tokens });
    rowMeta.push({ address: w.address, label: w.label });
  }
  if (unreadable.length) jobNote(opts.job, `Unreadable balance (RPC): ${unreadable.join(", ")} — not sold.`);
  if (rows.length === 0)
    throw new HttpError(409, unreadable.length ? `RPC could not read the balance of ${unreadable.join(", ")}. Nothing was sold — retry.` : "Nothing to sell: these wallets hold no tokens of this mint.");
  const plans = planSells(rows, { virtualTokenReserves: curve.virtualTokenReserves, virtualSolReserves: curve.virtualSolReserves, realTokenReserves: curve.realTokenReserves }, opts.slippageBps);
  const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
  const build = (i: number, recentBlockhash: string) =>
    signWith(
      buildSellTx({ mint: mintPk, creator: curve.creator, tokenProgram, cuPrice: opts.cuPrice, tipLamports: opts.bundle || opts.tipLamports > BigInt(0) ? opts.tipLamports : BigInt(0), recentBlockhash, cashback: curve.isCashbackCoin }, plans[i]),
      rows[i].signer,
    );
  const txs = plans.map((_p, i) => build(i, blockhash));
  const out = await dispatch(txs, rowMeta.map((m, i) => ({ ...m, sol: solString(plans[i].expectedSol) })), opts, lastValidBlockHeight, {
    rebuild: async (i) => {
      const fresh = await latestBlockhash(conn);
      return { tx: build(i, fresh.blockhash), lastValidBlockHeight: fresh.lastValidBlockHeight };
    },
    // a sell landed when the wallet now holds fewer tokens than before the send
    verify: async (i) => {
      const before = byOwner.get(rowMeta[i].address)?.tokens ?? null;
      const now = await tokenBalanceOf(conn, rowMeta[i].address, mintPk, tokenProgram);
      return before !== null && now !== null && now < before;
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
    data: { side: "sell", solTotal: okSol, percent: opts.percent, outcomes: out },
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
