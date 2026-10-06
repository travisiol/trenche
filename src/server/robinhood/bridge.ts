/* Solana ⇄ Robinhood Chain bridge through Relay (api.relay.link): SOL from one vault wallet arrives as ETH on the
 * Robinhood dev wallet. One way, direct: the vault wallet signs Relay's deposit instruction, Relay's solver pays the
 * ETH on chain 4663 (~1–10 s), the status is read from Relay's intents API. Checked 2026-10-06: 0.1 SOL → 0.00440 ETH,
 * 0.81 % total cost, quote time estimate 1 s. */
import { join } from "node:path";
import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getSolBalance } from "@/engine/solana/rpc.js";
import { sendAndConfirm } from "@/engine/solana/send.js";
import { HttpError, lamportsOf, solString } from "../api";
import { readConn, requireUnlocked, sendConn } from "../engine";
import { logActivity, readJson, store, writeJson } from "../store";
import { weiOf } from "./amount";
import { rhPublic, rhWallet } from "./chain";
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
  /** missing = Solana → Robinhood; "rh2sol" = ETH on Robinhood → SOL on a vault wallet (amounts in inWei / outLamports) */
  dir?: "rh2sol";
  inWei?: string;
  outLamports?: string;
  minOutLamports?: string;
  /** the Robinhood deposit tx (rh2sol) */
  evmTx?: string | null;
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

