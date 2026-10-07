/** Husher multi-exchange API (Block X's Mixer route): one quote per provider, the user picks a provider + delay per
 *  wallet, the order gives a deposit address. The deposit is made by the user — by hand or "Pay from wallet". */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { HttpError } from "./api";
import { store, readJson, writeJson, logActivity } from "./store";
import { ownedAddresses } from "./wallets";
import { HUSHER_MAX_DELAY_MIN, HUSHER_MAX_SOURCES, HUSHER_PROVIDERS, husherAllocation, parseHusherSol, type HusherOption, type HusherPick, type HusherPlan, type HusherQuote, type HusherOrder, type HusherSource } from "@/lib/husher";

const BASE = "https://api.husher.net";
const QUOTE_MS = 60_000;
const PROVIDERS_MS = 10 * 60_000;
/** Husher's docs: "binance and husher are equivalent" — quoting both would list the same route twice. */
const DEFAULT_PROVIDERS = ["binance", "kucoin", "bybit", "bitget", "htx", "mexc", "gate", "whitebit"];
type State = { quotes: Map<string, HusherQuote>; creating: Set<string>; providers?: { at: number; list: string[] } };
function state(): State {
  const rt = store().runtime as { husherState?: State };
  return rt.husherState ??= { quotes: new Map(), creating: new Set() };
}
const path = () => join(store().dir, "husher-orders.json");
export const husherHistory = (): HusherOrder[] => readJson<HusherOrder[]>(path(), []);
const save = (order: HusherOrder) => {
  const list = husherHistory(); const i = list.findIndex((r) => r.id === order.id);
  if (i < 0) list.unshift(order); else list[i] = order;
  writeJson(path(), list);
};
function key() { return process.env.HUSHER_API_KEY?.trim() || store().settings.husherKey?.trim() || ""; }
export const husherConfigured = () => !!key();
function mainnet() {
  if (store().settings.cluster !== "mainnet") throw new HttpError(400, "Husher uses real SOL. Switch DONCHAIN to mainnet first.");
}
function text(v: unknown): string | null { return typeof v === "string" && v.length ? v : null; }
function amount(v: unknown): string | null {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  return /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? s : null;
}
function scrub(v: unknown) {
  const msg = String(v).slice(0, 500); const secret = key();
  return secret ? msg.split(secret).join("[redacted]") : msg;
}
async function call(endpoint: string, body?: unknown): Promise<Record<string, unknown>> {
  const secret = key();
  if (!secret) throw new HttpError(503, "Add your Husher API key in Settings → Workspace.");
  let res: Response;
  try {
    res = await fetch(BASE + endpoint, {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
      headers: { "x-api-key": secret, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
    });
  } catch { throw new HttpError(502, "Husher did not return a response. Check the order history before creating another order."); }
  let j: Record<string, unknown>;
  try { j = await res.json(); } catch { throw new HttpError(502, "Husher returned an unreadable response."); }
  if (!j || typeof j !== "object" || !res.ok || j.success !== true) {
    // Husher answered and said no: nothing was created on its side (unlike a timeout, which stays "needs review").
    const err = new HttpError(res.status === 401 || res.status === 403 ? 403 : 502, scrub(j?.message || j?.error || `Husher HTTP ${res.status}`));
    Object.assign(err, { rejected: res.status < 500, httpStatus: res.status });
    throw err;
  }
  return j;
}
function validate(raw: HusherPlan): HusherPlan {
  mainnet();
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Invalid Husher plan.");
  try { husherAllocation(raw); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : "Invalid allocation."); }
  const ours = new Set(ownedAddresses()); const seen = new Set<string>();
  const recipients = raw.recipients.map((r) => {
    let address: string;
    try { address = new PublicKey(r.address).toBase58(); } catch { throw new HttpError(400, "Invalid Solana destination."); }
    if (!ours.has(address)) throw new HttpError(400, "Choose destination wallets from your DONCHAIN vault.");
    if (seen.has(address)) throw new HttpError(400, "A wallet can only appear once in an order.");
    seen.add(address);
    return { address, label: typeof r.label === "string" ? r.label.slice(0, 80) : address.slice(0, 8), sol: r.sol.trim() };
  });
  return { totalSol: raw.totalSol.trim(), recipients };
}
export async function husherLimits() {
  const j = await call("/api/v1/multi-exchange/minimum-withdrawals?token=SOL&network=SOL");
  const rows = Array.isArray(j.data) ? j.data as { provider?: string; minAmount?: number }[] : [];
  const min = rows.find((r) => r.provider === "husher")?.minAmount;
  return { minimumSol: typeof min === "number" && Number.isFinite(min) && min > 0 ? min : null };
}
async function husherProviders(): Promise<string[]> {
  const st = state();
  if (st.providers && Date.now() - st.providers.at < PROVIDERS_MS) return st.providers.list;
  let list = DEFAULT_PROVIDERS;
  try {
    const j = await call("/api/v1/multi-exchange/providers");
    const raw = (j.data as { providers?: unknown } | undefined)?.providers;
    if (Array.isArray(raw)) {
      const live = raw.filter((p): p is string => typeof p === "string" && p in HUSHER_PROVIDERS && p !== "husher");
      if (live.length) list = live;
    }
  } catch { /* the documented list still quotes; a bad provider simply returns no rate */ }
  st.providers = { at: Date.now(), list };
  return list;
}
type Rated = { provider: string; recipients: Record<string, unknown>[] | null; error: string | null };
async function rateFor(provider: string, totalSol: string, percents: number[]): Promise<Rated> {
  try {
    const j = await call("/api/v1/multi-exchange/rate", {
      sendToken: "SOL", sendNetwork: "SOL", receiveToken: "SOL", receiveNetwork: "SOL",
      totalAmount: Number(totalSol), recipients: percents.map((percent) => ({ percent, provider })),
    });
    const rows = (j.data as { recipients?: unknown } | undefined)?.recipients;
    return Array.isArray(rows) && rows.length === percents.length ? { provider, recipients: rows as Record<string, unknown>[], error: null } : { provider, recipients: null, error: "incomplete quote" };
  } catch (e) { return { provider, recipients: null, error: e instanceof Error ? e.message : String(e) }; }
}
/** Sum of decimal SOL strings, exact to the lamport, trailing zeros trimmed. */
function sumSol(values: string[]): string {
  const lam = values.reduce((a, v) => a + BigInt(Math.round(Number(v) * 1e9)), BigInt(0));
  const s = lam.toString().padStart(10, "0");
  return `${s.slice(0, -9)}.${s.slice(-9)}`.replace(/\.?0+$/, "");
}
export async function husherQuote(raw: HusherPlan): Promise<HusherQuote> {
  const plan = validate(raw); const percents = husherAllocation(plan);
  const providers = await husherProviders();
  const rated = await Promise.all(providers.map((p) => rateFor(p, plan.totalSol, percents)));
  if (rated.every((r) => !r.recipients)) throw new HttpError(502, scrub(rated.find((r) => r.error)?.error || "Husher returned no quote."));
  const rates = plan.recipients.map((rec, i) => {
    const options: (HusherOption & { sendSol: string })[] = []; let firstError: string | null = null; let minimum: string | null = null;
    for (const r of rated) {
      const row = r.recipients?.[i];
      if (!row) continue;
      if (row.success !== true) { firstError ??= text(row.error); continue; }
      const nested = typeof row.rate === "object" && row.rate ? row.rate as Record<string, unknown> : {};
      const receiveSol = amount(row.receiveAmount ?? nested.receiveAmount);
      const sendSol = amount(row.sendAmount ?? nested.sendAmount);
      if (!receiveSol || Number(receiveSol) <= 0 || !sendSol) continue;
      minimum ??= text(row.minimum);
      options.push({ provider: r.provider, receiveSol, sendSol });
    }
    if (!options.length) throw new HttpError(400, `${rec.label}: ${scrub(firstError || "No provider can quote this allocation.")}`);
    options.sort((a, b) => Number(b.receiveSol) - Number(a.receiveSol));
    return { address: rec.address, sendSol: options[0].sendSol, receiveSol: options[0].receiveSol, percent: percents[i], minimum, options: options.map(({ provider, receiveSol }) => ({ provider, receiveSol })) };
  });
  const receiveSol = sumSol(rates.map((r) => r.receiveSol));
  const available = providers.filter((p) => rates.some((r) => r.options.some((o) => o.provider === p)));
  const quote: HusherQuote = { ...plan, id: randomUUID(), expiresAt: Date.now() + QUOTE_MS, receiveSol, providers: available, rates };
  const st = state();
  for (const [id, q] of st.quotes) if (q.expiresAt < Date.now()) st.quotes.delete(id);
  st.quotes.set(quote.id, quote);
  return quote;
}
export async function husherRefresh(id: string): Promise<HusherOrder> {
  const record = husherHistory().find((r) => r.id === id);
  if (!record) throw new HttpError(404, "Order not found in this DONCHAIN history.");
  if (!record.remoteId) return record;
  try {
    const j = await call(`/api/v1/multi-exchange/${encodeURIComponent(record.remoteId)}`);
    const d = j.data as Record<string, unknown>;
    if (!d || d.send !== "SOL" || d.receive !== "SOL" || d.sendNetwork !== "SOL" || d.receiveNetwork !== "SOL") throw new Error("Husher returned an unexpected asset or network. Do not deposit.");
    const rows = Array.isArray(d.recipients) ? d.recipients as Record<string, unknown>[] : [];
    const expected = new Set(record.plan.recipients.map((r) => r.address));
    if (rows.length !== expected.size || rows.some((r) => !expected.delete(String(r.recipientAddress))) || expected.size) throw new Error("Husher destinations differ from your order. Do not deposit.");
    for (const row of rows) {
      const expectedRate = record.quote.rates.find((r) => r.address === row.recipientAddress);
      if (!expectedRate || !Number.isFinite(Number(row.percent)) || Math.abs(Number(row.percent) - expectedRate.percent) > 0.000001) throw new Error("Husher allocation percentages differ from your order. Do not deposit.");
    }
    const address = text(d.sendAddress); const total = amount(d.totalAmount);
    if (!total || parseHusherSol(total) !== parseHusherSol(record.plan.totalSol)) throw new Error("Husher deposit amount differs from your order. Do not deposit.");
    record.depositAddress = address ? new PublicKey(address).toBase58() : null;
    if (d.sendTag) throw new Error("Unexpected deposit memo. Do not deposit; contact Husher support.");
    record.depositSol = total;
    record.status = text(d.status) ?? "pending";
    record.orderId = text(d.orderId) ?? record.orderId;
    record.feeSol = amount(d.feeAmount); record.networkFeeSol = amount(d.networkFee);
    record.feePercentage = typeof d.feePercentage === "number" ? d.feePercentage : null;
    record.hashIn = text(d.hashIn);
    const url = text(d.trackPageUrl);
    record.trackingUrl = url && /^https:\/\/www\.husher\.io\/multi-exchange\/[A-Za-z0-9_-]+$/.test(url) ? url : null;
    record.recipients = rows.map((r) => ({ address: String(r.recipientAddress), status: text(r.status) ?? "pending", receiveSol: amount(r.receiveAmount) ?? "0", hashOut: text(r.hashOut) }));
    record.error = null;
  } catch (e) {
    record.error = scrub(e instanceof Error ? e.message : e);
    // A failed verification must never leave an old deposit instruction active.
    record.depositAddress = null; record.depositSol = null;
  }
  record.updatedAt = Date.now(); save(record); return record;
}
/** Every wallet of the quote gets a provider it was quoted for and a whole-minute delay; missing = best, 0 min. */
function checkPicks(quote: HusherQuote, raw: unknown): HusherPick[] {
  const given = Array.isArray(raw) ? raw as Partial<HusherPick>[] : [];
  return quote.rates.map((r) => {
    const p = given.find((g) => g && g.address === r.address);
    const provider = p?.provider ?? r.options[0].provider;
    if (!r.options.some((o) => o.provider === provider)) throw new HttpError(400, `${provider} did not quote ${r.address.slice(0, 6)}…. Pick a quoted provider.`);
    const delayMin = p?.delayMin ?? 0;
    if (!Number.isInteger(delayMin) || delayMin < 0 || delayMin > HUSHER_MAX_DELAY_MIN) throw new HttpError(400, `Delay must be a whole number of minutes between 0 and ${HUSHER_MAX_DELAY_MIN}.`);
    return { address: r.address, provider, delayMin };
  });
}
/** Optional "From" wallets: vault wallets, not destinations, at most HUSHER_MAX_SOURCES, adding up to the total. */
function checkSources(plan: HusherPlan, raw: unknown): HusherSource[] | undefined {
  if (raw === undefined || raw === null || (Array.isArray(raw) && !raw.length)) return undefined;
  if (!Array.isArray(raw) || raw.length > HUSHER_MAX_SOURCES) throw new HttpError(400, `Pick 1 to ${HUSHER_MAX_SOURCES} sending wallets.`);
  const ours = new Set(ownedAddresses()); const dest = new Set(plan.recipients.map((r) => r.address)); const seen = new Set<string>();
  let sum = BigInt(0);
  const out = (raw as Partial<HusherSource>[]).map((s) => {
    const address = typeof s?.address === "string" ? s.address : "";
    if (!ours.has(address)) throw new HttpError(400, "Sending wallets must be DONCHAIN wallets.");
    if (dest.has(address)) throw new HttpError(400, "A wallet cannot both send and receive in the same mix.");
    if (seen.has(address)) throw new HttpError(400, "A sending wallet appears twice.");
    seen.add(address);
    let lam: bigint;
    try { lam = parseHusherSol(s.sol); } catch { throw new HttpError(400, "Every sending wallet needs an amount above 0."); }
    sum += lam;
    return { address, sol: String(s.sol).trim() };
  });
  if (sum !== parseHusherSol(plan.totalSol)) throw new HttpError(400, "Sending amounts must add up exactly to the total to mix.");
  return out;
}
export async function husherCreate(quoteId: string, consent: boolean, rawPicks?: unknown, rawSources?: unknown): Promise<HusherOrder> {
  mainnet();
  if (consent !== true) throw new HttpError(400, "Confirm the Husher terms before creating an order.");
  const existing = husherHistory().find((r) => r.id === quoteId);
  if (existing) return existing; // one external creation at most per accepted quote, including timeout/restart
  const st = state();
  if (st.creating.has(quoteId)) throw new HttpError(409, "Order creation is already in progress. Check History.");
  const quote = st.quotes.get(quoteId);
  if (!quote || quote.expiresAt < Date.now()) throw new HttpError(409, "Quote expired. Fetch a fresh quote.");
  const plan = validate(quote);
  const picks = checkPicks(quote, rawPicks);
  const sources = checkSources(plan, rawSources);
  st.creating.add(quoteId);
  try {
    // Husher keeps the last rate it gave this key; Fetch Quote priced every provider in parallel, so price the exact
    // picks again right before creating (a stale rate is answered with "Please reload and try again").
    const j = await call("/api/v1/multi-exchange/rate", {
      sendToken: "SOL", sendNetwork: "SOL", receiveToken: "SOL", receiveNetwork: "SOL",
      totalAmount: Number(plan.totalSol), recipients: quote.rates.map((r, i) => ({ percent: r.percent, provider: picks[i].provider })),
    });
    const rows = (j.data as { recipients?: Record<string, unknown>[] } | undefined)?.recipients;
    const bad = Array.isArray(rows) && rows.length === picks.length ? rows.findIndex((r) => r.success !== true) : 0;
    if (bad >= 0) throw new HttpError(409, `${plan.recipients[bad]?.label ?? "A wallet"}: ${scrub(text(rows?.[bad]?.error) ?? "the picked provider no longer quotes this amount")}. Fetch a new quote.`);
  } catch (e) { st.creating.delete(quoteId); throw e; }
  const rec: HusherOrder = { id: quoteId, at: Date.now(), plan, quote, remoteId: null, orderId: null, status: "Creating", depositAddress: null, depositSol: null, feeSol: null, feePercentage: null, networkFeeSol: null, hashIn: null, trackingUrl: null, recipients: [], error: null, updatedAt: Date.now(), picks, ...(sources ? { sources } : {}) };
  try {
    save(rec); // durable before the non-idempotent remote POST
    st.quotes.delete(quoteId);
    const j = await call("/api/v1/multi-exchange", { send: "SOL", receive: "SOL", sendNetwork: "SOL", receiveNetwork: "SOL", totalAmount: Number(plan.totalSol), recipients: quote.rates.map((r, i) => ({ address: r.address, percent: r.percent, provider: picks[i].provider, timeDelay: picks[i].delayMin })) });
    const d = j.data as Record<string, unknown>;
    const remoteId = text(d?.multiExchangeOrderId) ?? text(d?.orderId);
    if (!remoteId || !/^[A-Za-z0-9_-]{1,100}$/.test(remoteId)) throw new Error("Husher did not return an order ID. Check your Husher order history before retrying.");
    rec.remoteId = remoteId; rec.orderId = text(d.orderId); rec.status = "Awaiting Deposit"; rec.updatedAt = Date.now(); save(rec);
    logActivity(store(), { kind: "fund", ok: true, message: `Husher order created: ${plan.totalSol} SOL → ${plan.recipients.length} destinations. Awaiting deposit.`, wallets: plan.recipients.map((r) => r.address) });
    return await husherRefresh(rec.id);
  } catch (e) {
    const rejected = !rec.remoteId && !!(e as { rejected?: boolean })?.rejected;
    rec.status = rec.remoteId ? "Awaiting Deposit" : rejected ? "Rejected" : "Creation needs review";
    const msg = scrub(e instanceof Error ? e.message : e);
    const http = (e as { httpStatus?: number })?.httpStatus;
    rec.error = rejected ? `Husher refused the order: ${msg} (HTTP ${http}). No order was created and nothing was sent. Fetch a new quote and try again.` : http ? `${msg} (HTTP ${http})` : msg;
    rec.updatedAt = Date.now(); save(rec);
    return rec;
  } finally { st.creating.delete(quoteId); }
}
/** "Pay from wallet": re-verifies the order with Husher, then hands the verified deposit (address + exact amount) to
 *  `send` as one transaction. The order's own "From" wallets when it has them, otherwise the one wallet picked now.
 *  One payment per order unless the previous send job failed. */
