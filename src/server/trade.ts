/* Order rail / Instant Trade / quick-buy chip: Block X trading presets applied to a market buy or sell.
 * Resolves amount (SOL, preset amount, preset % of balance, explicit %), slippage, tip, Jito bundle, and the
 * "Multi wallet trading" options (value spread across wallets, delay between wallet buys). */
import { PublicKey } from "@solana/web3.js";
import type { TradeBuyRequest, TradeCreated, TradeSellRequest, TradingPreset } from "@/lib/types";
import { TRADING_PRESET_LIMITS } from "@/lib/types";
import { HttpError, intIn, lamportsOf, numIn, sleep, solString } from "./api";
import { buyWithWallets, getAccountsChunked, readConn, requireUnlocked, sellWithWallets, tipLamportsFor, vaultWallets } from "./engine";
import { jobNew, jobNote, jobPush, jobRun, jobWait } from "./jobs";
import { store } from "./store";

/** SOL kept aside per wallet when buying a % of the balance (ATA rent + fees + priority) */
const FEE_MARGIN = BigInt(3_000_000);

function presetOf(n: unknown): TradingPreset | null {
  if (n === undefined || n === null || n === "") return null;
  const i = Number(n);
  if (i !== 1 && i !== 2 && i !== 3) throw new HttpError(400, "preset must be 1, 2 or 3.");
  return store().settings.tradingPresets[i - 1];
}

function index4(v: unknown, what: string): 0 | 1 | 2 | 3 {
  const i = Number(v);
  if (i !== 0 && i !== 1 && i !== 2 && i !== 3) throw new HttpError(400, `${what} must be 0, 1, 2 or 3.`);
  return i;
}

type Common = { slippageBps: number; cuPrice: number; tipSol: string; tipLamports: bigint; bundle: boolean };

function common(body: { slippageBps?: number; cuPrice?: number; tipSol?: string; bundle?: boolean }, p: TradingPreset | null): Common {
  const s = store().settings;
  const slippageBps = body.slippageBps !== undefined ? intIn(body.slippageBps, 0, 9000, s.slippageBps, "slippageBps") : p ? Math.round(p.slippagePercent * 100) : s.slippageBps;
  const cuPrice = intIn(body.cuPrice, 0, 50_000_000, s.cuPrice, "cuPrice");
  const tipSol = body.tipSol !== undefined && body.tipSol !== "" ? solString(lamportsOf(body.tipSol, "tipSol", true)) : (p?.tipSol ?? s.tipSol);
  const tipLamports = tipLamportsFor(tipSol);
  const bundle = body.bundle !== undefined ? !!body.bundle : s.jitoEnabled;
  if (bundle && tipLamports <= BigInt(0) && s.cluster === "mainnet") throw new HttpError(400, "A Jito bundle needs a tip > 0 (tipSol, the preset's tip or Settings → tip).");
  return { slippageBps, cuPrice, tipSol, tipLamports, bundle };
}

/** random multipliers around 1 within ±spread %, rescaled so the amounts still sum to base × n */
export function spreadAmounts(base: bigint, n: number, spreadPct: number): bigint[] {
  if (n <= 1 || spreadPct <= 0) return Array.from({ length: n }, () => base);
  const f = Array.from({ length: n }, () => Math.max(0.05, 1 + (spreadPct / 100) * (Math.random() * 2 - 1)));
  const sum = f.reduce((s, x) => s + x, 0);
  const total = base * BigInt(n);
  const out: bigint[] = [];
  let left = total;
  for (let i = 0; i < n - 1; i++) {
    const a = BigInt(Math.floor(Number(total) * (f[i] / sum)));
    out.push(a);
    left -= a;
  }
  out.push(left);
  return out;
}

