/* Ambient typings for the reused donchain.snipe engine (JS ESM, untouched).
 * Only the exports TRENCH's server calls are declared; argument order mirrors the JS. */

declare module "@/engine/keystore.js" {
  export function keystoreExists(path: string): boolean;
  export function passphraseIssue(passphrase: string): string | null;
  export function assertStrongPassphrase(passphrase: string): void;
  export function saveKeystore(path: string, passphrase: string, entries: unknown): void;
  export function loadKeystore(path: string, passphrase: string): unknown;
  export function safeEqual(a: string, b: string): boolean;
}

declare module "@/engine/solana/keys.js" {
  import type { Keypair } from "@solana/web3.js";
  export function base58Encode(bytes: Uint8Array): string;
  export function parseSolanaKey(secret: string): Keypair;
}

declare module "@/engine/solana/config.js" {
  export const SOLANA_PUBLIC_RPC: string;
  export const HELIUS_SENDER_URL: string;
  export const SOLANA_DEFAULTS: {
    cluster: string;
    rpcUrl: string;
    sendRpcUrl: string;
    slippageBps: number;
    priorityMicroLamports: number;
    maxPriorityMicroLamports: number;
    spreadMs: number;
  };
  export function normalizeSolanaRpc(url: string): string;
  export const JITO_TIP_ACCOUNTS: string[];
  export const SENDER_TIP_LAMPORTS: bigint;
  export function isHeliusSender(url: string): boolean;
  export function withSwqosOnly(url: string): string;
}

declare module "@/engine/solana/state.js" {
  import type { Connection, Keypair } from "@solana/web3.js";
  export interface SolanaWallet {
    label: string;
    address: string;
  }
  export interface SolanaConfig {
    cluster: string;
    rpcUrl: string;
    sendRpcUrl: string;
    slippageBps: number;
    priorityMicroLamports: number;
    maxPriorityMicroLamports: number;
    spreadMs: number;
  }
  export class SolanaState {
    unlocked: boolean;
    keypairs: Map<string, Keypair>;
    wallets: SolanaWallet[];
    config: SolanaConfig;
    connection(): Connection;
    sendConnection(): Connection;
    load(entries: { label: string; secret: string }[]): void;
    lock(): void;
    keypair(address: string): Keypair;
    publicWallets(): SolanaWallet[];
  }
  export function parseSolanaWalletLines(text: string): {
    entries: { label: string; secret: string; solAmount?: string }[];
    errors: string[];
  };
  export function generateSolanaWallets(
    count: number,
    prefix?: string,
    start?: number,
  ): { label: string; secret: string; address: string }[];
}

declare module "@/engine/solana/rpc.js" {
  import type { Connection, PublicKey } from "@solana/web3.js";
  export function makeConnection(cfg: { rpcUrl?: string }): Connection;
  export function getSolBalance(conn: Connection, address: string): Promise<bigint>;
  export function readSolanaBalances(
    conn: Connection,
    owners: string[],
    mint: string,
    tokenProgram: PublicKey,
    retries?: number,
  ): Promise<{ owner: string; sol: bigint; tokens: bigint | null }[]>;
}

declare module "@/engine/solana/send.js" {
  import type { Connection, VersionedTransaction } from "@solana/web3.js";
  export interface SendResult {
    signature: string;
    broadcasts: number;
    confirmed: boolean;
    ms: number;
    error?: string;
  }
  export interface SendOpts {
    dryRun?: boolean;
    rebroadcastMs?: number;
    timeoutMs?: number;
    simulateConn?: Connection;
    lastValidBlockHeight?: number;
    staggerMs?: number;
  }
  export function sendAndConfirm(
    read: Connection,
    send: Connection,
    tx: VersionedTransaction,
    opts?: SendOpts,
  ): Promise<SendResult>;
  export function sendMany(
    read: Connection,
    send: Connection,
    txs: VersionedTransaction[],
    opts?: SendOpts,
  ): Promise<SendResult[]>;
  export function latestBlockhash(conn: Connection): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  export function submitJitoBundle(txs: VersionedTransaction[], opts?: { blockEngineUrl?: string }): Promise<string>;
  export interface BundleResult {
    ok: boolean;
    bundleId: string | null;
    sigs: string[];
    landed?: boolean[];
    error?: string;
  }
  export function sendBundleAndConfirm(
    read: Connection,
    txs: VersionedTransaction[],
    opts?: { timeoutMs?: number; blockEngineUrl?: string },
  ): Promise<BundleResult>;
}

declare module "@/engine/solana/fund.js" {
  import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
  export interface FundStep {
    phase: "wait" | "sent" | "fail";
    index: number;
    total: number;
    delayMs?: number;
    address?: string;
    sol?: string;
    signature?: string;
    error?: string;
  }
  export interface FundResult {
    results: { address: string; sol?: string; ok: boolean; signature?: string; error?: string }[];
    sent: number;
    total: number;
  }
  export function distributeSol(opts: {
    conn: Connection;
    sendConn: Connection;
    fromKeypair: Keypair;
    plan: { address: string | PublicKey; lamports: number | bigint }[];
    delayMinMs?: number;
    delayMaxMs?: number;
    cuPrice?: number;
    onStep?: (s: FundStep) => void;
  }): Promise<FundResult>;
  export function sweepSol(opts: {
    conn: Connection;
    sendConn: Connection;
    wallets: string[];
    to: string | PublicKey;
    keypairOf: (address: string) => Keypair;
    onStep?: (s: FundStep) => void;
  }): Promise<FundResult>;
}

