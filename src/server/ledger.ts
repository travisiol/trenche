/* On-chain ledger of the vault wallets — the source of truth for PnL.
 *
 * For every vault wallet the signature history is read (getSignaturesForAddress, paginated, through the RPC queue)
 * and each transaction is fetched ONCE (getParsedTransaction) and compacted into a LedgerTx kept on disk
 * (ledger.json in the data dir): per-account SOL deltas, per-owner token deltas, parsed system transfers, pump.fun
 * events, accounts created/closed. A per-wallet high-water mark (newest signature seen) makes later scans
 * incremental; transactions still queued are fetched a budget at a time so a fresh install never floods the RPC.
 *
 * PnL (ledgerPnl): a vault wallet's SOL delta in a transaction is everything that happened to it — buy cost with the
 * pump fee, sell proceeds, signature + priority fee, Jito tip, rent paid or refunded, claims. Transactions are
 * classified from the wallet's point of view (trade / create / claim / internal transfer / deposit / withdraw / tip /
 * other); transfers and capital flows are EXCLUDED from the PnL (only their fees count). The journal
 * (activity.json) is no longer consulted for figures. */
import { PublicKey, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction, type TokenBalance } from "@solana/web3.js";
import { JITO_BUNDLE_TIP_ACCOUNTS, JITO_TIP_ACCOUNTS } from "@/engine/solana/config.js";
import { parseTxEvents } from "@/engine/solana/pump/events.js";
import { PUMP_BUYBACK_FEE_RECIPIENTS, PUMP_FEE_RECIPIENTS, PUMP_PROGRAM, bondingCurvePda } from "@/engine/solana/pump/pdas.js";
import type { DayBreakdown, FeeBreakdown, LedgerStatus, MintPnl, PnlWindow } from "@/lib/types";
import { isPublicRpc, readConn } from "./engine";
import { feedCard } from "./feed";
import { metaCached } from "./metadata";
import { creatorFeesByDay, creatorRevenueByMint } from "./creatorRevenue";
import { readJson, store, writeJson } from "./store";

export type LedgerTx = {
  sig: string;
  slot: number;
  /** epoch ms (blockTime × 1000; 0 when the node did not return it) */
  at: number;
  err: boolean;
  /** lamports */
  fee: string;
  payer: string;
  /** number of signatures (base fee = 5000 × sigs) */
  sigs: number;
  /** non-zero lamport deltas per account */
  sol: Record<string, string>;
  /** raw token deltas per owner × mint */
  tokens: { owner: string; mint: string; delta: string }[];
  /** parsed system transfers (top-level + inner) */
  transfers: { from: string; to: string; lamports: string }[];
  /** pump.fun events of the transaction */
  pump: { kind: "buy" | "sell" | "create" | "claim"; mint: string | null; user: string; sol: string; fee: string; creatorFee: string }[];
  /** accounts that went 0 → >0 / >0 → 0 (rent paid / recovered), with their lamports */
  created: Record<string, string>;
  closed: Record<string, string>;
  programs: string[];
};

type LedgerFile = {
  /** 2 = pump events from inner instructions */
  v: number;
  wallets: Record<string, { newest: string | null; complete: boolean; scannedAt: number }>;
  /** signatures queued for fetching (newest first) */
  pending: string[];
  /** fetch attempts per pending signature */
  attempts: Record<string, number>;
  txs: Record<string, LedgerTx>;
  scannedAt: number | null;
};

const PUMP_PROGRAM_STR = PUMP_PROGRAM;
const TIP_SET = new Set<string>([...JITO_TIP_ACCOUNTS, ...JITO_BUNDLE_TIP_ACCOUNTS]);
const FEE_RECIPIENTS = new Set<string>([...PUMP_FEE_RECIPIENTS, ...PUMP_BUYBACK_FEE_RECIPIENTS]);
const BASE_FEE = 5000;
const MAX_ATTEMPTS = 5;
/** first scan of a wallet stops after this many signatures (older history is never read) */
const MAX_SIGNATURES_PER_WALLET = 5000;
/** relay hop loss accepted as a transfer fee (anything bigger is a real capital movement) */
const RELAY_LOSS_MAX_LAMPORTS = 10_000_000;

const g = globalThis as unknown as { __trenchLedger?: { file: LedgerFile | null; path: string; running: Promise<void> | null; lastRun: number } };
const S = (g.__trenchLedger ??= { file: null, path: "", running: null, lastRun: 0 });

