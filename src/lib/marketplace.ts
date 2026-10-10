export type MarketWallet = { id: string; price: string; balance: string; tier: string; source: string; persona: string; timezone: string; fundedAt: string; txCount: number; tokensUsd: number };
export type MarketOrder = { id: string; provider: "anyswap"; remoteId?: string; status: string; createdAt: string; walletIds: string[]; total?: string; payAddress?: string; expiresAt?: string; received?: string; paymentStatus?: string; imported?: boolean; addresses?: string[]; error?: string };
export type MarketCatalog = { wallets: MarketWallet[]; orders: MarketOrder[] };
export function marketSol(lamports: string): string { const n = BigInt(lamports); return `${n / BigInt(1000000000)}.${(n % BigInt(1000000000)).toString().padStart(9, "0")}`.replace(/\.?0+$/, ""); }
