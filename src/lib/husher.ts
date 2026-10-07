export type HusherRecipient = { address: string; label: string; sol: string };
export type HusherPlan = { totalSol: string; recipients: HusherRecipient[] };
/** One exchange route for a wallet: Husher sends each destination through the provider picked for it. */
export type HusherOption = { provider: string; receiveSol: string };
export type HusherQuote = HusherPlan & {
  id: string; expiresAt: number; receiveSol: string;
  /** providers that quoted at least one wallet */
  providers: string[];
  /** receiveSol = best option; options sorted best first */
  rates: { address: string; sendSol: string; receiveSol: string; percent: number; minimum: string | null; options: HusherOption[] }[];
};
/** provider + delay (minutes, 0 = instant) chosen per wallet before the order is created */
/** what husher.io's own page sends with every order (with the public IP, added by the server) */
export type HusherClientMeta = { timezone: string; language: string; userAgent: string };
export type HusherPick = { address: string; provider: string; delayMin: number };
export const HUSHER_MAX_DELAY_MIN = 10_080;
/** a sending wallet and the SOL it puts into the deposit */
export type HusherSource = { address: string; sol: string };
export const HUSHER_MAX_SOURCES = 8;
/** "Max" on a sending wallet keeps this much behind: the fee if it pays it, and the rent-exempt minimum. */
export const HUSHER_KEEP_LAM = BigInt(1_000_000);
export const HUSHER_PROVIDERS: Record<string, { label: string; color: string }> = {
  binance: { label: "Binance", color: "#F0B90B" },
  husher: { label: "Husher", color: "#3B82F6" },
  kucoin: { label: "KuCoin", color: "#23AF91" },
  bybit: { label: "Bybit", color: "#F7A600" },
  bitget: { label: "Bitget", color: "#00F0FF" },
  htx: { label: "HTX", color: "#2B6DEF" },
  mexc: { label: "MEXC", color: "#1972E2" },
  gate: { label: "Gate", color: "#2354E6" },
  whitebit: { label: "WhiteBIT", color: "#E6E6E6" },
};
export const providerLabel = (p: string) => HUSHER_PROVIDERS[p]?.label ?? p;
export type HusherOrder = {
  id: string; at: number; plan: HusherPlan; quote: HusherQuote;
  remoteId: string | null; orderId: string | null; status: string;
  depositAddress: string | null; depositSol: string | null;
  feeSol: string | null; feePercentage: number | null; networkFeeSol: string | null;
  hashIn: string | null; trackingUrl: string | null;
  recipients: { address: string; status: string; receiveSol: string; hashOut: string | null }[];
  error: string | null; updatedAt: number;
  /** absent on orders created before providers could be picked (= husher, no delay) */
  picks?: HusherPick[];
  /** "From" wallets picked before the quote; their amounts add up to the deposit exactly */
  sources?: HusherSource[];
  /** "Pay from wallet": the vault send job that funds the deposit (one transaction, every source signs) */
  payment?: { from: string; sources?: HusherSource[]; jobId: string; at: number };
};
export type HusherState = { configured: boolean; mainnet: boolean; orders: HusherOrder[] };

/** Positive decimal SOL values, without floating-point rounding. */
export function parseHusherSol(v: unknown): bigint {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d+(?:\.\d{1,9})?$/.test(s)) throw new Error("Enter a SOL amount with up to 9 decimal places.");
  const [whole, fraction = ""] = s.split(".");
  const lam = BigInt(whole) * BigInt(1_000_000_000) + BigInt(fraction.padEnd(9, "0"));
  if (lam <= BigInt(0) || lam > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("SOL amount is outside the supported range.");
  return lam;
}
export function formatHusherSol(lam: bigint): string {
  const s = lam.toString().padStart(10, "0");
  return `${s.slice(0, -9)}.${s.slice(-9)}`.replace(/\.?0+$/, "");
}
export function splitHusherSol(total: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Select 1 to 1000 wallets.");
  const lam = parseHusherSol(total); const n = BigInt(count);
  if (lam < n) throw new Error("Amount is too small to split across these wallets.");
  return Array.from({ length: count }, (_, i) => formatHusherSol(lam / n + (BigInt(i) < lam % n ? BigInt(1) : BigInt(0))));
}
export function husherAllocation(plan: HusherPlan) {
  const total = parseHusherSol(plan.totalSol);
  if (!Array.isArray(plan.recipients) || !plan.recipients.length || plan.recipients.length > 1000) throw new Error("Select 1 to 1000 destination wallets.");
  const amounts = plan.recipients.map((r) => parseHusherSol(r.sol));
  if (amounts.reduce((a, b) => a + b, BigInt(0)) !== total) throw new Error("Destination allocations must add up exactly to the deposit total. Use Split equal or adjust the amounts.");
  // Percent units have ten decimal places; the final recipient absorbs the rounding remainder.
  const scale = BigInt(1_000_000_000_000); let used = BigInt(0);
  return amounts.map((amount, i) => {
    const units = i === amounts.length - 1 ? scale - used : amount * scale / total;
    used += units;
    if (units <= BigInt(0)) throw new Error("An allocation is too small relative to the total.");
    return Number(units) / 1e10;
  });
}