function ledgerPath(): string {
  const st = store();
  return (st.paths as Record<string, string>).ledger ?? `${st.dir}/ledger.json`;
}

function file(): LedgerFile {
  const p = ledgerPath();
  if (S.file && S.path === p) return S.file;
  const f = readJson<LedgerFile>(p, { v: 2, wallets: {}, pending: [], attempts: {}, txs: {}, scannedAt: null });
  f.wallets ??= {};
  f.pending ??= [];
  f.attempts ??= {};
  f.txs ??= {};
  // v2 (2026-10-06): pump.fun events read from inner instructions — transactions compacted from truncated logs are
  // fetched again (they lost the trade events of buys carried inside a create)
  if ((f.v ?? 1) < 2) {
    for (const [sig, t] of Object.entries(f.txs))
      if (t.programs?.includes(PUMP_PROGRAM_STR) || t.pump?.length) {
        delete f.txs[sig];
        if (!f.pending.includes(sig)) f.pending.push(sig);
      }
    f.attempts = {};
    f.v = 2;
  }
  S.file = f;
  S.path = p;
  return f;
}

function save(): void {
  try {
    writeJson(ledgerPath(), file());
  } catch {
    /* disk error: the ledger stays in memory and is rebuilt on restart */
  }
}

/** extra addresses to cover read-only (diagnostics: TRENCH_LEDGER_WALLETS="addr,addr") */
const EXTRA_WALLETS = (process.env.TRENCH_LEDGER_WALLETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** addresses the ledger covers: the unlocked vault's wallets (else the wallets of the last scan) + TRENCH_LEDGER_WALLETS */
function ledgerWallets(): string[] {
  const st = store();
  const f = file();
  const base = st.sol.unlocked && st.sol.wallets.length ? st.sol.wallets.map((w) => w.address) : Object.keys(f.wallets).filter((w) => !EXTRA_WALLETS.includes(w));
  return [...new Set([...base, ...EXTRA_WALLETS])];
}

/** every address the ledger ever covered (wallets removed from the vault since included) + the current ones */
function historyWallets(): string[] {
  return [...new Set([...Object.keys(file().wallets), ...ledgerWallets()])];
}

/* ------------------------------------------------------------- parsing */

function compact(sig: string, tx: ParsedTransactionWithMeta): LedgerTx {
  const msg = tx.transaction.message;
  const keys = msg.accountKeys.map((k) => k.pubkey.toBase58());
  const meta = tx.meta;
  const sol: Record<string, string> = {};
  const created: Record<string, string> = {};
  const closed: Record<string, string> = {};
  if (meta) {
    for (let i = 0; i < keys.length; i++) {
      const pre = meta.preBalances[i] ?? 0;
      const post = meta.postBalances[i] ?? 0;
      if (post !== pre) sol[keys[i]] = String(post - pre);
      if (pre === 0 && post > 0) created[keys[i]] = String(post);
      if (pre > 0 && post === 0) closed[keys[i]] = String(pre);
    }
  }
  const tokenMap = new Map<string, bigint>();
  const addTok = (list: TokenBalance[] | null | undefined, sign: bigint) => {
    for (const b of list ?? []) {
      if (!b.owner) continue;
      const k = `${b.owner}|${b.mint}`;
      tokenMap.set(k, (tokenMap.get(k) ?? BigInt(0)) + sign * BigInt(b.uiTokenAmount.amount));
    }
  };
  addTok(meta?.preTokenBalances, BigInt(-1));
  addTok(meta?.postTokenBalances, BigInt(1));
  const tokens: LedgerTx["tokens"] = [];
  for (const [k, d] of tokenMap) {
    if (d === BigInt(0)) continue;
    const [owner, mint] = k.split("|");
    tokens.push({ owner, mint, delta: d.toString() });
  }
  const transfers: LedgerTx["transfers"] = [];
  const programs = new Set<string>();
  const visit = (ins: ParsedInstruction | PartiallyDecodedInstruction, top: boolean) => {
    const pid = ins.programId.toBase58();
    if (top) programs.add(pid);
    if ("parsed" in ins && ins.program === "system" && ins.parsed && typeof ins.parsed === "object") {
      const p = ins.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
      if ((p.type === "transfer" || p.type === "transferWithSeed") && p.info?.source && p.info.destination && typeof p.info.lamports === "number") transfers.push({ from: p.info.source, to: p.info.destination, lamports: String(p.info.lamports) });
    }
  };
  for (const ins of msg.instructions) visit(ins, true);
  for (const inner of meta?.innerInstructions ?? []) for (const ins of inner.instructions) visit(ins, false);
  const pump: LedgerTx["pump"] = [];
  if (meta?.logMessages && (programs.has(PUMP_PROGRAM_STR) || meta.logMessages.some((l) => l.includes(PUMP_PROGRAM_STR)))) {
    // inner instructions (emit_cpi): a create carrying several buys overflows the log budget and loses trade events
    for (const ev of parseTxEvents(tx as unknown as Parameters<typeof parseTxEvents>[0])) {
      if (ev.kind === "trade") pump.push({ kind: ev.isBuy ? "buy" : "sell", mint: ev.mint.toBase58(), user: ev.user.toBase58(), sol: ev.solAmount.toString(), fee: ev.fee.toString(), creatorFee: ev.creatorFee.toString() });
      else if (ev.kind === "create") pump.push({ kind: "create", mint: ev.mint.toBase58(), user: ev.user.toBase58(), sol: "0", fee: "0", creatorFee: "0" });
      else if (ev.kind === "collectCreatorFee") pump.push({ kind: "claim", mint: null, user: ev.creator.toBase58(), sol: ev.amount.toString(), fee: "0", creatorFee: "0" });
    }
  }
  return {
    sig,
    slot: tx.slot,
    at: tx.blockTime ? tx.blockTime * 1000 : 0,
    err: !!meta?.err,
    fee: String(meta?.fee ?? 0),
    payer: keys[0] ?? "",
    sigs: tx.transaction.signatures.length,
    sol,
    tokens,
    transfers,
    pump,
    created,
    closed,
    programs: [...programs],
  };
}

/* -------------------------------------------------------------- refresh */

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** scan new signatures of every wallet, then fetch up to `budget` queued transactions. Serialised; at most one
 *  run per `minIntervalMs` unless forced. */
export function refreshLedger(opts: { force?: boolean; minIntervalMs?: number; budget?: number } = {}): Promise<void> {
  if (S.running) return S.running;
  const now = Date.now();
  if (!opts.force && now - S.lastRun < (opts.minIntervalMs ?? 20_000)) return Promise.resolve();
  S.lastRun = now;
  S.running = (async () => {
    const f = file();
    const conn = readConn();
    const wallets = ledgerWallets();
    const pub = isPublicRpc();
    let changed = false;
    // 1. signatures (incremental per wallet)
    for (const w of wallets) {
      const rec = (f.wallets[w] ??= { newest: null, complete: false, scannedAt: 0 });
      let before: string | undefined;
      let first: string | null = null;
      let reached = !rec.newest;
      let scanned = 0;
      let ok = true;
      while (!(rec.newest && reached) && scanned < MAX_SIGNATURES_PER_WALLET) {
        const batch = await conn.getSignaturesForAddress(new PublicKey(w), { limit: 1000, before }, "confirmed").catch(() => null);
        if (!batch) {
          ok = false;
          break;
        }
        if (!batch.length) {
          reached = true;
          break;
        }
        for (const s of batch) {
          first ??= s.signature;
          if (rec.newest && s.signature === rec.newest) {
            reached = true;
            break;
          }
          scanned++;
          if (!f.txs[s.signature] && !f.pending.includes(s.signature)) {
            f.pending.push(s.signature);
            changed = true;
          }
        }
        if (reached || batch.length < 1000) {
          reached = true;
          break;
        }
        before = batch[batch.length - 1].signature;
      }
      if (ok && first) rec.newest = first;
      if (ok) rec.complete = reached;
      rec.scannedAt = Date.now();
      changed = true;
    }
    // 2. transactions (budgeted)
    const budget = opts.budget ?? (pub ? 40 : 200);
    const todo = f.pending.filter((s) => (f.attempts[s] ?? 0) < MAX_ATTEMPTS).slice(0, budget);
    if (todo.length) {
      const got = await mapLimit(todo, pub ? 2 : 6, async (sig) => {
        try {
          return await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        } catch {
          return undefined;
        }
      });
      for (let i = 0; i < todo.length; i++) {
        const sig = todo[i];
        const tx = got[i];
        if (tx) {
          f.txs[sig] = compact(sig, tx);
          f.pending = f.pending.filter((s) => s !== sig);
          delete f.attempts[sig];
        } else {
          f.attempts[sig] = (f.attempts[sig] ?? 0) + 1;
          if (tx === null && f.attempts[sig] >= 3) {
            // the node has no record of it (pruned history / dropped): stop asking
            f.pending = f.pending.filter((s) => s !== sig);
          }
        }
      }
      changed = true;
    }
    f.scannedAt = Date.now();
    if (changed) save();
  })().finally(() => {
    S.running = null;
  });
  return S.running;
}

/** the signatures of `sigs` the ledger has not read yet */
export function ledgerMissing(sigs: string[]): string[] {
  const f = file();
  return [...new Set(sigs)].filter((s) => !f.txs[s]);
}

const readingNow = new Set<string>();
/** read these transactions NOW, ahead of the scan queue (≤ 10 per call): the open launch's create and our trades
 *  that the live PnL knows of — the ledger's figure replaces the live estimate only once it holds every one of them */
export async function ledgerReadNow(sigs: string[]): Promise<void> {
  const todo = ledgerMissing(sigs).filter((s) => !readingNow.has(s)).slice(0, 10);
  if (!todo.length) return;
  todo.forEach((s) => readingNow.add(s));
  try {
    const conn = readConn();
    const got = await mapLimit(todo, 4, (sig) => conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null));
    const f = file();
    let changed = false;
    todo.forEach((sig, i) => {
      const tx = got[i];
      if (!tx || f.txs[sig]) return; // not visible yet at `confirmed`: the next call retries
      f.txs[sig] = compact(sig, tx);
      f.pending = f.pending.filter((s) => s !== sig);
      delete f.attempts[sig];
      changed = true;
    });
    if (changed) save();
  } finally {
    todo.forEach((s) => readingNow.delete(s));
  }
}

