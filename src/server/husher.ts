/** Husher multi-exchange API. Only order creation: deposits are explicitly funded by the user. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { HttpError } from "./api";
import { store, readJson, writeJson, logActivity } from "./store";
import { ownedAddresses } from "./wallets";
import { husherAllocation, parseHusherSol, type HusherPlan, type HusherQuote, type HusherOrder } from "@/lib/husher";

const BASE = "https://api.husher.net";
const QUOTE_MS = 60_000;
type State = { quotes: Map<string, HusherQuote>; creating: Set<string> };
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
  if (!j || typeof j !== "object" || !res.ok || j.success !== true) throw new HttpError(res.status === 401 || res.status === 403 ? 403 : 502, scrub(j?.message || j?.error || `Husher HTTP ${res.status}`));
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
export async function husherQuote(raw: HusherPlan): Promise<HusherQuote> {
  const plan = validate(raw); const percents = husherAllocation(plan);
  const j = await call("/api/v1/multi-exchange/rate", {
    sendToken: "SOL", sendNetwork: "SOL", receiveToken: "SOL", receiveNetwork: "SOL",
    totalAmount: Number(plan.totalSol), recipients: percents.map((percent) => ({ percent, provider: "husher" })),
  });
  const data = j.data as { recipients?: Record<string, unknown>[]; totalReceiveAmount?: unknown } | undefined;
  if (!data || !Array.isArray(data.recipients) || data.recipients.length !== plan.recipients.length) throw new HttpError(502, "Husher returned an incomplete quote.");
  const rates = data.recipients.map((r, i) => {
    if (r.success !== true) throw new HttpError(400, `${plan.recipients[i].label}: ${scrub(r.error || "No quote available for this allocation.")}`);
    const nested = typeof r.rate === "object" && r.rate ? r.rate as Record<string, unknown> : {};
    const receiveSol = amount(r.receiveAmount ?? nested.receiveAmount);
    const sendSol = amount(r.sendAmount ?? nested.sendAmount);
    if (!receiveSol || Number(receiveSol) <= 0 || !sendSol) throw new HttpError(502, "Husher returned invalid amounts.");
    return { address: plan.recipients[i].address, sendSol, receiveSol, percent: percents[i], minimum: text(r.minimum) };
  });
  const receiveSol = amount(data.totalReceiveAmount) ?? rates.reduce((sum, r) => sum + Number(r.receiveSol), 0).toFixed(9);
  const quote: HusherQuote = { ...plan, id: randomUUID(), expiresAt: Date.now() + QUOTE_MS, receiveSol, rates };
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
export async function husherCreate(quoteId: string, consent: boolean): Promise<HusherOrder> {
  mainnet();
  if (consent !== true) throw new HttpError(400, "Confirm the Husher terms before creating an order.");
  const existing = husherHistory().find((r) => r.id === quoteId);
  if (existing) return existing; // one external creation at most per accepted quote, including timeout/restart
  const st = state();
  if (st.creating.has(quoteId)) throw new HttpError(409, "Order creation is already in progress. Check History.");
  const quote = st.quotes.get(quoteId);
  if (!quote || quote.expiresAt < Date.now()) throw new HttpError(409, "Quote expired. Fetch a fresh quote.");
  const plan = validate(quote);
  st.creating.add(quoteId);
  const rec: HusherOrder = { id: quoteId, at: Date.now(), plan, quote, remoteId: null, orderId: null, status: "Creating", depositAddress: null, depositSol: null, feeSol: null, feePercentage: null, networkFeeSol: null, hashIn: null, trackingUrl: null, recipients: [], error: null, updatedAt: Date.now() };
  try {
    save(rec); // durable before the non-idempotent remote POST
    st.quotes.delete(quoteId);
    const j = await call("/api/v1/multi-exchange", { send: "SOL", receive: "SOL", sendNetwork: "SOL", receiveNetwork: "SOL", totalAmount: Number(plan.totalSol), recipients: quote.rates.map((r) => ({ address: r.address, percent: r.percent, provider: "husher", timeDelay: 0 })) });
    const d = j.data as Record<string, unknown>;
    const remoteId = text(d?.multiExchangeOrderId) ?? text(d?.orderId);
    if (!remoteId || !/^[A-Za-z0-9_-]{1,100}$/.test(remoteId)) throw new Error("Husher did not return an order ID. Check your Husher order history before retrying.");
    rec.remoteId = remoteId; rec.orderId = text(d.orderId); rec.status = "Awaiting Deposit"; rec.updatedAt = Date.now(); save(rec);
    logActivity(store(), { kind: "fund", ok: true, message: `Husher order created: ${plan.totalSol} SOL → ${plan.recipients.length} destinations. Awaiting manual deposit.`, wallets: plan.recipients.map((r) => r.address) });
    return await husherRefresh(rec.id);
  } catch (e) {
    rec.status = rec.remoteId ? "Awaiting Deposit" : "Creation needs review";
    rec.error = scrub(e instanceof Error ? e.message : e); rec.updatedAt = Date.now(); save(rec);
    return rec;
  } finally { st.creating.delete(quoteId); }
}
