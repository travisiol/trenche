/* Solana → Robinhood Chain bridge through Relay (api.relay.link): SOL from one vault wallet arrives as ETH on the
 * Robinhood dev wallet. One way, direct: the vault wallet signs Relay's deposit instruction, Relay's solver pays the
 * ETH on chain 4663 (~1–10 s), the status is read from Relay's intents API. Checked 2026-10-06: 0.1 SOL → 0.00440 ETH,
 * 0.81 % total cost, quote time estimate 1 s. */
import { join } from "node:path";
import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { sendAndConfirm } from "@/engine/solana/send.js";
import { HttpError, solString } from "../api";
import { readConn, requireUnlocked, sendConn } from "../engine";
import { logActivity, readJson, store, writeJson } from "../store";
import { evmAccount, evmIsOwn, rhDir } from "./wallet";

const RELAY = "https://api.relay.link";
const SOLANA_ID = 792703809;
const SOL_NATIVE = "11111111111111111111111111111111";
const ETH_NATIVE = "0x0000000000000000000000000000000000000000";
/** what stays on the source wallet after a bridge: ≥ rent-exempt minimum (890 880) + room for the tx fee */
export const BRIDGE_KEEP_LAMPORTS = BigInt(1_000_000);
const CU_PRICE = 100_000;

export type BridgeQuote = {
  from: string;
  to: string;
  inLamports: string;
  outWei: string;
  minOutWei: string;
  outUsd: number | null;
  inUsd: number | null;
  feeLamports: string;
  impactPct: number | null;
  seconds: number;
  requestId: string;
};

export type BridgeStatus = "sending" | "deposited" | "pending" | "success" | "failure" | "refunded";
export type BridgeRecord = BridgeQuote & {
  id: string;
  at: number;
  status: BridgeStatus;
  solSignature: string | null;
  destTxs: string[];
  error: string | null;
  doneAt: number | null;
};

type RelayIx = { keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; programId: string; data: string };
type RelayStep = { id: string; kind: string; items: { status: string; data: { instructions?: RelayIx[]; addressLookupTableAddresses?: string[] } }[] };
type RelayQuoteRes = {
  requestId?: string;
  steps?: RelayStep[];
  fees?: Record<string, { amount?: string; currency?: { chainId?: number } }>;
  details?: {
    currencyIn?: { amount?: string; amountUsd?: string };
    currencyOut?: { amount?: string; minimumAmount?: string; amountUsd?: string };
    totalImpact?: { percent?: string };
    timeEstimate?: number;
  };
  message?: string;
};

const recordsPath = () => join(rhDir(), "bridges.json");
function records(): BridgeRecord[] {
  const rt = store().runtime as { rhBridges?: BridgeRecord[] };
  if (!rt.rhBridges) rt.rhBridges = readJson<BridgeRecord[]>(recordsPath(), []);
  return rt.rhBridges;
}
function save(): void {
  try {
    writeJson(recordsPath(), records().slice(0, 200));
  } catch {
    /* disk error: memory only */
  }
}
export function bridgeHistory(): BridgeRecord[] {
  return records();
}