export function ledgerStatus(): LedgerStatus {
  const f = file();
  const wallets = ledgerWallets();
  const unreadable = Object.values(f.attempts).filter((n) => n >= MAX_ATTEMPTS).length;
  const covered = wallets.filter((w) => f.wallets[w]?.complete);
  return { complete: covered.length === wallets.length && f.pending.length - unreadable <= 0, pending: f.pending.length, txs: Object.keys(f.txs).length, unreadable, scannedAt: f.scannedAt, wallets: wallets.length };
}

/* ---------------------------------------------------------------- PnL */

type Kind = "trade" | "create" | "claim" | "internal" | "deposit" | "withdraw" | "tip" | "other";

/** one vault-level view of a transaction */
export type LedgerEntry = {
  sig: string;
  at: number;
  kind: Kind;
  mint: string | null;
  /** Σ SOL deltas of the vault wallets in the transaction (lamports) */
  delta: bigint;
  /** gross curve cash-flow of our trades: + sells, − buys (lamports, pump events) */
  grossBuy: bigint;
  grossSell: bigint;
  base: bigint;
  priority: bigint;
  tip: bigint;
  pumpFee: bigint;
  rent: bigint;
  launchRent: bigint;
  claim: bigint;
  /** Σ token deltas of the vault wallets on `mint` (raw units): + bought, − sold (average-cost PnL) */
  tokenDelta: bigint;
  /** external counterparties of transfers: + received, − sent (for the relay heuristic) */
  external: Map<string, bigint>;
};

