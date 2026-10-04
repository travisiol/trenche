/* Wash task (Block X): each SOURCE wallet's tokens move to its 1–3 WASH wallets by SPL transfer, in random slices
 * (one transaction per slice), with a random delay between pairs. The source pays each wash wallet's ATA rent
 * (~0.002 SOL) + fees; the wash wallet needs no SOL. A source short on SOL makes THAT pair fail, the others run.
 * Wash wallets come from explicit pairs, a group, any free vault wallet, or fresh wallets generated into the vault
 * (label `wash-<n>`, group "wash"). */
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { latestBlockhash, sendAndConfirm } from "@/engine/solana/send.js";
import { ATA_PROGRAM, associatedTokenAddress } from "@/engine/solana/pump/pdas.js";
import type { JobStep, WashPair } from "@/lib/types";
import { TASK_LIMITS } from "@/lib/types";
import { HttpError, sleep, solString } from "./api";
import { groupWallets, readBalancesChunked, readConn, requireUnlocked, sendConn, tokenProgramOf, vaultWallets } from "./engine";
import { logActivity, saveWalletMeta, store } from "./store";
import { createGroup, generateWallets } from "./wallets";

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
/** ATA rent (0.00203928 SOL) + base fee + priority, per transfer */
const PER_SLICE_COST = BigInt(2_100_000);

function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM),
    keys: [
      meta(payer, true, true),
      meta(associatedTokenAddress(owner, mint, tokenProgram), false, true),
      meta(owner, false, false),
      meta(mint, false, false),
      meta(SystemProgram.programId, false, false),
      meta(tokenProgram, false, false),
    ],
    data: Buffer.from([1]),
  });
}

/** SPL TransferChecked (ix 12): works for Token and Token-2022 */
function transferChecked(source: PublicKey, mint: PublicKey, dest: PublicKey, owner: PublicKey, amount: bigint, decimals: number, tokenProgram: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [meta(source, false, true), meta(mint, false, false), meta(dest, false, true), meta(owner, true, false)],
    data,
  });
}

export type WashOptions = {
  /** explicit pairs; else `sources` are auto-paired */
  pairs?: WashPair[];
  sources?: string[];
  perSource?: number;
  /** "any" | "fresh" | group id */
  autoPairFrom?: string;
  /** wallets that must not become wash wallets (dev, bundle, sniper… of the same launch) */
  exclude?: string[];
};

/** turn the dialog's choices into concrete pairs. Fresh wallets are generated NOW (so the task shows them). */
export function resolveWashPairs(o: WashOptions): WashPair[] {
  const st = store();
  const perSource = Math.max(1, Math.min(TASK_LIMITS.maxWashPerSource, Math.round(Number(o.perSource ?? 1)) || 1));
  if (o.pairs?.length) {
    const seen = new Set<string>();
    const pairs = o.pairs.map((p) => {
      const [src] = vaultWallets([String(p.source)]);
      const wash = [...new Set((p.wash ?? []).map(String))];
      if (wash.length === 0) throw new HttpError(400, `Wash: source ${src.address.slice(0, 6)}… has no wash wallet.`);
      if (wash.length > TASK_LIMITS.maxWashPerSource) throw new HttpError(400, `Wash: ${TASK_LIMITS.maxWashPerSource} wash wallets per source max.`);
      vaultWallets(wash);
      if (wash.includes(src.address)) throw new HttpError(400, "Wash: a wallet cannot wash itself.");
      for (const w of wash) {
        if (seen.has(w)) throw new HttpError(400, `Wash: wallet ${w.slice(0, 6)}… is paired twice.`);
        seen.add(w);
      }
      return { source: src.address, wash };
    });
    return pairs;
  }
  const sources = [...new Set((o.sources ?? []).map(String))];
  if (sources.length === 0) throw new HttpError(400, "Wash: no source wallet (walletIds / pairs).");
  vaultWallets(sources);
  const need = sources.length * perSource;
  const from = String(o.autoPairFrom ?? "any");
  const exclude = new Set([...sources, ...(o.exclude ?? [])]);
  let pool: string[];
  if (from === "fresh") {
    let group = st.walletMeta.groups.find((g) => g.name === "wash");
    if (!group) group = createGroup("wash");
    pool = generateWallets(need, "wash", group.id);
  } else if (from === "any") {
    pool = st.sol.wallets.map((w) => w.address).filter((a) => !st.walletMeta.meta[a]?.archived && !exclude.has(a));
    if (pool.length < need) throw new HttpError(400, `Wash: ${need} free wallet(s) needed to pair ${sources.length} source(s) × ${perSource}, the vault has ${pool.length} (create wallets, or auto-pair from "fresh").`);
  } else {
    const g = st.walletMeta.groups.find((x) => x.id === from || x.name === from);
    if (!g) throw new HttpError(400, `Wash: unknown group "${from}" (autoPairFrom must be "any", "fresh" or a group id).`);
    pool = groupWallets(g.id).filter((a) => !exclude.has(a));
    if (pool.length < need) throw new HttpError(400, `Wash: group "${g.name}" has ${pool.length} free wallet(s), ${need} needed (${sources.length} source(s) × ${perSource}).`);
  }
  return sources.map((source, i) => ({ source, wash: pool.slice(i * perSource, (i + 1) * perSource) }));
}

