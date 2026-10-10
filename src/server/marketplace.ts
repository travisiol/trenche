import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { HttpError } from "./api";
import { store } from "./store";
import { requireUnlocked } from "./engine";
import { importWallets } from "./wallets";
import { parseSolanaKey } from "@/engine/solana/keys.js";
import type { MarketOrder, MarketWallet } from "@/lib/marketplace";
const BASE = "https://marketplace.anyswap.bot/api";
type Obj = Record<string, unknown>;
type Saved = MarketOrder & { deliveryPending?: boolean; delivery?: { salt: string; iv: string; tag: string; data: string } };
const object = (v: unknown): Obj => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(502, "Unexpected marketplace response."); return v as Obj; };
const amount = (v: unknown): string => { if (typeof v !== "string" || !/^\d{1,20}$/.test(v)) throw new HttpError(502, "Invalid marketplace amount."); return v; };
const idOf = (v: unknown): string => { if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(v)) throw new HttpError(400, "Invalid marketplace ID."); return v; };
const file = () => path.join(store().dir, "marketplace-orders.json");
function read(): Saved[] { try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw new HttpError(500, "Cannot read marketplace history."); } }
function save(orders: Saved[]) { const dest = file(); const temp = dest + ".tmp"; fs.writeFileSync(temp, JSON.stringify(orders), { mode: 0o600 }); fs.renameSync(temp, dest); }
function publicOrder(o: Saved): MarketOrder { const { delivery: _delivery, deliveryPending: _pending, ...rest } = o; void _delivery; void _pending; return rest; }
export const marketHistory = () => read().map(publicOrder).reverse();
function mainnet() { if (store().settings.cluster !== "mainnet") throw new HttpError(400, "Marketplace purchases require Solana mainnet."); }
async function remote(route: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try { res = await fetch(BASE + route, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000) }); } catch { throw new HttpError(502, "Marketplace unavailable or timed out. Check your order history before retrying."); }
  if (!res.ok) throw new HttpError(502, `Marketplace returned HTTP ${res.status}.`);
  try { return await res.json(); } catch { throw new HttpError(502, "Unreadable marketplace response."); }
}
export async function marketCatalog(): Promise<MarketWallet[]> {
  const data = object(await remote("/catalog?chain=solana&count=200"));
  if (!Array.isArray(data.items)) throw new HttpError(502, "Missing marketplace catalog.");
  return data.items.map(v => { const w = object(v); if (w.chain !== "solana") throw new HttpError(502, "Wrong marketplace chain."); return { id: idOf(w.id), price: amount(w.user_price), balance: amount(w.balance), tier: String(w.tier ?? ""), source: String(w.funding_source ?? ""), persona: String(w.persona_name ?? ""), timezone: String(w.timezone_name ?? ""), fundedAt: String(w.funded_at ?? ""), txCount: Number(w.tx_count) || 0, tokensUsd: Array.isArray(w.token_holdings) ? w.token_holdings.reduce((n: number, t: unknown) => n + (Number(object(t).usd_value) || 0), 0) : 0 }; });
}
function applyQuote(o: Saved, raw: unknown) {
  const q = object(raw);
  if (q.id !== o.remoteId || q.buyer_ref !== o.id || q.chain !== "solana" || !Array.isArray(q.items)) throw new HttpError(502, "Marketplace order identity mismatch.");
  const items = q.items.map(object); const ids = items.map(i => idOf(i.wallet_id));
  if (ids.length !== o.walletIds.length || new Set(ids).size !== ids.length || ids.some(i => !o.walletIds.includes(i))) throw new HttpError(502, "Marketplace changed the wallet selection.");
  const total = amount(q.total_due); const sum = items.reduce((n, i) => n + BigInt(amount(i.user_price)), BigInt(0));
  if (BigInt(total) !== sum || amount(q.user_price_total) !== total || BigInt(amount(q.topup_required)) !== BigInt(0) || (q.expected_amount != null && amount(q.expected_amount) !== total)) throw new HttpError(502, "Marketplace payment amount mismatch.");
  if (o.total && o.total !== total) throw new HttpError(502, "Marketplace changed the order price.");
  const addr = typeof q.pay_address === "string" ? q.pay_address : undefined;
  if (addr) { try { new PublicKey(addr); } catch { throw new HttpError(502, "Invalid marketplace payment address."); } }
  if (o.payAddress && addr !== o.payAddress) throw new HttpError(502, "Marketplace changed the payment address.");
  const expires = String(q.reserved_until ?? ""); if (!Number.isFinite(Date.parse(expires))) throw new HttpError(502, "Invalid reservation expiry.");
  o.status = String(q.status); o.total = total; o.payAddress = addr; o.expiresAt = expires;
  o.received = q.received_amount == null ? undefined : amount(q.received_amount); o.paymentStatus = String(q.payment_status ?? ""); delete o.error;
}
const busy = new Set<string>();
async function exclusive<T>(id: string, work: () => Promise<T>): Promise<T> { if (busy.has(id)) throw new HttpError(409, "This marketplace operation is already running."); busy.add(id); try { return await work(); } finally { busy.delete(id); } }
export async function reserveMarket(body: Obj): Promise<MarketOrder> {
  mainnet(); requireUnlocked(); const id = idOf(body.id);
  if (body.consent !== true) throw new HttpError(400, "Accept the purchase terms first.");
  if (!Array.isArray(body.walletIds) || body.walletIds.length < 1 || body.walletIds.length > 20) throw new HttpError(400, "Select 1 to 20 wallets.");
  const ids = body.walletIds.map(idOf); if (new Set(ids).size !== ids.length) throw new HttpError(400, "Duplicate wallets.");
  return exclusive(id, async () => {
    const existing = read().find(o => o.id === id); if (existing) { if (existing.walletIds.join() !== ids.join()) throw new HttpError(409, "Order ID already used."); return publicOrder(existing); }
    const catalog = await marketCatalog(); const chosen = ids.map(i => catalog.find(w => w.id === i));
    if (chosen.some(w => !w)) throw new HttpError(409, "A selected wallet is no longer available. Refresh the catalog.");
    const total = chosen.reduce((n, w) => n + BigInt(w!.price), BigInt(0)).toString();
    if (body.total !== total) throw new HttpError(409, "Prices changed. Refresh the catalog.");
    const o: Saved = { id, provider: "anyswap", walletIds: ids, total, createdAt: new Date().toISOString(), status: "creating" };
    save([...read(), o]);
    try {
      const q = object(await remote("/quote", { chain: "solana", count: ids.length, wallet_ids: ids, buyer_ref: id }));
      o.remoteId = idOf(q.id); applyQuote(o, q);
    } catch (e) { o.status = "review"; o.error = e instanceof Error ? e.message : "Creation needs review."; delete o.payAddress; }
    save(read().map(x => x.id === id ? o : x)); return publicOrder(o);
  });
}
async function quoteFor(o: Saved) { return o.remoteId ? remote(`/quote/${encodeURIComponent(o.remoteId)}`) : remote(`/order/${encodeURIComponent(o.id)}`).then(r => object(r).quote); }
export async function refreshMarket(id: string): Promise<MarketOrder> {
  idOf(id); return exclusive(id, async () => {
    const o = read().find(x => x.id === id); if (!o) throw new HttpError(404, "Order not found.");
    if (o.imported) return publicOrder(o);
    try { const q = object(await quoteFor(o)); if (!o.remoteId) o.remoteId = idOf(q.id); applyQuote(o, q); }
    catch (e) { o.error = e instanceof Error ? e.message : "Cannot refresh order."; delete o.payAddress; }
    save(read().map(x => x.id === id ? o : x)); return publicOrder(o);
  });
}
function encrypt(keys: unknown, passphrase: string): NonNullable<Saved["delivery"]> {
  const salt = randomBytes(16), iv = randomBytes(12); const key = scryptSync(passphrase, salt, 32); const c = createCipheriv("aes-256-gcm", key, iv); const data = Buffer.concat([c.update(JSON.stringify(keys)), c.final()]); key.fill(0);
  return { salt: salt.toString("hex"), iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data: data.toString("base64") };
}
function decrypt(d: NonNullable<Saved["delivery"]>): unknown {
  const key = scryptSync(store().passphrase!, Buffer.from(d.salt, "hex"), 32); const c = createDecipheriv("aes-256-gcm", key, Buffer.from(d.iv, "hex")); c.setAuthTag(Buffer.from(d.tag, "hex"));
  try { return JSON.parse(Buffer.concat([c.update(Buffer.from(d.data, "base64")), c.final()]).toString()); } finally { key.fill(0); }
}
export async function importMarket(id: string): Promise<MarketOrder> {
  mainnet(); requireUnlocked(); idOf(id); const passphrase = store().passphrase!;
  return exclusive(id, async () => {
    const o = read().find(x => x.id === id); if (!o) throw new HttpError(404, "Order not found."); if (o.imported) return publicOrder(o);
    const q = await quoteFor(o); applyQuote(o, q);
    if (!["settled", "completed", "paid", "delivered"].includes(o.status) || !o.received || BigInt(o.received) < BigInt(o.total!)) throw new HttpError(409, "Payment is not confirmed yet.");
    if (!o.delivery) {
      if (o.deliveryPending) throw new HttpError(409, "Key delivery needs provider review. Do not repeat a one-time key request.");
      o.deliveryPending = true; save(read().map(x => x.id === id ? o : x));
      const raw = await remote(`/quote/${encodeURIComponent(o.remoteId!)}/keys`);
      if (!Array.isArray(raw) || raw.length !== o.walletIds.length) throw new HttpError(502, "Incomplete key delivery. Contact the provider before retrying.");
      o.delivery = encrypt(raw, passphrase); save(read().map(x => x.id === id ? o : x));
    }
    const raw = decrypt(o.delivery); if (!Array.isArray(raw)) throw new HttpError(502, "Invalid key delivery.");
    const seen = new Set<string>(); const addresses: string[] = [];
    const lines = raw.map(v => {
      const k = object(v); const wid = idOf(k.wallet_id); if (!o.walletIds.includes(wid) || seen.has(wid)) throw new HttpError(502, "Delivered wallet IDs mismatch."); seen.add(wid);
      const s = String(k.private_key_hex ?? ""); let pair: Keypair;
      try {
        if (/^(?:0x)?[0-9a-fA-F]{64}$/.test(s)) pair = Keypair.fromSeed(Buffer.from(s.replace(/^0x/, ""), "hex"));
        else if (/^(?:0x)?[0-9a-fA-F]{128}$/.test(s)) pair = Keypair.fromSecretKey(Buffer.from(s.replace(/^0x/, ""), "hex"));
        else pair = parseSolanaKey(s);
      } catch { throw new HttpError(502, "Unsupported Solana key format. Encrypted delivery retained for recovery."); }
      const a = pair.publicKey.toBase58(); if (typeof k.pubkey === "string" && k.pubkey !== a) throw new HttpError(502, "Delivered public key mismatch."); if (addresses.includes(a)) throw new HttpError(502, "Duplicate delivered key."); addresses.push(a);
      return JSON.stringify(Array.from(pair.secretKey));
    });
    requireUnlocked(); const result = importWallets(lines, "AnySwap"); if (result.errors.length) throw new HttpError(502, "Wallet import failed. Encrypted delivery retained.");
    o.imported = true; o.addresses = addresses; o.status = "imported"; delete o.delivery; delete o.error;
    save(read().map(x => x.id === id ? o : x)); return publicOrder(o);
  });
}
export async function cancelMarket(id: string): Promise<MarketOrder> {
  requireUnlocked(); idOf(id); return exclusive(id, async () => {
    const o = read().find(x => x.id === id); if (!o || !o.remoteId) throw new HttpError(404, "Order not found."); applyQuote(o, await quoteFor(o));
    if (o.status !== "reserved" || (o.received && BigInt(o.received) > BigInt(0))) throw new HttpError(409, "Cannot cancel a funded order.");
    await remote(`/quote/${encodeURIComponent(o.remoteId)}/cancel`, {}); o.status = "cancelled"; delete o.payAddress; save(read().map(x => x.id === id ? o : x)); return publicOrder(o);
  });
}

export async function settleMarket(id: string): Promise<MarketOrder> {
  mainnet(); requireUnlocked(); idOf(id); return exclusive(id, async () => {
    const o = read().find(x => x.id === id); if (!o || !o.remoteId) throw new HttpError(404, "Order not found.");
    applyQuote(o, await quoteFor(o)); if (o.imported || ["cancelled", "failed"].includes(o.status)) throw new HttpError(409, "Order cannot be settled.");
    await remote(`/quote/${encodeURIComponent(o.remoteId)}/settle`, {}); applyQuote(o, await quoteFor(o));
    save(read().map(x => x.id === id ? o : x)); return publicOrder(o);
  });
}