const big = (s: string | undefined) => BigInt(s ?? "0");

export function classify(tx: LedgerTx, vault: Set<string>): LedgerEntry | null {
  let delta = BigInt(0);
  let involved = false;
  for (const w of vault) {
    if (tx.sol[w] !== undefined) {
      delta += big(tx.sol[w]);
      involved = true;
    }
  }
  if (tx.payer && vault.has(tx.payer)) involved = true;
  if (!involved && !tx.tokens.some((t) => vault.has(t.owner))) return null;
  const paid = vault.has(tx.payer);
  const base = paid ? BigInt(BASE_FEE * tx.sigs) : BigInt(0);
  const priority = paid ? big(tx.fee) - base : BigInt(0);
  let tip = BigInt(0);
  const external = new Map<string, bigint>();
  let hasInternal = false;
  for (const t of tx.transfers) {
    const fromV = vault.has(t.from), toV = vault.has(t.to);
    if (fromV && TIP_SET.has(t.to)) {
      tip += big(t.lamports);
      continue;
    }
    if (fromV && toV) hasInternal = true;
    else if (fromV && !FEE_RECIPIENTS.has(t.to)) external.set(t.to, (external.get(t.to) ?? BigInt(0)) - big(t.lamports));
    else if (toV && !fromV) external.set(t.from, (external.get(t.from) ?? BigInt(0)) + big(t.lamports));
  }
  let grossBuy = BigInt(0), grossSell = BigInt(0), pumpFee = BigInt(0), claim = BigInt(0);
  let mint: string | null = null;
  let kind: Kind | null = null;
  for (const ev of tx.pump) {
    if (!vault.has(ev.user)) continue;
    if (ev.kind === "buy" || ev.kind === "sell") {
      mint ??= ev.mint;
      if (ev.kind === "buy") grossBuy += big(ev.sol);
      else grossSell += big(ev.sol);
      pumpFee += big(ev.fee) + big(ev.creatorFee);
      kind ??= "trade";
    } else if (ev.kind === "create") {
      mint = ev.mint;
      kind = "create";
    } else if (ev.kind === "claim") {
      claim += big(ev.sol);
      kind ??= "claim";
    }
  }
  if (!kind) {
    const tokenMove = tx.tokens.find((t) => vault.has(t.owner) && !tx.err);
    if (tokenMove && (tx.programs.length > 1 || external.size === 0)) {
      // a swap on another venue (PumpSwap / Raydium…): token balance moved, SOL moved, no plain transfer
      kind = "trade";
      mint = tokenMove.mint;
    } else if (hasInternal && external.size === 0) kind = "internal";
    else if (external.size) kind = [...external.values()].some((v) => v < BigInt(0)) ? "withdraw" : "deposit";
    else if (tip > BigInt(0) && delta + tip + base + priority === BigInt(0)) kind = "tip";
    else kind = "other";
  }
  // rent: accounts created in the transaction (except the curve, fee recipients, tips, vault wallets), minus closed ones refunded to us
  let rent = BigInt(0), launchRent = BigInt(0);
  if (kind === "trade" || kind === "create" || kind === "other" || kind === "claim") {
    const curve = mint ? safeCurve(mint) : null;
    for (const [addr, lam] of Object.entries(tx.created)) {
      if (vault.has(addr) || TIP_SET.has(addr) || FEE_RECIPIENTS.has(addr) || addr === curve) continue;
      if (kind === "create") launchRent += big(lam);
      else rent += big(lam);
    }
    for (const [addr, lam] of Object.entries(tx.closed)) {
      if (vault.has(addr) || addr === curve) continue;
      rent -= big(lam);
    }
    // the bonding curve of a create holds the dev buy: its rent part is the real-sol-free remainder — folded into launchRent via the SOL delta below
    if (kind === "create" && curve && tx.created[curve]) launchRent += big(tx.created[curve]) - grossBuy;
  }
  const tokenDelta = mint ? tx.tokens.reduce((n, t) => (t.mint === mint && vault.has(t.owner) ? n + big(t.delta) : n), BigInt(0)) : BigInt(0);
  return { sig: tx.sig, at: tx.at, kind, mint, delta, grossBuy, grossSell, base, priority, tip, pumpFee, rent, launchRent, claim, tokenDelta, external };
}

