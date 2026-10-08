/* Robinhood Chain (EVM, chain id 4663, ETH gas) — clients and the Pons V2 contracts.
 * Addresses and ABIs are the ones proven on mainnet by donchain.snipe (src/pons.js) and the fork traces in the
 * pons-v2 notes: factory launchToken / forwarder launchAndBuy, curve buy/sell/getReserves, fee escrow. */
import { createPublicClient, createWalletClient, fallback, http, type Account, type PublicClient } from "viem";
import { robinhood } from "viem/chains";
import { store } from "../store";

export const CHAIN = robinhood;
export const CHAIN_ID = 4663;
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const PONS_PAGE = (token: string) => `https://www.ponsfamily.com/launchpad/${token}`;

const RPCS = ["https://rpc.mainnet.chain.robinhood.com", "https://rpc.ordofi.network"];
/** logs + the chain head: publicnode serves the real head (the default RPC lags 4–6 blocks and moves in bursts) */
const LOG_RPCS = ["https://robinhood-rpc.publicnode.com", "https://rpc.mainnet.chain.robinhood.com"];
/** where signed transactions go first: the sequencer itself (FCFS ordering, accepts eth_sendRawTransactionConditional),
 *  then the public RPC that forwards to it */
export const SEND_URLS = ["https://sequencer.mainnet.chain.robinhood.com", "https://rpc.mainnet.chain.robinhood.com"];

type Bag = { pub: PublicClient | null; logs?: PublicClient | null };
function bag(): Bag {
  const rt = store().runtime;
  if (!rt.rhChain) rt.rhChain = { pub: null } satisfies Bag;
  return rt.rhChain as Bag;
}

export function rhLogs(): PublicClient {
  const b = bag();
  if (!b.logs) {
    b.logs = createPublicClient({
      chain: CHAIN,
      transport: fallback(LOG_RPCS.map((u) => http(u, { timeout: 15_000, retryCount: 1, retryDelay: 300 }))),
    }) as PublicClient;
  }
  return b.logs;
}

export function rhPublic(): PublicClient {
  const b = bag();
  if (!b.pub) {
    b.pub = createPublicClient({
      chain: CHAIN,
      transport: fallback(RPCS.map((u) => http(u, { timeout: 15_000, retryCount: 2, retryDelay: 400 }))),
      batch: { multicall: true },
    }) as PublicClient;
  }
  return b.pub;
}

export function rhWallet(account: Account) {
  return createWalletClient({ account, chain: CHAIN, transport: fallback(RPCS.map((u) => http(u, { timeout: 20_000, retryCount: 1 }))) });
}

export const PONS = {
  factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  launchAndBuy: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948",
  feeEscrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
} as const;

export const ZERO = "0x0000000000000000000000000000000000000000" as const;

const SOCIALS = [
  { name: "twitter", type: "string" },
  { name: "telegram", type: "string" },
  { name: "discord", type: "string" },
  { name: "website", type: "string" },
  { name: "farcaster", type: "string" },
] as const;

const LAUNCH_PARAMS = [
  { name: "name", type: "string" },
  { name: "symbol", type: "string" },
  { name: "logo", type: "string" },
  { name: "description", type: "string" },
  { name: "socials", type: "tuple", components: SOCIALS },
  { name: "creatorFeeRecipient", type: "address" },
  { name: "creatorTaxBps", type: "uint16" },
  { name: "buybackEnabled", type: "bool" },
  { name: "expectedEconomics", type: "bytes32" },
  { name: "salt", type: "bytes32" },
] as const;

export const FACTORY_ABI = [
  {
    type: "function",
    name: "launchToken",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: LAUNCH_PARAMS },
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
      { name: "snipeTaxExemptions", type: "address[]" },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
    ],
  },
  { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "previewLaunchEconomics",
    stateMutability: "view",
    inputs: [
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  { type: "function", name: "canLaunch", stateMutability: "view", inputs: [{ name: "launcher", type: "address" }], outputs: [{ type: "bool" }] },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "curve", type: "address", indexed: true },
      { name: "deployer", type: "address", indexed: true },
      { name: "pairToken", type: "address", indexed: false },
      { name: "launchConfigId", type: "uint256", indexed: false },
      { name: "graduationThreshold", type: "uint256", indexed: false },
    ],
  },
] as const;

export const LAUNCH_AND_BUY_ABI = [
  {
    type: "function",
    name: "launchAndBuy",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: LAUNCH_PARAMS },
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
      { name: "quoteIn", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "snipeTaxExemptions", type: "address[]" },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
      { name: "tokensOut", type: "uint256" },
    ],
  },
] as const;

export const CURVE_ABI = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "quoteIn", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokensIn", type: "uint256" },
      { name: "minQuoteOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "quoteOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "quoteReserve_", type: "uint256" },
      { name: "tokenReserve_", type: "uint256" },
    ],
  },
  { type: "function", name: "realQuoteReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduationThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creatorTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event",
    name: "CurveBuy",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "quoteIn", type: "uint256", indexed: false },
      { name: "tokensOut", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "tax", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CurveSell",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "tokensIn", type: "uint256", indexed: false },
      { name: "quoteOut", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "tax", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** a PonsV2LauncherToken carries its own metadata (logo ipfs://cid, description, socials) and its curve */
export const PONS_TOKEN_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "curve", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "deployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "socials",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" },
    ],
  },
] as const;

/** a fresh Pons V2 curve (config 0, ETH pair): 1.68 ETH of phantom quote against 1e9 tokens — checked against a
 *  launchAndBuy simulation on mainnet (0.01 ETH → 5 858 334.81 tokens, 2026-10-08) */
export const FRESH_QUOTE = BigInt("1680000000000000000");
export const FRESH_TOKENS = BigInt("1000000000000000000000000000");

/** ipfs://cid (what Pons tokens carry) → an https gateway. gateway.pinata.cloud serves any pinned CID (2026-10-08);
 *  pump.mypinata.cloud answers 403 for CIDs pump.fun did not pin, ponsfamily.com/api/ipfs/content is gone (404) */
export function logoUrl(logo: string | null | undefined): string | null {
  if (!logo) return null;
  const cid = logo.match(/^ipfs:\/\/([A-Za-z0-9]+)/)?.[1] ?? logo.match(/\/ipfs\/([A-Za-z0-9]+)/)?.[1];
  if (cid) return `https://gateway.pinata.cloud/ipfs/${cid}`;
  return /^https?:\/\//.test(logo) ? logo : null;
}

export const ESCROW_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "recipient", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** ETH/USD spot (Coinbase public price, 60 s cache) — display only */
export async function ethUsd(): Promise<number | null> {
  const rt = store().runtime as { rhEthUsd?: { at: number; v: number | null } };
  if (rt.rhEthUsd && Date.now() - rt.rhEthUsd.at < 60_000) return rt.rhEthUsd.v;
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { data?: { amount?: string } };
    const v = Number(j.data?.amount);
    rt.rhEthUsd = { at: Date.now(), v: Number.isFinite(v) && v > 0 ? v : null };
  } catch {
    rt.rhEthUsd = { at: Date.now(), v: rt.rhEthUsd?.v ?? null };
  }
  return rt.rhEthUsd.v;
}