export async function husherPay(id: string, from: string | null, send: (sources: { address: string; lamports: bigint }[], to: string) => { id: string }, jobFailed: (jobId: string) => boolean): Promise<HusherOrder> {
  mainnet();
  const rec = await husherRefresh(id);
  if (rec.error || !rec.depositAddress || !rec.depositSol) throw new HttpError(409, rec.error || "This order has no verified deposit instruction.");
  if (rec.hashIn || rec.status !== "Awaiting Deposit") throw new HttpError(409, `This order is ${rec.status}; it no longer needs a deposit.`);
  if (rec.payment && !jobFailed(rec.payment.jobId)) throw new HttpError(409, "A payment for this order was already sent. Wait for Husher to confirm it.");
  const sources: HusherSource[] = rec.sources?.length ? rec.sources : from ? [{ address: from, sol: rec.depositSol }] : [];
  if (!sources.length) throw new HttpError(400, "Pick the wallet that pays the deposit.");
  const ours = new Set(ownedAddresses());
  if (sources.some((s) => !ours.has(s.address))) throw new HttpError(400, "Pay from one of your DONCHAIN wallets.");
  if (sources.some((s) => rec.plan.recipients.some((r) => r.address === s.address))) throw new HttpError(400, "A destination wallet cannot pay its own mixer order.");
  const lams = sources.map((s) => ({ address: s.address, lamports: parseHusherSol(s.sol) }));
  if (lams.reduce((a, s) => a + s.lamports, BigInt(0)) !== parseHusherSol(rec.depositSol)) throw new HttpError(409, "The sending amounts no longer match Husher's deposit amount. Nothing was sent.");
  const job = send(lams, rec.depositAddress);
  rec.payment = { from: sources[0].address, sources, jobId: job.id, at: Date.now() }; rec.updatedAt = Date.now(); save(rec);
  logActivity(store(), { kind: "fund", ok: true, message: `Husher order ${rec.orderId ?? rec.id.slice(0, 8)}: paying ${rec.depositSol} SOL from ${sources.length} wallet(s) in one transaction`, wallets: sources.map((s) => s.address) });
  return rec;
}