function safeCurve(mint: string): string | null {
  try {
    return bondingCurvePda(new PublicKey(mint)).toBase58();
  } catch {
    return null;
  }
}

const f9 = (lam: bigint) => (Number(lam) / 1e9).toFixed(9).replace(/\.?0+$/, "") || "0";

type MintAcc = MintPnl & { gross: bigint; net: bigint; buys: bigint; sells: bigint; pumpFees: bigint; launch: bigint; txFees: bigint; rentL: bigint };
export type LedgerPnl = {
  window: PnlWindow;
  mints: Map<string, MintAcc>;
};

/** every classified entry of the ledger, oldest first (cached per ledger version) */
let entriesCache: { key: string; entries: LedgerEntry[] } | null = null;
export function ledgerEntries(): LedgerEntry[] {
  const f = file();
  // every wallet that was ever in the vault: the result is a record of what happened, it does not shrink when a
  // wallet is removed from the vault later (its trades, costs and launches stay counted)
  const vault = new Set(historyWallets());
  const key = `${Object.keys(f.txs).length}|${[...vault].sort().join(",")}`;
  if (entriesCache && entriesCache.key === key) return entriesCache.entries;
  const entries: LedgerEntry[] = [];
  for (const tx of Object.values(f.txs)) {
    const e = classify(tx, vault);
    if (e) entries.push(e);
  }
  entries.sort((a, b) => a.at - b.at || a.sig.localeCompare(b.sig));
  entriesCache = { key, entries };
  return entries;
}