async function relayQuote(from: string, to: string, lamports: bigint): Promise<{ quote: BridgeQuote; steps: RelayStep[] }> {
  let res: Response;
  try {
    res = await fetch(`${RELAY}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: from,
        recipient: to,
        originChainId: SOLANA_ID,
        destinationChainId: 4663,
        originCurrency: SOL_NATIVE,
        destinationCurrency: ETH_NATIVE,
        amount: lamports.toString(),
        tradeType: "EXACT_INPUT",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new HttpError(502, `Relay not reachable: ${e instanceof Error ? e.message : e}`);
  }
  const j = (await res.json().catch(() => ({}))) as RelayQuoteRes;
  if (!res.ok || !j.steps?.length || !j.details?.currencyOut?.amount) throw new HttpError(res.status >= 500 ? 502 : 400, `Relay refused the quote: ${j.message ?? res.status}`);
  let fee = BigInt(0);
  for (const [k, f] of Object.entries(j.fees ?? {})) if (["gas", "relayer"].includes(k) && f.currency?.chainId === SOLANA_ID && f.amount) fee += BigInt(f.amount);
  const num = (s?: string) => (s !== undefined && Number.isFinite(Number(s)) ? Number(s) : null);
  return {
    steps: j.steps,
    quote: {
      from,
      to,
      inLamports: lamports.toString(),
      outWei: j.details.currencyOut.amount,
      minOutWei: j.details.currencyOut.minimumAmount ?? j.details.currencyOut.amount,
      outUsd: num(j.details.currencyOut.amountUsd),
      inUsd: num(j.details.currencyIn?.amountUsd),
      feeLamports: fee.toString(),
      impactPct: num(j.details.totalImpact?.percent),
      seconds: j.details.timeEstimate ?? 10,
      requestId: j.requestId ?? "",
    },
  };
}

async function checkSource(from: string, lamports: bigint): Promise<void> {
  const st = store();
  if (!st.sol.wallets.some((w) => w.address === from)) throw new HttpError(404, `Wallet ${from.slice(0, 8)}… is not in the vault.`);
  const bal = await getSolBalance(readConn(), from);
  if (bal < lamports + BRIDGE_KEEP_LAMPORTS)
    throw new HttpError(400, `${from.slice(0, 6)}… holds ${solString(bal)} SOL: bridging ${solString(lamports)} needs ${solString(lamports + BRIDGE_KEEP_LAMPORTS)} (0.001 SOL stays for rent + fee). Nothing was sent.`);
}

/** destination: one of the Robinhood wallets (the main one by default) */
function destination(to?: string | null): string {
  if (to && !evmIsOwn(to)) throw new HttpError(400, "Destination: one of your Robinhood wallets.");
  return evmAccount(to).address;
}

export async function bridgeQuote(from: string, lamports: bigint, toWallet?: string | null): Promise<BridgeQuote> {
  requireUnlocked();
  const to = destination(toWallet);
  return (await relayQuote(from, to, lamports)).quote;
}

/** sign + send Relay's deposit from the vault wallet, then follow the fill in the background */
export async function bridgeExecute(from: string, lamports: bigint, seenOutWei: bigint | null, toWallet?: string | null): Promise<BridgeRecord> {
  requireUnlocked();
  const st = store();
  const to = destination(toWallet);
  await checkSource(from, lamports);
  const { quote, steps } = await relayQuote(from, to, lamports);
  // the quote moved by more than 3 % since the one on screen: show the new one instead of sending
  if (seenOutWei !== null && BigInt(quote.outWei) * BigInt(100) < seenOutWei * BigInt(97))
    throw new HttpError(409, `The rate moved: ${(Number(quote.outWei) / 1e18).toFixed(6)} ETH now vs ${(Number(seenOutWei) / 1e18).toFixed(6)} quoted. Re-check the quote.`);
  const items = steps.flatMap((s) => {
    if (s.kind !== "transaction") throw new HttpError(502, `Relay asked for a '${s.kind}' step, only Solana transactions are supported. Nothing was sent.`);
    return s.items.filter((i) => i.status !== "complete");
  });
  if (!items.length || items.some((i) => !i.data.instructions?.length)) throw new HttpError(502, "Relay returned no Solana instruction. Nothing was sent.");

  const rec: BridgeRecord = { ...quote, id: "br_" + Date.now().toString(36), at: Date.now(), status: "sending", solSignature: null, destTxs: [], error: null, doneAt: null };
  records().unshift(rec);
  save();

  const kp = st.sol.keypair(from);
  const conn = readConn();
  try {
    for (const item of items) {
      const alts: AddressLookupTableAccount[] = [];
      for (const a of item.data.addressLookupTableAddresses ?? []) {
        const t = (await conn.getAddressLookupTable(new PublicKey(a))).value;
        if (!t) throw new Error(`lookup table ${a} not found`);
        alts.push(t);
      }
      const ixs = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE }),
        ...item.data.instructions!.map(
          (ix) =>
            new TransactionInstruction({
              programId: new PublicKey(ix.programId),
              keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
              data: Buffer.from(ix.data.replace(/^0x/, ""), "hex"),
            }),
        ),
      ];
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts));
      tx.sign([kp]);
      const r = await sendAndConfirm(conn, sendConn(), tx, { lastValidBlockHeight, simulateConn: conn });
      rec.solSignature = r.signature;
      if (!r.confirmed) throw new Error(r.error ?? "deposit not confirmed");
    }
  } catch (e) {
    rec.status = "failure";
    rec.error = `Solana deposit failed: ${e instanceof Error ? e.message : e}`.slice(0, 300);
    rec.doneAt = Date.now();
    save();
    logActivity(st, { kind: "fund", ok: false, message: `Bridge to Robinhood failed (${solString(lamports)} SOL from ${from.slice(0, 6)}…): ${rec.error}`, wallets: [from] });
    throw new HttpError(502, rec.error);
  }
  rec.status = "deposited";
  save();
  logActivity(st, { kind: "fund", ok: true, message: `Bridge to Robinhood: ${solString(lamports)} SOL from ${from.slice(0, 6)}… deposited to Relay → ~${(Number(quote.outWei) / 1e18).toFixed(5)} ETH to ${to.slice(0, 8)}…`, wallets: [from], signature: rec.solSignature ?? undefined });
  void follow(rec);
  return rec;
}

/** read Relay's status until the ETH is paid (or refunded / failed), 10 min max */
async function follow(rec: BridgeRecord): Promise<void> {
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const r = await fetch(`${RELAY}/intents/status/v2?requestId=${rec.requestId}`, { signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { status?: string; txHashes?: string[]; details?: string };
      const s = j.status ?? "";
      if (Array.isArray(j.txHashes) && j.txHashes.length) rec.destTxs = j.txHashes;
      if (s === "success") {
        rec.status = "success";
        rec.doneAt = Date.now();
        save();
        logActivity(store(), { kind: "fund", ok: true, message: `Bridge to Robinhood filled: ETH arrived on ${rec.to.slice(0, 8)}… (${Math.round((rec.doneAt - rec.at) / 1000)} s).` });
        return;
      }
      if (s === "refund" || s === "refunded" || s === "failure") {
        rec.status = s === "failure" ? "failure" : "refunded";
        rec.error = j.details ?? (s === "failure" ? "Relay could not fill the bridge." : "Relay refunded the SOL to the source wallet.");
        rec.doneAt = Date.now();
        save();
        logActivity(store(), { kind: "fund", ok: false, message: `Bridge to Robinhood ${rec.status}: ${rec.error}` });
        return;
      }
      if (s === "pending" || s === "submitted" || s === "delayed") {
        if (rec.status !== "pending") {
          rec.status = "pending";
          save();
        }
      }
    } catch {
      /* Relay unreachable for a moment: keep reading */
    }
  }
  rec.error = "No fill seen after 10 min — check the request on relay.link.";
  save();
}

/** a bridge restored from disk that was still in flight when the server stopped: read its status again */
export function resumeBridges(): void {
  const rt = store().runtime as { rhBridgesResumed?: boolean };
  if (rt.rhBridgesResumed) return;
  rt.rhBridgesResumed = true;
  for (const r of records()) if ((r.status === "deposited" || r.status === "pending") && Date.now() - r.at < 60 * 60_000) void follow(r);
}