declare module "@/engine/solana/pump/pdas.js" {
  import type { PublicKey } from "@solana/web3.js";
  export const PUMP_PROGRAM: string;
  export const TOKEN_PROGRAM: string;
  export const TOKEN_2022_PROGRAM: string;
  export const ATA_PROGRAM: string;
  export const INITIAL_VIRTUAL_SOL: bigint;
  export const INITIAL_VIRTUAL_TOKENS: bigint;
  export const INITIAL_REAL_TOKENS: bigint;
  export const TOKEN_TOTAL_SUPPLY: bigint;
  export const TOTAL_FEE_BPS: bigint;
  export const PUMP_PROGRAM_ID: PublicKey;
  /** mutable: buy/sell account 1 (`fee_recipient`, read from Global.fee_recipient + fee_recipients) */
  export const PUMP_BUYBACK_FEE_RECIPIENTS: string[];
  /** mutable: buy/sell account 17 (second recipient list, Global offset 741) */
  export const PUMP_FEE_RECIPIENTS: string[];
  export function globalPda(): PublicKey;
  export function mintAuthorityPda(): PublicKey;
  export function bondingCurvePda(mint: PublicKey): PublicKey;
  export function creatorVaultPda(creator: PublicKey): PublicKey;
  export function associatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey;
  export function tokenProgramFor(ownerProgram: string): PublicKey;
  export interface BondingCurve {
    virtualTokenReserves: bigint;
    virtualSolReserves: bigint;
    realTokenReserves: bigint;
    realSolReserves: bigint;
    tokenTotalSupply: bigint;
    complete: boolean;
    creator: PublicKey;
    isCashbackCoin: boolean;
  }
  export function parseBondingCurve(data: Uint8Array | Buffer): BondingCurve;
}