/** Average-cost accounting of our trades, oldest first (Axiom-style realized PnL). A buy (or a create with its dev /
 *  inline buys) adds its whole SOL out — fees and rent included — to the mint's cost; a sell realizes what it brought
 *  in minus the average cost of the tokens it sold. So a coin bought and still held is no loss on the day it was
 *  bought (FRAME, 2026-10-06: −2.2 SOL "lost" while ~2.06 SOL of it sat on a deleted dev) — its cost stays `open`
 *  until it is sold, and the held value minus that cost is the unrealized part.
 *  `realized`: per trade / create signature (lamports) · `open`: per mint, tokens still held and their cost. */
export type OpenPosition = { tokens: bigint; cost: bigint };
let basisCache: { entries: LedgerEntry[]; realized: Map<string, bigint>; open: Map<string, OpenPosition> } | null = null;
export function costBasis(): { realized: Map<string, bigint>; open: Map<string, OpenPosition> } {
  const entries = ledgerEntries();
  if (basisCache && basisCache.entries === entries) return basisCache;
  const realized = new Map<string, bigint>();
  const open = new Map<string, OpenPosition>();
  const zero = BigInt(0);
  for (const e of entries) {
    if ((e.kind !== "trade" && e.kind !== "create") || !e.mint) continue;
    const p = open.get(e.mint) ?? { tokens: zero, cost: zero };
    const cash = e.delta - e.claim;
    if (e.tokenDelta > zero) {
      p.tokens += e.tokenDelta;
      p.cost -= cash;
      realized.set(e.sig, zero);
    } else if (e.tokenDelta < zero) {
      const out = -e.tokenDelta;
      const costOut = p.tokens <= zero ? zero : out >= p.tokens ? p.cost : (p.cost * out) / p.tokens;
      p.cost -= costOut;
      p.tokens = p.tokens > out ? p.tokens - out : zero;
      if (p.tokens === zero) p.cost = zero;
      realized.set(e.sig, cash - costOut);
    } else realized.set(e.sig, cash);
    open.set(e.mint, p);
  }
  basisCache = { entries, realized, open };
  return basisCache;
}
/** realized PnL of one entry: average cost for trades / creates, the plain SOL movement otherwise */
function realizedOf(e: LedgerEntry, realized: Map<string, bigint>): bigint {
  return (e.kind === "trade" || e.kind === "create") && e.mint ? (realized.get(e.sig) ?? e.delta - e.claim) : e.delta - e.claim;
}
/** cost (SOL) of the tokens still held, all mints */
export function openCostSol(): number {
  let n = BigInt(0);
  for (const p of costBasis().open.values()) if (p.tokens > BigInt(0) && p.cost > BigInt(0)) n += p.cost;
  return Number(n) / 1e9;
}

