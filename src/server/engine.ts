/* Typed wrappers over the untyped donchain engine. Amounts are lamports/BigInt here. */
import { PublicKey, type Connection, type VersionedTransaction } from "@solana/web3.js";
import { isHeliusSender, SENDER_TIP_LAMPORTS } from "@/engine/solana/config.js";
import { latestBlockhash, sendBundleAndConfirm, sendMany, type SendResult } from "@/engine/solana/send.js";
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
import { logActivity, store, track, type Job } from "./store";

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

async function dispatch(
  txs: VersionedTransaction[],
  rows: { address: string; label: string; sol: string }[],
  opts: TradeOpts,
  lastValidBlockHeight: number,
): Promise<TradeOutcome[]> {
  const conn = readConn();
  const out: TradeOutcome[] = [];
  if (opts.bundle) {
    for (let i = 0; i < txs.length; i += 5) {
      const chunk = txs.slice(i, i + 5);
      const r = await sendBundleAndConfirm(conn, chunk, { timeoutMs: 45_000 });
      chunk.forEach((_tx, k) => {
        const row = rows[i + k];
        const o: TradeOutcome = { address: row.address, label: row.label, ok: r.ok, signature: r.sigs[k] ?? null, error: r.ok ? null : (r.error ?? "bundle not landed"), sol: row.sol };
        out.push(o);
        jobPush(opts.job, o.ok, { label: o.label, address: o.address, sol: o.sol, signature: o.signature, error: o.error ?? undefined, phase: "bundle" });
      });
    }
    return out;
  }
  const results: SendResult[] = await sendMany(conn, sendConn(), txs, { lastValidBlockHeight, staggerMs: 0 });
  results.forEach((r, k) => {
    const row = rows[k];
    const o: TradeOutcome = { address: row.address, label: row.label, ok: r.confirmed, signature: r.signature ?? null, error: r.confirmed ? null : (r.error ?? "not confirmed"), sol: row.sol };
    out.push(o);
    jobPush(opts.job, o.ok, { label: o.label, address: o.address, sol: o.sol, signature: o.signature, error: o.error ?? undefined, phase: "send" });
  });
  return out;
}

/** buy `lamportsEach` of SOL on `mint` from every wallet. Fails cleanly (readable error) on empty wallets. */
export async function buyWithWallets(opts: TradeOpts & { lamportsEach: bigint | ((address: string) => bigint) }): Promise<TradeOutcome[]> {
  requireUnlocked();
  const st = store();
  const conn = readConn();
  const mintPk = new PublicKey(opts.mint);
  const found = await fetchCurve(conn, mintPk);
  if (!found) throw new HttpError(404, "Bonding curve not found: not a pump.fun mint, or the token already migrated.");
  const { curve } = found;
  if (curve.complete) throw new HttpError(409, "Token graduated to PumpSwap: buying on the curve is not possible here.");
  const wallets = vaultWallets(opts.wallets);
  const amountOf = (a: string) => (typeof opts.lamportsEach === "function" ? opts.lamportsEach(a) : opts.lamportsEach);
  // balance guard: a readable error instead of a failed broadcast
  const infos = await getAccountsChunked(conn, wallets.map((w) => new PublicKey(w.address))).catch(() => null);
  const FEE_MARGIN = BigInt(3_000_000); // ATA rent + fees + priority
  const poor: string[] = [];
  wallets.forEach((w, i) => {
    const bal = BigInt(infos?.[i]?.lamports ?? 0);
    if (infos && bal < amountOf(w.address) + FEE_MARGIN + opts.tipLamports) poor.push(`${w.label} (${solString(bal)} SOL)`);
  });
  if (poor.length === wallets.length)
    throw new HttpError(402, `Insufficient SOL: ${poor.join(", ")} — each wallet needs the buy amount + ~0.003 SOL for fees${opts.tipLamports > BigInt(0) ? " + the tip" : ""}.`);
  if (poor.length) jobNote(opts.job, `Skipped (insufficient SOL): ${poor.join(", ")}`);
  const active = wallets.filter((_w, i) => BigInt(infos?.[i]?.lamports ?? 0) >= amountOf(_w.address) + FEE_MARGIN + opts.tipLamports || !infos);
  const tokenProgram = await tokenProgramOf(conn, mintPk);
  const rows: BuyRow[] = active.map((w) => ({ label: w.label, signer: st.sol.keypair(w.address), solIn: amountOf(w.address), cuPrice: opts.cuPrice }));
  const plans = planBuys(rows, { virtualTokenReserves: curve.virtualTokenReserves, virtualSolReserves: curve.virtualSolReserves, realTokenReserves: curve.realTokenReserves }, opts.slippageBps);
  const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
  const txs = plans.map((p, i) =>
    signWith(
      buildBuyTx({ mint: mintPk, creator: curve.creator, tokenProgram, cuPrice: opts.cuPrice, ataExists: false, tipLamports: opts.bundle || opts.tipLamports > BigInt(0) ? opts.tipLamports : BigInt(0), recentBlockhash: blockhash }, p),
      rows[i].signer,
    ),
  );
  const out = await dispatch(txs, active.map((w) => ({ address: w.address, label: w.label, sol: solString(amountOf(w.address)) })), opts, lastValidBlockHeight);
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
  const txs = plans.map((p, i) =>
    signWith(
      buildSellTx({ mint: mintPk, creator: curve.creator, tokenProgram, cuPrice: opts.cuPrice, tipLamports: opts.bundle || opts.tipLamports > BigInt(0) ? opts.tipLamports : BigInt(0), recentBlockhash: blockhash, cashback: curve.isCashbackCoin }, p),
      rows[i].signer,
    ),
  );
  const out = await dispatch(txs, rowMeta.map((m, i) => ({ ...m, sol: solString(plans[i].expectedSol) })), opts, lastValidBlockHeight);
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

export const stepOf = (o: TradeOutcome): JobStep => ({ ok: o.ok, at: Date.now(), address: o.address, label: o.label, sol: o.sol, signature: o.signature, error: o.error ?? undefined });