declare module "@/engine/solana/pump/math.js" {
  import type { Keypair, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
  export interface Reserves {
    virtualTokenReserves: bigint;
    virtualSolReserves: bigint;
    realTokenReserves: bigint;
  }
  export interface BuyRow {
    label: string;
    signer: Keypair;
    solIn: bigint;
    cuPrice?: number;
  }
  export interface BuyPlan {
    label: string;
    owner: PublicKey;
    solIn: bigint;
    tokensWanted: bigint;
    maxSolCost: bigint;
    expectedTokens: bigint;
  }
  export interface SellRow {
    label: string;
    signer: Keypair;
    tokens: bigint;
  }
  export interface SellPlan {
    label: string;
    owner: PublicKey;
    tokens: bigint;
    minSolOutput: bigint;
    expectedSol: bigint;
  }
  export const FRESH_CURVE: Reserves;
  export function planBuys(rows: BuyRow[], curve?: Reserves, slippageBps?: number, feeBps?: bigint): BuyPlan[];
  export function planSells(rows: SellRow[], curve: Reserves, slippageBps?: number, feeBps?: bigint): SellPlan[];
  export function buildBuyTx(
    opts: {
      mint: PublicKey;
      creator: PublicKey;
      tokenProgram?: PublicKey;
      cuPrice: number;
      cuLimit?: number;
      ataExists?: boolean;
      tipLamports?: bigint;
      recentBlockhash: string;
    },
    plan: BuyPlan,
  ): VersionedTransaction;
  export function buildSellTx(
    opts: {
      mint: PublicKey;
      creator: PublicKey;
      tokenProgram?: PublicKey;
      cuPrice: number;
      cuLimit?: number;
      tipLamports?: bigint;
      recentBlockhash: string;
      cashback?: boolean;
    },
    plan: SellPlan,
  ): VersionedTransaction;
  export function solOutForTokens(tokens: bigint, curve: Reserves, feeBps?: bigint): bigint;
  export function tipInstruction(from: PublicKey, lamports: bigint | number, index?: number): TransactionInstruction;
  export function signWith(tx: VersionedTransaction, kp: Keypair): VersionedTransaction;
}

declare module "@/engine/solana/pump/positions.js" {
  import type { Connection, PublicKey } from "@solana/web3.js";
  export interface CurveTrade {
    side: "buy" | "sell";
    wallet: string;
    quoteEth: string;
    priceEth: string;
    blockTime: number;
    block: number;
    hash: string;
  }
  export function curveTradeHistory(
    conn: Connection,
    mint: string | PublicKey,
    opts?: { max?: number },
  ): Promise<CurveTrade[]>;
  export interface PositionRow {
    label: string;
    owner: string;
    tokens: bigint;
    balanceKnown: boolean;
    solBalance: bigint;
    supplyPct: number | null;
    isDev: boolean;
    spent: bigint;
    realised: bigint;
    value: bigint;
    pnl: bigint;
    pnlPct: number | null;
  }
  export interface PositionsReport {
    mint: string;
    onCurve: boolean;
    reserves: { virtualTokenReserves: bigint; virtualSolReserves: bigint; realTokenReserves: bigint } | null;
    creator: string | null;
    name: string | null;
    symbol: string | null;
    priceLamports: string;
    realSolReserves: string;
    graduationThreshold: string;
    graduationPct: number;
    positions: PositionRow[];
    totals: { tokens: bigint; spent: bigint; realised: bigint; value: bigint; pnl: bigint };
    historyComplete: boolean;
  }
  export function readPositions(
    conn: Connection,
    mint: PublicKey,
    wallets: { label: string; owner: PublicKey }[],
    opts?: { maxSignatures?: number },
  ): Promise<PositionsReport>;
}

declare module "@/engine/solana/pump/metadata.js" {
  export function uploadPumpMetadata(m: {
    name: string;
    symbol: string;
    description?: string;
    imageBase64?: string;
    imageType?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
  }): Promise<string>;
  export function parseMintMetadata(data: Uint8Array | Buffer): { name: string; symbol: string; uri: string } | null;
  export function ipfsToHttp(uri: string | null | undefined): string;
}

declare module "@/engine/solana/pump/fees.js" {
  import type { Connection, Keypair } from "@solana/web3.js";
  import type { SendResult } from "@/engine/solana/send.js";
  export interface CreatorFee {
    label: string;
    owner: string;
    vault: string;
    lamports: bigint;
    claimable: bigint;
    cashback: bigint;
    ammPending: bigint;
  }
  export function readPumpCreatorFees(
    conn: Connection,
    wallets: { label: string; address: string }[],
  ): Promise<CreatorFee[]>;
  export function claimPumpCreatorFees(
    read: Connection,
    send: Connection,
    payer: Keypair,
    fees: CreatorFee[],
    opts: { cuPrice: number; tipLamports?: bigint },
  ): Promise<{
    claimed: { label: string; owner: string; lamports: bigint }[];
    total: bigint;
    sends: SendResult[];
    error?: string;
  }>;
}

declare module "@/engine/solana/pump/create.js" {
  import type { Keypair } from "@solana/web3.js";
  export function generateMint(vanitySuffix?: string, tries?: number): Keypair;
}

declare module "@/engine/solana/pump/launch.js" {
  import type { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
  import type { BuyPlan, BuyRow, SellRow } from "@/engine/solana/pump/math.js";
  import type { SendResult } from "@/engine/solana/send.js";
  export interface LaunchPrep {
    mint: Keypair;
    createTx: VersionedTransaction;
    atomic: boolean;
    createHasTip: boolean;
    buyTxs: VersionedTransaction[];
    buys: BuyPlan[];
    buyRows: BuyRow[];
    retryOpts: { cuPrice: number; slippageBps: number; tipLamports?: bigint };
    devTokens: bigint;
    blockhash: string;
    lastValidBlockHeight: number;
  }
  export function prepareLaunch(
    conn: Connection,
    params: {
      dev: Keypair;
      name: string;
      symbol: string;
      uri: string;
      devBuyLamports: bigint;
      mint?: Keypair;
      vanitySuffix?: string;
      cashback?: boolean;
    },
    rows: BuyRow[],
    opts?: { cuPrice: number; slippageBps?: number; tipLamports?: bigint; lookupTable?: unknown },
  ): Promise<LaunchPrep>;
  export interface LaunchResult {
    mint: string;
    create: SendResult;
    buys: SendResult[];
    dryRun: boolean;
    atomic: boolean;
  }
  export function executeLaunch(
    read: Connection,
    send: Connection,
    prep: LaunchPrep,
    opts?: { dryRun?: boolean; spreadMs?: number },
  ): Promise<LaunchResult>;
  export interface BundleStep {
    phase: "bundle" | "sent" | "fail";
    index: number;
    total?: number;
    bundle?: boolean;
    error?: string;
  }
  export function launchBundle(
    read: Connection,
    prep: LaunchPrep,
    opts?: { onStep?: (s: BundleStep) => void; timeoutMs?: number; blockEngineUrl?: string },
  ): Promise<{
    mint: string;
    create: { confirmed: boolean; signature?: string; error?: string };
    buys: { confirmed: boolean; error?: string }[];
    atomic: true;
    mode: "bundle";
    bundleErrors: string[];
  }>;
  export function snipeMint(
    read: Connection,
    send: Connection,
    mint: PublicKey,
    rows: BuyRow[],
    opts: { cuPrice: number; slippageBps?: number; tipLamports?: bigint; spreadMs?: number; dryRun?: boolean },
  ): Promise<{ mint: string; buys: SendResult[]; dryRun: boolean; error?: string }>;
  export function sellMint(
    read: Connection,
    send: Connection,
    mint: PublicKey,
    rows: SellRow[],
    opts: { cuPrice: number; slippageBps?: number; tipLamports?: bigint; spreadMs?: number },
  ): Promise<{ mint: string; sells: SendResult[]; error?: string }>;
}