/** PnL of the window [since, until] (epoch ms; since = 0 for all time). `pendingClaims` = creator fees still in the vaults. */
export function ledgerPnl(since: number, until = Number.POSITIVE_INFINITY, pendingClaims: string | null = null): LedgerPnl {
  const entries = ledgerEntries().filter((e) => e.at >= since && e.at <= until);
  const { realized } = costBasis();
  let held = BigInt(0);
  for (const e of entries) if ((e.kind === "trade" || e.kind === "create") && e.mint) held += realizedOf(e, realized) - (e.delta - e.claim);
  let network = BigInt(0), priority = BigInt(0), jito = BigInt(0), pump = BigInt(0), rent = BigInt(0), launch = BigInt(0), transfer = BigInt(0), claims = BigInt(0), other = BigInt(0), buys = BigInt(0), sells = BigInt(0);
  let trades = 0;
  const mints = new Map<string, MintAcc>();
  const relay = new Map<string, bigint>();
  for (const e of entries) {
    if (e.kind === "trade" || e.kind === "create" || e.kind === "claim" || e.kind === "other" || e.kind === "tip") {
      network += e.base;
      priority += e.priority;
      jito += e.tip;
      pump += e.pumpFee;
      rent += e.rent;
      launch += e.launchRent;
      claims += e.claim;
      buys += e.grossBuy;
      sells += e.grossSell;
      if (e.kind === "trade" || e.kind === "create") {
        trades += e.grossBuy > BigInt(0) || e.grossSell > BigInt(0) ? 1 : 0;
        if (e.mint) {
          const m = mints.get(e.mint) ?? { mint: e.mint, symbol: null, netSol: "0", buysSol: "0", sellsSol: "0", tradingSol: "0", costsSol: "0", launchSol: "0", txFeesSol: "0", rentSol: "0", creatorFeesSol: "0", creatorFeesComplete: true, trades: 0, firstAt: e.at, lastAt: e.at, gross: BigInt(0), net: BigInt(0), buys: BigInt(0), sells: BigInt(0), pumpFees: BigInt(0), launch: BigInt(0), txFees: BigInt(0), rentL: BigInt(0) };
          m.net += e.delta;
          m.pumpFees += e.pumpFee;
          m.launch += e.launchRent;
          m.txFees += e.base + e.priority + e.tip;
          m.rentL += e.rent;
          m.gross += e.grossSell - e.grossBuy;
          m.buys += e.grossBuy;
          m.sells += e.grossSell;
          m.trades += e.grossBuy > BigInt(0) || e.grossSell > BigInt(0) ? 1 : 0;
          m.firstAt = Math.min(m.firstAt, e.at);
          m.lastAt = Math.max(m.lastAt, e.at);
          mints.set(e.mint, m);
        }
      }
      // residual: what the delta says beyond the categorised flows
      const explained = e.grossSell - e.grossBuy - e.base - e.priority - e.tip - e.pumpFee - e.rent - e.launchRent + e.claim;
      other += e.delta - explained;
    } else {
      // internal / deposit / withdraw: only the fees are ours
      transfer += e.base + e.priority + e.tip;
      for (const [addr, v] of e.external) relay.set(addr, (relay.get(addr) ?? BigInt(0)) + v);
    }
  }
  // relay hops: an external address that received from us and sent back to us, losing a little on the way
  for (const v of relay.values()) if (v < BigInt(0) && -v <= BigInt(RELAY_LOSS_MAX_LAMPORTS)) transfer += -v;
  const total = network + priority + jito + pump + rent + launch + transfer;
  const gross = sells - buys;
  // realized (average cost): the cost of tokens still held is not a loss yet
  const net = gross - total + claims + other + held;
  let wins = 0, losses = 0;
  const revenue = creatorRevenueByMint();
  for (const m of mints.values()) {
    const fees = revenue.byMint.get(m.mint) ?? BigInt(0);
    const costs = m.launch + m.txFees + m.rentL;
    m.tradingSol = f9(m.gross - m.pumpFees);
    m.costsSol = f9(costs);
    m.launchSol = f9(m.launch);
    m.txFeesSol = f9(m.txFees);
    m.rentSol = f9(m.rentL);
    m.creatorFeesSol = f9(fees);
    m.creatorFeesComplete = revenue.complete;
    // the on-chain SOL result of its transactions (= trading − costs, plus rounding/refunds) + the fees it produced
    m.net += fees;
    m.netSol = f9(m.net);
    m.buysSol = f9(m.buys);
    m.sellsSol = f9(m.sells);
    m.symbol = symbolOf(m.mint);
    if (m.net > BigInt(0)) wins++;
    else if (m.net < BigInt(0)) losses++;
  }
  const st = ledgerStatus();
  const fees: FeeBreakdown = {
    networkSol: f9(network),
    priorityTipSol: f9(priority),
    jitoTipSol: f9(jito),
    pumpTradeFeeSol: f9(pump),
    rentSol: f9(rent),
    launchSol: f9(launch),
    transferFeeSol: f9(transfer),
    totalCostSol: f9(total),
    creatorFeesClaimedSol: f9(claims),
    creatorFeesPendingSol: pendingClaims,
  };
  return {
    window: { realisedSol: f9(gross), buysSol: f9(buys), sellsSol: f9(sells), trades, wins, losses, netSol: f9(net), fees, otherSol: f9(other), heldCostSol: f9(held), estimated: !st.complete },
    mints,
  };
}

function symbolOf(mint: string): string | null {
  const st = store();
  return st.launches.find((l) => l.mint === mint)?.symbol ?? metaCached(mint)?.symbol ?? feedCard(mint)?.symbol ?? null;
}

