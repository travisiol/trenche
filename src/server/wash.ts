/* Wash task (Block X): move every token of the listed wallets to FRESH vault wallets by SPL transfer.
 * The source wallet pays the fresh wallet's ATA rent + fee; the fresh wallet needs no SOL.
 * Fresh wallets are generated into the vault (label `wash-<n>`, group "wash"). */
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { latestBlockhash, sendAndConfirm } from "@/engine/solana/send.js";
import { ATA_PROGRAM, associatedTokenAddress } from "@/engine/solana/pump/pdas.js";
import type { JobStep } from "@/lib/types";
import { readBalancesChunked, readConn, requireUnlocked, sendConn, tokenProgramOf, vaultWallets } from "./engine";
import { logActivity, saveWalletMeta, store } from "./store";
import { createGroup, generateWallets } from "./wallets";

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });

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

export type WashResult = { from: string; to: string; tokens: string; ok: boolean; signature: string | null; error: string | null };

/** returns one result per source wallet that held tokens; `onStep` for live progress */
export async function washTokens(mint: string, wallets: string[], onStep?: (s: JobStep) => void, cuPrice?: number): Promise<WashResult[]> {
  requireUnlocked();
  const st = store();
  const conn = readConn();
  const mintPk = new PublicKey(mint);
  const sources = vaultWallets(wallets);
  const tokenProgram = await tokenProgramOf(conn, mintPk);
  const balances = await readBalancesChunked(conn, sources.map((w) => w.address), mint, tokenProgram);
  const holders = balances.filter((b) => b.tokens !== null && b.tokens > BigInt(0));
  const out: WashResult[] = [];
  if (holders.length === 0) return out;
  let group = st.walletMeta.groups.find((g) => g.name === "wash");
  if (!group) group = createGroup("wash");
  const fresh = generateWallets(holders.length, "wash", group.id);
  const price = cuPrice ?? st.settings.cuPrice;
  for (let i = 0; i < holders.length; i++) {
    const h = holders[i];
    const to = fresh[i];
    const kp = st.sol.keypair(h.owner);
    const toPk = new PublicKey(to);
    const r: WashResult = { from: h.owner, to, tokens: (Number(h.tokens) / 1e6).toString(), ok: false, signature: null, error: null };
    try {
      const { blockhash, lastValidBlockHeight } = await latestBlockhash(conn);
      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
        createAtaIdempotent(kp.publicKey, toPk, mintPk, tokenProgram),
        transferChecked(associatedTokenAddress(kp.publicKey, mintPk, tokenProgram), mintPk, associatedTokenAddress(toPk, mintPk, tokenProgram), kp.publicKey, h.tokens!, 6, tokenProgram),
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
    onStep?.({ ok: r.ok, at: Date.now(), phase: "wash", address: r.from, note: `→ ${to.slice(0, 6)}… (${r.tokens} tokens)`, signature: r.signature, error: r.error ?? undefined });
  }
  // label fresh wallets after their source
  for (let i = 0; i < holders.length; i++) {
    const m = st.walletMeta.meta[fresh[i]];
    if (m) m.label = `wash-${(st.walletMeta.meta[holders[i].owner]?.label ?? holders[i].owner.slice(0, 4)).slice(0, 20)}`;
  }
  saveWalletMeta(st);
  logActivity(st, { kind: "wash", ok: out.some((o) => o.ok), message: `Wash ${mint.slice(0, 6)}…: ${out.filter((o) => o.ok).length}/${out.length} wallet(s) moved to fresh wallets.`, mint, wallets: [...holders.map((h) => h.owner), ...fresh], data: { results: out } });
  return out;
}