/** random positive weights normalised to `total` (bigint), last slice takes the rounding remainder */
export function randomSlices(total: bigint, n: number): bigint[] {
  if (n <= 1) return [total];
  const weights = Array.from({ length: n }, () => 0.5 + Math.random());
  const sum = weights.reduce((s, w) => s + w, 0);
  const out: bigint[] = [];
  let left = total;
  for (let i = 0; i < n - 1; i++) {
    const part = BigInt(Math.floor(Number(total) * (weights[i] / sum)));
    out.push(part);
    left -= part;
  }
  out.push(left);
  return out;
}

export type WashResult = { from: string; to: string; tokens: string; ok: boolean; signature: string | null; error: string | null };

export type WashRunOptions = { onStep?: (s: JobStep) => void; cuPrice?: number; minDelayMs?: number; maxDelayMs?: number; /** cooperative stop between slices */ shouldStop?: () => boolean };

/** run the pairs: one result per (source, wash wallet) slice sent; sources without tokens yield no result */
export async function washPairs(mint: string, pairs: WashPair[], o: WashRunOptions = {}): Promise<WashResult[]> {
  requireUnlocked();
  const st = store();
  const conn = readConn();
  const mintPk = new PublicKey(mint);
  const tokenProgram = await tokenProgramOf(conn, mintPk);
  const balances = await readBalancesChunked(conn, pairs.map((p) => p.source), mint, tokenProgram);
  const byOwner = new Map(balances.map((b) => [b.owner, b]));
  const price = o.cuPrice ?? st.settings.cuPrice;
  const out: WashResult[] = [];
  let first = true;
  for (const pair of pairs) {
    if (o.shouldStop?.()) break;
    const b = byOwner.get(pair.source);
    if (!b || b.tokens === null) {
      out.push({ from: pair.source, to: pair.wash[0], tokens: "0", ok: false, signature: null, error: "RPC could not read the token balance" });
      o.onStep?.({ ok: false, at: Date.now(), phase: "wash", address: pair.source, error: "RPC could not read the token balance" });
      continue;
    }
    if (b.tokens <= BigInt(0)) {
      o.onStep?.({ ok: true, at: Date.now(), phase: "wash", address: pair.source, note: "holds no tokens — skipped" });
      continue;
    }
    if (!first && (o.maxDelayMs ?? 0) > 0) {
      const gap = Math.round((o.minDelayMs ?? 0) + Math.random() * Math.max(0, (o.maxDelayMs ?? 0) - (o.minDelayMs ?? 0)));
      o.onStep?.({ ok: true, at: Date.now(), phase: "wait", note: `waiting ${(gap / 1000).toFixed(1)} s before the next pair` });
      await sleep(gap);
      if (o.shouldStop?.()) break;
    }
    first = false;
    const need = PER_SLICE_COST * BigInt(pair.wash.length);
    if (b.sol < need) {
      const msg = `${pair.source.slice(0, 6)}… holds ${solString(b.sol)} SOL but needs ~${solString(need)} SOL to open ${pair.wash.length} token account(s). Pair skipped, nothing sent.`;
      out.push({ from: pair.source, to: pair.wash[0], tokens: (Number(b.tokens) / 1e6).toString(), ok: false, signature: null, error: msg });
      o.onStep?.({ ok: false, at: Date.now(), phase: "wash", address: pair.source, error: msg });
      continue;
    }
    const kp = st.sol.keypair(pair.source);
    const slices = randomSlices(b.tokens, pair.wash.length);
    for (let i = 0; i < pair.wash.length; i++) {
      if (o.shouldStop?.()) break;
      const to = pair.wash[i];
      const amount = slices[i];
      const r: WashResult = { from: pair.source, to, tokens: (Number(amount) / 1e6).toString(), ok: false, signature: null, error: null };
      if (amount <= BigInt(0)) continue;
      try {
        const toPk = new PublicKey(to);
        const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
        const ixs = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
          createAtaIdempotent(kp.publicKey, toPk, mintPk, tokenProgram),
          transferChecked(associatedTokenAddress(kp.publicKey, mintPk, tokenProgram), mintPk, associatedTokenAddress(toPk, mintPk, tokenProgram), kp.publicKey, amount, 6, tokenProgram),
        ];
        const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
        tx.sign([kp]);
        const res = await sendAndConfirm(conn, sendConn(), tx, { lastValidBlockHeight, simulateConn: conn });
        r.ok = res.confirmed;
        r.signature = res.signature;
        r.error = res.confirmed ? null : (res.error ?? "not confirmed");
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e);
      }
      out.push(r);
      o.onStep?.({ ok: r.ok, at: Date.now(), phase: "wash", address: r.from, note: `→ ${to.slice(0, 6)}… (${r.tokens} tokens, slice ${i + 1}/${pair.wash.length})`, signature: r.signature, error: r.error ?? undefined });
    }
  }
  // label fresh wash wallets after their source
  let relabelled = false;
  for (const pair of pairs) {
    pair.wash.forEach((w, i) => {
      const m = st.walletMeta.meta[w];
      if (m && /^wash-\d+$/.test(m.label ?? "")) {
        m.label = `wash-${(st.walletMeta.meta[pair.source]?.label ?? pair.source.slice(0, 4)).slice(0, 16)}${pair.wash.length > 1 ? `-${i + 1}` : ""}`;
        relabelled = true;
      }
    });
  }
  if (relabelled) saveWalletMeta(st);
  if (out.length) logActivity(st, { kind: "wash", ok: out.some((x) => x.ok), message: `Wash ${mint.slice(0, 6)}…: ${out.filter((x) => x.ok).length}/${out.length} slice(s) moved across ${pairs.length} pair(s).`, mint, wallets: [...new Set(pairs.flatMap((p) => [p.source, ...p.wash]))], data: { results: out } });
  return out;
}

/** legacy helper (POST /api/dev/wash without pairs): every listed wallet → one FRESH wallet */
export async function washTokens(mint: string, wallets: string[], onStep?: (s: JobStep) => void, cuPrice?: number): Promise<WashResult[]> {
  requireUnlocked();
  const conn = readConn();
  const mintPk = new PublicKey(mint);
  const sources = vaultWallets(wallets);
  const tokenProgram = await tokenProgramOf(conn, mintPk);
  const balances = await readBalancesChunked(conn, sources.map((w) => w.address), mint, tokenProgram);
  const holders = balances.filter((b) => b.tokens !== null && b.tokens > BigInt(0)).map((b) => b.owner);
  if (holders.length === 0) return [];
  const pairs = resolveWashPairs({ sources: holders, perSource: 1, autoPairFrom: "fresh" });
  return washPairs(mint, pairs, { onStep, cuPrice });
}