/** net SOL per UTC day (calendar): trades + launch costs of that day, creator fees on the day they were EARNED (a claim
 *  only moves them from the creator vault to the wallet: its own tx fees count, the amount does not — counted already),
 *  transfer fees. The same figure as the sum of that day's coin rows (ledgerDay) + its other costs. */
export function ledgerDays(): { date: string; sol: number; trades: number }[] {
  const out = new Map<string, { date: string; sol: number; trades: number }>();
  const day = (date: string) => out.get(date) ?? { date, sol: 0, trades: 0 };
  const { realized } = costBasis();
  for (const e of ledgerEntries()) {
    if (!e.at) continue;
    const date = new Date(e.at).toISOString().slice(0, 10);
    const d = day(date);
    if (e.kind === "trade" || e.kind === "create" || e.kind === "claim" || e.kind === "other" || e.kind === "tip") {
      d.sol += Number(realizedOf(e, realized)) / 1e9;
      if (e.grossBuy > BigInt(0) || e.grossSell > BigInt(0)) d.trades++;
    } else {
      d.sol -= Number(e.base + e.priority + e.tip) / 1e9;
    }
    out.set(date, d);
  }
  for (const [date, perMint] of creatorFeesByDay()) {
    const d = day(date);
    for (const v of perMint.values()) d.sol += Number(v) / 1e9;
    out.set(date, d);
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** one UTC day of the calendar, coin by coin: what each token made that day (trades − launch costs + creator fees
 *  earned that day) and the costs that belong to no coin (transfers, claim fees). total = the calendar's figure. */
export function ledgerDay(date: string): DayBreakdown {
  const rows = new Map<string, { mint: string; trading: bigint; costs: bigint; fees: bigint; net: bigint; trades: number }>();
  const row = (mint: string) => rows.get(mint) ?? { mint, trading: BigInt(0), costs: BigInt(0), fees: BigInt(0), net: BigInt(0), trades: 0 };
  let other = BigInt(0);
  const { realized } = costBasis();
  for (const e of ledgerEntries()) {
    if (!e.at || new Date(e.at).toISOString().slice(0, 10) !== date) continue;
    if ((e.kind === "trade" || e.kind === "create") && e.mint) {
      const r = row(e.mint);
      // realized (average cost): a buy whose tokens are still held is no loss that day; trading − costs = realized
      const costs = e.launchRent + e.base + e.priority + e.tip + e.rent;
      const got = realizedOf(e, realized);
      r.trading += got + costs;
      r.costs += costs;
      r.net += got;
      r.trades += e.grossBuy > BigInt(0) || e.grossSell > BigInt(0) ? 1 : 0;
      rows.set(e.mint, r);
    } else if (e.kind === "trade" || e.kind === "create" || e.kind === "claim" || e.kind === "other" || e.kind === "tip") {
      other += e.delta - e.claim;
    } else {
      other -= e.base + e.priority + e.tip;
    }
  }
  for (const [mint, v] of creatorFeesByDay().get(date) ?? []) {
    const r = row(mint);
    r.fees += v;
    r.net += v;
    rows.set(mint, r);
  }
  const coins = [...rows.values()]
    .map((r) => ({ mint: r.mint, symbol: symbolOf(r.mint), tradingSol: f9(r.trading), costsSol: f9(r.costs), creatorFeesSol: f9(r.fees), netSol: f9(r.net), trades: r.trades }))
    .sort((a, b) => Number(b.netSol) - Number(a.netSol));
  const total = [...rows.values()].reduce((s, r) => s + r.net, BigInt(0)) + other;
  return { date, coins, otherSol: f9(other), totalSol: f9(total), complete: ledgerStatus().complete && creatorRevenueByMint().complete };
}

/** per-mint rows, all time, newest first */
export function ledgerMints(): MintPnl[] {
  const { mints } = ledgerPnl(0);
  return [...mints.values()]
    .map(({ mint, symbol, netSol, buysSol, sellsSol, tradingSol, costsSol, launchSol, txFeesSol, rentSol, creatorFeesSol, creatorFeesComplete, trades, firstAt, lastAt }) => ({ mint, symbol, netSol, buysSol, sellsSol, tradingSol, costsSol, launchSol, txFeesSol, rentSol, creatorFeesSol, creatorFeesComplete, trades, firstAt, lastAt }))
    .sort((a, b) => b.lastAt - a.lastAt);
}