export async function tradeBuy(body: TradeBuyRequest): Promise<TradeCreated> {
  requireUnlocked();
  const st = store();
  const mint = new PublicKey(String(body.mint)).toBase58();
  const wallets = vaultWallets(body.wallets ?? []).map((w) => w.address);
  if (wallets.length === 0) throw new HttpError(400, "wallets: a non-empty array of addresses is required.");
  const p = presetOf(body.preset);
  const c = common(body, p);
  const spreadPct = numIn(body.spreadPct, 0, TRADING_PRESET_LIMITS.maxSpreadPct, p?.buysValueSpreadPct ?? 0, "spreadPct");
  const delaySec = numIn(body.delaySec, 0, TRADING_PRESET_LIMITS.maxDelaySec, p?.buysDelaySec ?? 0, "delaySec");
  // amount per wallet
  let amounts: Map<string, bigint>;
  const notes: string[] = [];
  let label: string;
  if (body.sol !== undefined && body.sol !== "") {
    const base = lamportsOf(body.sol, "sol");
    const arr = spreadAmounts(base, wallets.length, spreadPct);
    amounts = new Map(wallets.map((w, i) => [w, arr[i]]));
    label = `${body.sol} SOL`;
  } else if (p && body.amountIndex !== undefined) {
    const base = lamportsOf(p.buyAmounts[index4(body.amountIndex, "amountIndex")], "preset amount");
    const arr = spreadAmounts(base, wallets.length, spreadPct);
    amounts = new Map(wallets.map((w, i) => [w, arr[i]]));
    label = `P${body.preset} ${solString(base)} SOL`;
  } else if (body.percentOfBalance !== undefined || (p && body.percentIndex !== undefined)) {
    const pct = body.percentOfBalance !== undefined ? numIn(body.percentOfBalance, 0.01, 100, 0, "percentOfBalance") : p!.buyPercents[index4(body.percentIndex, "percentIndex")];
    if (!(pct > 0)) throw new HttpError(400, "percentOfBalance must be > 0.");
    const infos = await getAccountsChunked(readConn(), wallets.map((w) => new PublicKey(w))).catch(() => null);
    if (!infos) throw new HttpError(503, "RPC unreachable: wallet balances could not be read. Nothing was sent.");
    amounts = new Map();
    wallets.forEach((w, i) => {
      const bal = BigInt(infos[i]?.lamports ?? 0);
      const spendable = bal - FEE_MARGIN - c.tipLamports;
      const lam = spendable > BigInt(0) ? (spendable * BigInt(Math.round(pct * 100))) / BigInt(10_000) : BigInt(0);
      if (lam > BigInt(0)) amounts.set(w, lam);
      else notes.push(`${w.slice(0, 6)}… holds ${solString(bal)} SOL — nothing left after fees, skipped`);
    });
    if (amounts.size === 0) throw new HttpError(402, `Insufficient SOL: ${notes.join("; ")}.`);
    label = `${pct}% of balance`;
  } else throw new HttpError(400, "Amount missing: give `sol`, or `preset` + `amountIndex` / `percentIndex`, or `percentOfBalance`.");
  const active = wallets.filter((w) => amounts.has(w));
  const plan = active.map((w) => ({ address: w, sol: solString(amounts.get(w)!) }));
  const job = jobNew("buy", active.length, `Buy ${label} × ${active.length} · ${mint.slice(0, 6)}…${c.bundle ? " · bundle" : ""}`);
  job.extra = { mint, side: "buy", label, bundle: c.bundle, plan, spreadPct, delaySec, slippageBps: c.slippageBps, tipSol: c.tipSol };
  for (const n of notes) jobNote(job, n);
  jobRun(job, async (j) => {
    if (delaySec > 0 && active.length > 1) {
      let ok = 0;
      let lastErr: string | null = null;
      for (let i = 0; i < active.length; i++) {
        if (j.stop) {
          jobNote(j, "Stopped before the next wallet.");
          break;
        }
        if (i > 0) {
          const ms = Math.round(delaySec * 1000);
          jobWait(j, ms);
          await sleep(ms);
        }
        try {
          const out = await buyWithWallets({ mint, wallets: [active[i]], lamportsEach: amounts.get(active[i])!, slippageBps: c.slippageBps, cuPrice: c.cuPrice, tipLamports: c.tipLamports, bundle: c.bundle, job: j });
          if (out[0]?.ok) ok++;
          else lastErr = out[0]?.error ?? "not confirmed";
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          jobPush(j, false, { address: active[i], sol: solString(amounts.get(active[i])!), error: lastErr });
          if (/graduated|not found|locked/i.test(lastErr)) break;
        }
      }
      if (ok === 0) throw new Error(lastErr ?? "no buy confirmed");
      return;
    }
    await buyWithWallets({ mint, wallets: active, lamportsEach: (a) => amounts.get(a)!, slippageBps: c.slippageBps, cuPrice: c.cuPrice, tipLamports: c.tipLamports, bundle: c.bundle, job: j });
  });
  return { jobId: job.id, plan, slippageBps: c.slippageBps, tipSol: c.tipSol, spreadPct, delaySec };
}

export async function tradeSell(body: TradeSellRequest): Promise<TradeCreated> {
  requireUnlocked();
  const mint = new PublicKey(String(body.mint)).toBase58();
  const wallets = vaultWallets(body.wallets ?? []).map((w) => w.address);
  if (wallets.length === 0) throw new HttpError(400, "wallets: a non-empty array of addresses is required.");
  const p = presetOf(body.preset);
  const c = common(body, p);
  let percent: number;
  if (body.percent !== undefined && body.percent !== null && String(body.percent) !== "") percent = intIn(body.percent, 1, 100, 100, "percent");
  else if (p && body.percentIndex !== undefined) percent = Math.max(1, Math.min(100, Math.round(p.sellPercents[index4(body.percentIndex, "percentIndex")])));
  else throw new HttpError(400, "Percent missing: give `percent` (1..100) or `preset` + `percentIndex`.");
  const plan = wallets.map((w) => ({ address: w, percent }));
  const job = jobNew("sell", wallets.length, `Sell ${percent}% × ${wallets.length} · ${mint.slice(0, 6)}…${c.bundle ? " · bundle" : ""}`);
  job.extra = { mint, side: "sell", percent, bundle: c.bundle, slippageBps: c.slippageBps, tipSol: c.tipSol };
  jobRun(job, async (j) => {
    await sellWithWallets({ mint, wallets, percent, slippageBps: c.slippageBps, cuPrice: c.cuPrice, tipLamports: c.tipLamports, bundle: c.bundle, job: j });
  });
  return { jobId: job.id, plan, slippageBps: c.slippageBps, tipSol: c.tipSol, spreadPct: 0, delaySec: 0 };
}