/** POST /quote, waiting out Relay's rate limit (429) a few times — a batch quotes several legs at once */
async function relayQuoteFetch(body: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${RELAY}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (res.status !== 429 || attempt >= 3) return res;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function relayQuote(from: string, to: string, lamports: bigint): Promise<{ quote: BridgeQuote; steps: RelayStep[] }> {
  let res: Response;
  try {
    res = await relayQuoteFetch({
      user: from,
      recipient: to,
      originChainId: SOLANA_ID,
      destinationChainId: 4663,
      originCurrency: SOL_NATIVE,
      destinationCurrency: ETH_NATIVE,
      amount: lamports.toString(),
      tradeType: "EXACT_INPUT",
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

  const rec: BridgeRecord = { ...quote, id: "br_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), status: "sending", solSignature: null, destTxs: [], error: null, doneAt: null };
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
        logActivity(store(), {
          kind: "fund",
          ok: true,
          message:
            rec.dir === "rh2sol"
              ? `Bridge to Solana filled: SOL arrived on ${rec.to.slice(0, 6)}… (${Math.round((rec.doneAt - rec.at) / 1000)} s).`
              : `Bridge to Robinhood filled: ETH arrived on ${rec.to.slice(0, 8)}… (${Math.round((rec.doneAt - rec.at) / 1000)} s).`,
        });
        return;
      }
      if (s === "refund" || s === "refunded" || s === "failure") {
        rec.status = s === "failure" ? "failure" : "refunded";
        rec.error = j.details ?? (s === "failure" ? "Relay could not fill the bridge." : `Relay refunded the ${rec.dir === "rh2sol" ? "ETH" : "SOL"} to the source wallet.`);
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

/* ------------------------------------------------------------------ Robinhood → Solana */

/* ETH from a Robinhood wallet arrives as SOL on one of the vault's Solana wallets. One way, direct, one destination:
 * the Robinhood wallet sends Relay's deposit tx on chain 4663 (native ETH, no approve), Relay's solver pays the SOL.
 * Checked 2026-10-06: 0.0003 ETH → 0.00655 SOL, one deposit step, gas ~35 k. */

type EvmStepData = { to?: string; data?: string; value?: string; chainId?: number; gas?: string };
type EvmStep = { kind: string; items: { status: string; data: EvmStepData }[] };

export type BridgeBackQuote = { from: string; to: string; inWei: string; outLamports: string; minOutLamports: string; outUsd: number | null; inUsd: number | null; impactPct: number | null; seconds: number; requestId: string };

function solDestination(to: string): string {
  if (!store().sol.wallets.some((w) => w.address === to)) throw new HttpError(400, "Destination: one of your Solana vault wallets.");
  return to;
}

async function relayBackQuote(from: string, to: string, wei: bigint): Promise<{ quote: BridgeBackQuote; steps: EvmStep[] }> {
  let res: Response;
  try {
    res = await relayQuoteFetch({ user: from, recipient: to, originChainId: 4663, destinationChainId: SOLANA_ID, originCurrency: ETH_NATIVE, destinationCurrency: SOL_NATIVE, amount: wei.toString(), tradeType: "EXACT_INPUT" });
  } catch (e) {
    throw new HttpError(502, `Relay not reachable: ${e instanceof Error ? e.message : e}`);
  }
  const j = (await res.json().catch(() => ({}))) as Omit<RelayQuoteRes, "steps"> & { steps?: EvmStep[] };
  if (!res.ok || !j.steps?.length || !j.details?.currencyOut?.amount) throw new HttpError(res.status >= 500 ? 502 : 400, `Relay refused the quote: ${j.message ?? res.status}`);
  const num = (v?: string) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    steps: j.steps,
    quote: {
      from,
      to,
      inWei: wei.toString(),
      outLamports: j.details.currencyOut.amount,
      minOutLamports: j.details.currencyOut.minimumAmount ?? j.details.currencyOut.amount,
      outUsd: num(j.details.currencyOut.amountUsd),
      inUsd: num(j.details.currencyIn?.amountUsd),
      impactPct: num(j.details.totalImpact?.percent),
      seconds: j.details.timeEstimate ?? 10,
      requestId: j.requestId ?? "",
    },
  };
}

export async function bridgeBackQuote(fromEvm: string | null, wei: bigint, toSol: string): Promise<BridgeBackQuote> {
  requireUnlocked();
  return (await relayBackQuote(evmAccount(fromEvm).address, solDestination(toSol), wei)).quote;
}

export async function bridgeBackExecute(fromEvm: string | null, wei: bigint, toSol: string, seenOutLamports: bigint | null): Promise<BridgeRecord> {
  requireUnlocked();
  const st = store();
  const acct = evmAccount(fromEvm);
  const to = solDestination(toSol);
  const { quote, steps } = await relayBackQuote(acct.address, to, wei);
  if (seenOutLamports !== null && BigInt(quote.outLamports) * BigInt(100) < seenOutLamports * BigInt(97))
    throw new HttpError(409, `The rate moved: ${solString(BigInt(quote.outLamports))} SOL now vs ${solString(seenOutLamports)} quoted. Re-check the quote.`);
  const items = steps.flatMap((s) => {
    if (s.kind !== "transaction") throw new HttpError(502, `Relay asked for a '${s.kind}' step, only transactions are supported. Nothing was sent.`);
    return s.items.filter((i) => i.status !== "complete");
  });
  if (!items.length || items.some((i) => !i.data.to || i.data.chainId !== 4663)) throw new HttpError(502, "Relay returned no Robinhood Chain transaction. Nothing was sent.");
  const pub = rhPublic();
  const fees = await pub.estimateFeesPerGas();
  const maxFee = (fees.maxFeePerGas ?? BigInt(0)) * BigInt(2);
  const gasOf = (i: { data: EvmStepData }) => (BigInt(i.data.gas ?? "100000") * BigInt(13)) / BigInt(10);
  const total = items.reduce((t, i) => t + BigInt(i.data.value ?? "0") + gasOf(i) * maxFee, BigInt(0));
  const bal = await pub.getBalance({ address: acct.address });
  if (bal < total) throw new HttpError(400, `${acct.address.slice(0, 8)}… holds ${(Number(bal) / 1e18).toFixed(6)} ETH: this bridge needs ${(Number(total) / 1e18).toFixed(6)} ETH with gas. Nothing was sent.`);

  const rec: BridgeRecord = {
    dir: "rh2sol",
    from: acct.address,
    to,
    inWei: quote.inWei,
    outLamports: quote.outLamports,
    minOutLamports: quote.minOutLamports,
    // Solana → Robinhood field names, kept filled for older readers of bridges.json
    inLamports: "0",
    outWei: "0",
    minOutWei: "0",
    outUsd: quote.outUsd,
    inUsd: quote.inUsd,
    feeLamports: "0",
    impactPct: quote.impactPct,
    seconds: quote.seconds,
    requestId: quote.requestId,
    evmTx: null,
    id: "br_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    status: "sending",
    solSignature: null,
    destTxs: [],
    error: null,
    doneAt: null,
  };
  records().unshift(rec);
  save();
  const wallet = rhWallet(acct);
  try {
    for (const i of items) {
      const hash = await wallet.sendTransaction({ account: acct, chain: wallet.chain, to: i.data.to as `0x${string}`, data: (i.data.data ?? "0x") as `0x${string}`, value: BigInt(i.data.value ?? "0"), gas: gasOf(i), maxFeePerGas: maxFee, maxPriorityFeePerGas: BigInt(0) });
      rec.evmTx = hash;
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 500 });
      if (r.status !== "success") throw new Error(`deposit reverted (${hash})`);
    }
  } catch (e) {
    rec.status = "failure";
    rec.error = `Robinhood deposit failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`.slice(0, 300);
    rec.doneAt = Date.now();
    save();
    logActivity(st, { kind: "fund", ok: false, message: `Bridge to Solana failed (${(Number(wei) / 1e18).toFixed(6)} ETH from ${acct.address.slice(0, 8)}…): ${rec.error}` });
    throw new HttpError(502, rec.error);
  }
  rec.status = "deposited";
  save();
  logActivity(st, { kind: "fund", ok: true, message: `Bridge to Solana: ${(Number(wei) / 1e18).toFixed(6)} ETH from ${acct.address.slice(0, 8)}… deposited to Relay → ~${solString(BigInt(quote.outLamports))} SOL to ${to.slice(0, 6)}…`, wallets: [to], data: { chain: "robinhood", tx: rec.evmTx } });
  void follow(rec);
  return rec;
}

/* ------------------------------------------------------------------ batch */

/* Several source wallets bridged to ONE destination in one click, both directions (Solana vault wallets → one
 * Robinhood wallet, Robinhood wallets → one vault wallet). Each leg is the single bridge above — same balance check,
 * same re-quote, same "rate moved" guard — run 4 at a time; one failed leg does not stop the others. */

export const BATCH_MAX = 50;
const BATCH_CONCURRENCY = 4;
/** a Max leg on Solana also leaves the deposit's own fee (priority included) on top of BRIDGE_KEEP_LAMPORTS */
const MAX_SOL_FEE = BigInt(200_000);
/** a Max leg on Robinhood leaves this much gas (the deposit uses ~35 k) at twice the current fee */
const MAX_EVM_GAS = BigInt(150_000);

/** amount: a decimal amount, or "max" (everything the wallet can send); seen: the output shown on screen */
export type BatchLegIn = { from: string; amount: string; seen?: string | null };
export type BatchLegOut<T> = { from: string; ok: boolean; result: T | null; error: string | null };

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function checkLegs(legs: BatchLegIn[], caseless: boolean): BatchLegIn[] {
  if (!Array.isArray(legs) || !legs.length) throw new HttpError(400, "Pick at least one source wallet.");
  if (legs.length > BATCH_MAX) throw new HttpError(400, `${BATCH_MAX} wallets per batch at most.`);
  const seen = new Set<string>();
  for (const l of legs) {
    if (!l || typeof l.from !== "string" || !l.from) throw new HttpError(400, "Each leg needs a source wallet.");
    const k = caseless ? l.from.toLowerCase() : l.from;
    if (seen.has(k)) throw new HttpError(400, `${l.from.slice(0, 8)}… is in the batch twice.`);
    seen.add(k);
  }
  return legs;
}

const legError = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const seenOf = (v: unknown) => (typeof v === "string" && /^[0-9]+$/.test(v) ? BigInt(v) : null);
const isMax = (leg: BatchLegIn) => String(leg.amount ?? "").trim().toLowerCase() === "max";

async function runLegs<T>(legs: BatchLegIn[], caseless: boolean, fn: (leg: BatchLegIn) => Promise<T>): Promise<BatchLegOut<T>[]> {
  return pool(checkLegs(legs, caseless), BATCH_CONCURRENCY, async (leg) => {
    try {
      return { from: leg.from, ok: true, result: await fn(leg), error: null };
    } catch (e) {
      return { from: leg.from, ok: false, result: null, error: legError(e) };
    }
  });
}

async function solLegLamports(leg: BatchLegIn): Promise<bigint> {
  if (!isMax(leg)) return lamportsOf(leg.amount, "amount");
  const bal = await getSolBalance(readConn(), leg.from);
  const lam = bal - BRIDGE_KEEP_LAMPORTS - MAX_SOL_FEE;
  if (lam <= BigInt(0)) throw new HttpError(400, `${leg.from.slice(0, 6)}… holds ${solString(bal)} SOL: nothing left after the 0.0012 SOL kept for rent + fee.`);
  return lam;
}

/** Solana → Robinhood, quotes only: what each leg would send and receive */
export async function bridgeBatchQuote(legs: BatchLegIn[], toWallet?: string | null): Promise<BatchLegOut<BridgeQuote>[]> {
  requireUnlocked();
  const to = destination(toWallet);
  return runLegs(legs, false, async (leg) => (await relayQuote(leg.from, to, await solLegLamports(leg))).quote);
}

export async function bridgeBatchExecute(legs: BatchLegIn[], toWallet?: string | null): Promise<BatchLegOut<BridgeRecord>[]> {
  requireUnlocked();
  const to = destination(toWallet);
  return runLegs(legs, false, async (leg) => bridgeExecute(leg.from, await solLegLamports(leg), seenOf(leg.seen), to));
}

/** the gas price read once per batch (twice the estimate, like bridgeBackExecute) */
function batchMaxFee(): () => Promise<bigint> {
  let p: Promise<bigint> | null = null;
  return () => (p ??= rhPublic().estimateFeesPerGas().then((f) => (f.maxFeePerGas ?? BigInt(0)) * BigInt(2)));
}

async function evmLegWei(leg: BatchLegIn, maxFee: () => Promise<bigint>): Promise<bigint> {
  if (!isMax(leg)) return weiOf(leg.amount);
  const addr = evmAccount(leg.from).address;
  const bal = await rhPublic().getBalance({ address: addr });
  const wei = bal - MAX_EVM_GAS * (await maxFee());
  if (wei <= BigInt(0)) throw new HttpError(400, `${addr.slice(0, 8)}… holds ${(Number(bal) / 1e18).toFixed(6)} ETH: nothing left after the gas.`);
  return wei;
}

/** Robinhood → Solana, quotes only */
export async function bridgeBackBatchQuote(legs: BatchLegIn[], toSol: string): Promise<BatchLegOut<BridgeBackQuote>[]> {
  requireUnlocked();
  const to = solDestination(toSol);
  const fee = batchMaxFee();
  return runLegs(legs, true, async (leg) => (await relayBackQuote(evmAccount(leg.from).address, to, await evmLegWei(leg, fee))).quote);
}

export async function bridgeBackBatchExecute(legs: BatchLegIn[], toSol: string): Promise<BatchLegOut<BridgeRecord>[]> {
  requireUnlocked();
  const to = solDestination(toSol);
  const fee = batchMaxFee();
  return runLegs(legs, true, async (leg) => bridgeBackExecute(leg.from, await evmLegWei(leg, fee), to, seenOf(leg.seen)));
}
