/**
 * TRENCH — shared API contract (server ⇄ UI).
 *
 * Conventions (BRIEF.md):
 *  - every error is `{ error: string }` with a 4xx/5xx status (type ApiError);
 *  - SOL amounts cross the API as decimal STRINGS ("0.25"); lamports/BigInt stay inside the server;
 *  - a number the server cannot compute is `null`, never a placeholder;
 *  - timestamps are epoch milliseconds unless the field name says otherwise (`blockTime` = seconds).
 */

export type ApiError = { error: string };

/* ------------------------------------------------------------------ vault */

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  /** absolute path of keystore.enc.json (informational) */
  path: string;
};
export type VaultCreateRequest = { passphrase: string };
export type VaultUnlockRequest = { passphrase: string };
/** POST /api/vault/create | unlock | lock */
export type VaultResponse = { ok: true } & VaultStatus;

/* ---------------------------------------------------------------- wallets */

export type WalletInfo = {
  address: string;
  label: string;
  /** group id or null */
  group: string | null;
  archived: boolean;
  order: number;
  /** SOL balance as decimal string, null when not read yet / RPC unreachable */
  sol: string | null;
};
export type WalletGroup = { id: string; name: string };
/** GET /api/wallets */
export type WalletsResponse = {
  wallets: WalletInfo[];
  groups: WalletGroup[];
  /** active wallet address or null */
  active: string | null;
  unlocked: boolean;
};
export type WalletsGenerateRequest = { count: number; label?: string; group?: string };
export type WalletsGenerateResponse = WalletsResponse & { addresses: string[] };
/** one base58 secret (or JSON byte array) per line, optional "label, key" */
export type WalletsImportRequest = { lines: string[] };
export type WalletsImportResponse = WalletsResponse & { added: number; errors: string[] };
export type WalletsUpdateRequest = {
  address: string;
  label?: string;
  /** group id, or null to remove from its group */
  group?: string | null;
  archived?: boolean;
  order?: number;
};
export type WalletsActiveRequest = { address: string };
export type WalletsExportRequest = { address?: string; addresses?: string[]; passphrase: string };
export type WalletsExportResponse = { keys: { address: string; label: string; secret: string }[] };
export type WalletsRemoveRequest = { addresses: string[] };
export type GroupCreateRequest = { name: string };
/** POST /api/groups → the new group + full wallet state */
export type GroupCreateResponse = WalletsResponse & { group: WalletGroup };
/** GET /api/balances → { [address]: "1.234567" | null } (5 s cache; null = unreadable) */
export type BalancesResponse = Record<string, string | null>;

/* ------------------------------------------------------------------- jobs */

/** "stopped" = the server restarted while the job ran (restored from jobs.json; nothing more will be sent) */
export type JobStatus = "running" | "done" | "error" | "stopped";
export type JobStep = {
  ok: boolean;
  /** epoch ms */
  at: number;
  phase?: string;
  label?: string;
  address?: string;
  sol?: string;
  signature?: string | null;
  error?: string;
  note?: string;
};
/** GET /api/jobs/[id] */
export type JobView = {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  /** cluster the job ran on — build explorer links with `?cluster=devnet` when "devnet" */
  cluster: Cluster;
  /** true when status is "done", "error" or "stopped" */
  done: boolean;
  total: number;
  /** steps completed (ok or failed) */
  completed: number;
  sent: number;
  failed: number;
  /** epoch ms of the next scheduled send while the job waits, else 0 */
  nextAt: number;
  steps: JobStep[];
  error: string | null;
  /** free-form per-kind payload (launch: mint, createSignature…; volume: round…) */
  extra: Record<string, unknown> | null;
  startedAt: number;
  endedAt: number | null;
};
export type JobCreated = { jobId: string };
/** GET /api/jobs */
export type JobsListResponse = { jobs: JobView[] };

/* ------------------------------------------------------------------ funds */

export type FundWithdrawRequest = { from: string; to: string; sol: string };
/** viaRelay: source → fresh in-memory relay wallet → destination (two signatures per transfer; the relay key is
 *  never stored; on a hop-2 failure the relay sweeps back to the source). The job shows both hops. */
export type FundTransferRequest = { from: string; to: string; sol: string; viaRelay?: boolean };
export type FundDisperseRequest = {
  from: string;
  to: string[];
  minSol: string;
  maxSol: string;
  /** delays in milliseconds between sends */
  minDelay: number;
  maxDelay: number;
  /** one fresh relay wallet per destination (see FundTransferRequest) */
  viaRelay?: boolean;
};
/** POST /api/dev/airdrop — devnet only (409 on mainnet); 429 when the faucet refuses, 504 when not confirmed in 60 s */
export type AirdropRequest = { wallet: string; sol?: string };
export type AirdropResponse = {
  wallet: string;
  sol: string;
  signature: string;
  confirmed: boolean;
  error: string | null;
  cluster: "devnet";
  explorer: string;
  /** wallet balance after the airdrop, null when unreadable */
  balance: string | null;
};
export type FundConsolidateRequest = { from: string[]; to: string };

/* --------------------------------------------------------------- settings */

export type Cluster = "mainnet" | "devnet";
export type Settings = {
  /** "mainnet" (default) or "devnet". On devnet: reads/sends on api.devnet.solana.com (or a saved RPC whose
   *  URL names devnet), Jito and the Helius Sender are disabled (bundles fall back to sequential sends, the job
   *  says so), explorer links need `explorerSuffix`, and POST /api/dev/airdrop is enabled. */
  cluster: Cluster;
  /** "" on mainnet, "?cluster=devnet" on devnet — append it to every solscan link */
  explorerSuffix: string;
  /** the RPC URLs actually used right now (resolved from cluster, rpcUrl, Helius key) */
  effectiveRpcUrl: string;
  effectiveSendRpcUrl: string;
  /** read RPC (default SOLANA_PUBLIC_RPC) */
  rpcUrl: string;
  /** send RPC (default Helius sender; may equal rpcUrl) */
  sendRpcUrl: string;
  /** true when a PumpPortal key is stored; the key itself is never returned */
  hasPumpportalKey: boolean;
  /** true when a Helius key is stored; when set and rpcUrl is empty the server reads from
   *  `https://mainnet.helius-rpc.com/?api-key=<key>` */
  hasHeliusKey: boolean;
  /** when true, trades/launches that carry a tip go through Jito bundles by default */
  jitoEnabled: boolean;
  slippageBps: number;
  /** priority fee, micro-lamports per CU */
  cuPrice: number;
  /** default Jito tip in SOL (decimal string) */
  tipSol: string;
  /** quick-buy presets P1..P3 in SOL (decimal strings) */
  presets: [string, string, string];
  keybinds: { quickBuy: [string, string, string]; close: string };
  theme: "dark";
  /** pump.fun constants in use for this cluster (null until the first trade/launch read them on devnet) */
  pump: { cluster: Cluster; feeRecipients: string[]; secondRecipients: string[]; initialVirtualSol: string; initialVirtualTokens: string; initialRealTokens: string; at: number } | null;
};
/** POST /api/settings — partial; `pumpportalKey: ""` clears the key, omit to keep */
export type SettingsUpdateRequest = Partial<
  Omit<Settings, "hasPumpportalKey" | "hasHeliusKey" | "theme" | "explorerSuffix" | "effectiveRpcUrl" | "effectiveSendRpcUrl" | "pump">
> & {
  pumpportalKey?: string;
  /** "" clears, omit keeps */
  heliusKey?: string;
};

/* ----------------------------------------------------------------- market */

export type FeedColumn = "new" | "almost" | "migrated";

export type FeedCard = {
  mint: string;
  name: string | null;
  symbol: string | null;
  /** http(s) image URL from the token metadata (ipfs already rewritten), null until resolved */
  image: string | null;
  /** fast CDN guess `https://axiomtrading-v2.axiom-cdn.io/<mint>.webp` — exists for most pump mints,
   *  NOT verified by the server: the UI must fall back to `image` on load error */
  imageCdn: string;
  uri: string | null;
  description: string | null;
  creator: string | null;
  /** epoch ms — time the create event was seen by this server */
  createdAt: number;
  createSignature: string | null;
  bondingCurve: string | null;
  pool: string | null;
  isMayhem: boolean;
  /** bonding progress 0..100 (null until the curve was read) */
  progress: number | null;
  complete: boolean;
  /** true after a migration event or complete=true */
  migrated: boolean;
  marketCapSol: number | null;
  marketCapUsd: number | null;
  /** SOL per token */
  priceSol: number | null;
  virtualSolReserves: string | null;
  virtualTokenReserves: string | null;
  realSolReserves: string | null;
  realTokenReserves: string | null;
  /** cumulative SOL volume seen since the card exists (see volumeApprox) */
  volumeSol: number | null;
  /** trades counted since the card exists (see volumeApprox) */
  trades: number | null;
  /** true when volume/trades come from curve deltas polled every 2 s (several trades in a
   *  window count as one), false when they come from real PumpPortal trade events */
  volumeApprox: boolean;
  /** creator fees accumulated in SOL — only known with real trade events, else null */
  feesSol: number | null;
  /** dev initial buy in SOL at creation (from the create event) */
  devBuySol: number | null;
  /** dev's CURRENT holding as % of supply (null until read) */
  devPct: number | null;
  /** top 10 holders (bonding curve excluded) as % of supply, null unless computed */
  top10Pct: number | null;
  /** bundle % — not computable without first-slot analysis: always null for now */
  bundlePct: number | null;
  holders: number | null;
  lastTradeAt: number | null;
  updatedAt: number;
  column: FeedColumn;
};

export type FeedTrade = {
  mint: string;
  signature: string | null;
  trader: string | null;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number | null;
  marketCapSol: number | null;
  at: number;
  /** "pumpportal" = real trade event; "rpc" = aggregated curve delta observed over a 2 s poll */
  source: "pumpportal" | "rpc";
};

export type FeedStatus = {
  connected: boolean;
  since: number | null;
  lastMessageAt: number | null;
  /** mints currently polled on RPC */
  tracked: number;
  /** true when real trade events are subscribed (PumpPortal key set) */
  tradesLive: boolean;
  reconnects: number;
  error: string | null;
};

export type FeedSnapshot = {
  columns: { new: FeedCard[]; almost: FeedCard[]; migrated: FeedCard[] };
  solPrice: number | null;
  status: FeedStatus;
};

export type FeedMigrate = {
  mint: string;
  signature: string | null;
  pool: string | null;
  at: number;
  card: FeedCard | null;
};

/** SSE events on GET /api/feed/stream — `event: <type>` + `data: <json>` */
export type FeedEvent =
  | { type: "snapshot"; data: FeedSnapshot }
  | { type: "create"; data: FeedCard }
  | { type: "trade"; data: FeedTrade }
  | { type: "migrate"; data: FeedMigrate }
  | { type: "update"; data: FeedCard[] }
  | { type: "solPrice"; data: { usd: number; at: number } }
  | { type: "status"; data: FeedStatus };

/** GET /api/sol-price */
export type SolPriceResponse = { usd: number; at: number; source: "jupiter" | "coingecko" };

export type CurveState = {
  bondingCurve: string;
  virtualTokenReserves: string;
  virtualSolReserves: string;
  realTokenReserves: string;
  realSolReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
  creator: string;
  isCashbackCoin: boolean;
  /** 0..100 */
  progress: number;
  marketCapSol: number;
  marketCapUsd: number | null;
  priceSol: number;
};

/** GET /api/token/[mint] */
export type TokenInfo = {
  mint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  image: string | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  /** base58 of the token program that owns the mint */
  tokenProgram: string | null;
  creator: string | null;
  /** epoch ms if the server saw the create event, else null */
  createdAt: number | null;
  /** null when the bonding-curve account does not exist (not a pump.fun mint, or closed) */
  curve: CurveState | null;
  complete: boolean;
  solPrice: number | null;
  links: { pumpfun: string; solscan: string };
};

export type TokenTrade = {
  side: "buy" | "sell";
  wallet: string;
  /** SOL moved (decimal string) */
  solAmount: string;
  /** SOL per token (decimal string) */
  priceSol: string;
  /** seconds */
  blockTime: number;
  slot: number;
  signature: string;
};
/** GET /api/token/[mint]/trades?limit= */
export type TokenTradesResponse = { mint: string; trades: TokenTrade[]; supplyTokens: string };

export type TokenHolder = {
  /** token account */
  account: string;
  owner: string | null;
  /** raw units (6 decimals) as string */
  amount: string;
  /** % of total supply */
  pct: number;
  isCurve: boolean;
  isDev: boolean;
};
/** GET /api/token/[mint]/holders */
export type TokenHoldersResponse = {
  mint: string;
  totalSupply: string;
  holders: TokenHolder[];
  /** % held by the top 10 non-curve accounts */
  top10Pct: number | null;
  devPct: number | null;
};

export type CandleTf = "1s" | "15s" | "1m";
export type Candle = {
  /** bucket start, SECONDS (lightweight-charts) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** SOL traded in the bucket */
  volume: number;
};
/** GET /api/token/[mint]/candles?tf= */
export type TokenCandlesResponse = { mint: string; tf: CandleTf; candles: Candle[]; trades: number };

/* ------------------------------------------------------------------ trade */

export type TradeBuyRequest = {
  mint: string;
  wallets: string[];
  /** SOL per wallet */
  sol: string;
  slippageBps?: number;
  cuPrice?: number;
  /** > 0 sends through a Jito bundle with this tip (SOL) */
  tipSol?: string;
};
export type TradeSellRequest = {
  mint: string;
  wallets: string[];
  /** 1..100 */
  percent: number;
  slippageBps?: number;
  cuPrice?: number;
  tipSol?: string;
};

/* ----------------------------------------------------------------- launch */

export type LaunchMetadata = {
  name: string;
  symbol: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};
export type LaunchPrepareRequest = LaunchMetadata & {
  /** data:image/png;base64,… */
  imageDataUrl: string;
  /** optional vanity suffix for the mint (searched up to 200k keypairs) */
  vanity?: string;
};
export type LaunchPrepareResponse = { uri: string; mint: string; name: string; symbol: string };

export type AutoDumpConfig = {
  /** % of each wallet's balance to sell, 1..100 */
  percent: number;
  /** sell when market cap ≥ this USD value */
  mcUsd?: number;
  /** sell after this many seconds (counted from arming) — `delaySec` is an accepted alias */
  afterSec?: number;
  delaySec?: number;
  /** wallets to dump; omitted = every wallet that bought in this launch */
  wallets?: string[];
  bundle?: boolean;
};
export type VolumeConfig = {
  /** wallets, or a group id (`groupId` / `group`; the group takes precedence when both given) */
  wallets?: string[];
  groupId?: string;
  group?: string;
  minSol: string;
  maxSol: string;
  /** delay between trades — give either seconds or milliseconds */
  minDelaySec?: number;
  maxDelaySec?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** each round = one trade per wallet */
  rounds: number;
  /** default "both" */
  mode?: TradeMode;
  /** % of buys when mode = "both", default 50 */
  buyRatioPercent?: number;
  slippageBps?: number;
  cuPrice?: number;
};
/* Block X task model (observed in its bundle), reproduced 1:1.
 *   bundle  = wallets bought inside the Jito bundle with the create tx (max 4 wallets = 5 txs)
 *   sniper  = wallets that buy right after the create confirms (sendMany), autoRetryCount retries
 *   buy     = periodic buys from the wallets (pausable)
 *   volume  = periodic buys AND sells (tradeMode/buyRatioPercent, pausable)
 *   wash    = move every token of the listed wallets to FRESH wallets (SPL transfer)
 */
export type LaunchTaskType = "bundle" | "sniper" | "buy" | "volume" | "wash";
export type TradeMode = "buy" | "sell" | "both";

export type LaunchTaskBase = {
  /** client id, optional — the server assigns `t<n>` when missing */
  id?: string;
  type: LaunchTaskType;
  /** wallet addresses */
  walletIds: string[];
  /** group ids, expanded server-side (archived wallets skipped) */
  walletGroupIds?: string[];
  /** SOL per wallet, keyed by address (bundle/sniper); missing address → task default `buyAmount` */
  walletBuyAmounts?: Record<string, string>;
  buyAmount?: string;
};
export type BundleTask = LaunchTaskBase & {
  type: "bundle" | "sniper";
  /** default 30 */
  slippagePercent?: number;
  /** priority/Jito tip in SOL, decimal string. Block X ships "1"; TRENCH defaults to 0.001 SOL */
  tip?: string;
  /** ignored for now (0) */
  startBlock?: number;
  /** 0..5, default 0 */
  autoRetryCount?: number;
  autoStart?: boolean;
};
export type TradeTask = LaunchTaskBase & {
  type: "buy" | "volume";
  minIntervalSec?: number;
  maxIntervalSec?: number;
  minTradeAmount?: string;
  maxTradeAmount?: string;
  /** default 20 */
  slippagePercent?: number;
  tip?: string;
  tradeMode?: TradeMode;
  /** % of trades that are buys when tradeMode = "both", default 50 */
  buyRatioPercent?: number;
  /** total trades per wallet, max 10000; default = maxTradesPerWallet */
  maxTradesPerWallet?: number;
  /** stop after this many minutes, max 1440 */
  maxDurationMinutes?: number;
  autoStart?: boolean;
};
export type WashTask = LaunchTaskBase & { type: "wash"; autoStart?: boolean };
export type LaunchTask = BundleTask | TradeTask | WashTask;

export const TASK_DEFAULTS = {
  bundle: { slippagePercent: 30, tip: "0.001", startBlock: 0, autoRetryCount: 0, autoStart: true },
  sniper: { slippagePercent: 30, tip: "0.001", startBlock: 0, autoRetryCount: 0, autoStart: true },
  buy: {
    minIntervalSec: 0,
    maxIntervalSec: 1,
    minTradeAmount: "0.1",
    maxTradeAmount: "0.2",
    slippagePercent: 20,
    tip: "0.001",
    tradeMode: "buy" as TradeMode,
    buyRatioPercent: 50,
    autoStart: true,
  },
  volume: {
    minIntervalSec: 0,
    maxIntervalSec: 1,
    minTradeAmount: "0.1",
    maxTradeAmount: "0.2",
    slippagePercent: 20,
    tip: "0.001",
    tradeMode: "both" as TradeMode,
    buyRatioPercent: 50,
    autoStart: true,
  },
  wash: { autoStart: true },
} as const;

export const TASK_LIMITS = {
  maxWalletsPerTask: 50,
  /** Jito bundle = create tx + 4 buy txs = 5 txs max */
  maxWalletsPerBundleTask: 4,
  maxSlippagePercent: 100,
  maxIntervalSec: 86400,
  maxDurationMinutes: 1440,
  maxTradesPerWallet: 10000,
  maxAutoRetryCount: 5,
} as const;
export const PAUSABLE_TASKS: LaunchTaskType[] = ["buy", "volume"];

/** POST /api/launch/execute — Block X launch payload + the `mint` returned by /api/launch/prepare */
export type LaunchExecuteRequest = {
  mint: string;
  /** optional, informational: the server already knows the metadata from /prepare */
  metadata?: LaunchMetadata;
  launchpad: "pumpfun";
  devWallet: string;
  devBuySol: string;
  quote: "SOL";
  tasks: LaunchTask[];
  /** auto-dump every launch wallet (100 %) once EXTERNAL buy volume ≥ threshold SOL
   *  (external = curve volume minus the SOL this app's own wallets traded — an approximation) */
  sellOnExternalEnabled?: boolean;
  sellOnExternalThreshold?: string;
  /** BRIEF auto-dump: sell X % when MC ≥ Y USD or after N s */
  autoDump?: AutoDumpConfig;
  slippageBps?: number;
  cuPrice?: number;
  cashback?: boolean;
};
export type LaunchExecuteResponse = JobCreated & {
  /** launch id (= mint) for /api/launch/[id]/* */
  id: string;
  mint: string;
  mode: "bundle" | "plain";
  tasks: { id: string; type: LaunchTaskType }[];
};

export type TaskStatus = "pending" | "running" | "paused" | "done" | "stopped" | "error";
export type LaunchTaskState = {
  id: string;
  type: LaunchTaskType;
  status: TaskStatus;
  wallets: string[];
  /** trades/transfers done */
  done: number;
  /** planned total, null when unbounded */
  total: number | null;
  sent: number;
  failed: number;
  /** epoch ms of the next action while waiting, else 0 */
  nextAt: number;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** last 50 steps */
  steps: JobStep[];
  /** true when the task was restored after a server restart: status is "stopped" and POST …/resume restarts it */
  resumable?: boolean;
};
export type LaunchStep = {
  at: number;
  phase: "prepare" | "create" | "bundle" | "sniper" | "task" | "autodump" | "wash" | "info";
  ok: boolean;
  message: string;
  signature?: string | null;
  taskId?: string;
};
export type LaunchState = {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  dev: string;
  mode: "bundle" | "plain";
  status: "preparing" | "sending" | "live" | "failed" | "done";
  createSignature: string | null;
  createConfirmed: boolean | null;
  error: string | null;
  steps: LaunchStep[];
  tasks: LaunchTaskState[];
  startedAt: number;
  /** external volume watcher */
  sellOnExternal: { enabled: boolean; threshold: string; externalVolumeSol: number; fired: boolean } | null;
  autoDump: AutoDumpStatus | null;
  /** set when the launch was restored from disk after a server restart (its loops are "stopped", resumable) */
  restored?: { at: number; note: string };
};
/** SSE on GET /api/launch/[id]/stream: `state` (full snapshot first), then `step`, `task_status`,
 *  `done`, `error` */
export type LaunchStreamEvent =
  | { type: "state"; data: LaunchState }
  | { type: "step"; data: LaunchStep }
  | { type: "task_status"; data: LaunchTaskState }
  | { type: "done"; data: LaunchState }
  | { type: "error"; data: { error: string } };
/** POST /api/launch/[id]/tasks/[taskId]/pause | resume | stop */
export type TaskActionResponse = { ok: true; task: LaunchTaskState };

export type LaunchRecord = {
  mint: string;
  name: string;
  symbol: string;
  uri: string | null;
  image: string | null;
  dev: string;
  mode: "bundle" | "plain";
  at: number;
  createSignature: string | null;
  createConfirmed: boolean;
  createError: string | null;
  /** every wallet involved (dev, buyers, snipers) */
  wallets: string[];
  buysConfirmed: number;
  buysTotal: number;
  jobId: string;
};

/* --------------------------------------------------------------- dev room */

/** GET /api/dev/launches */
export type LaunchesResponse = { launches: LaunchRecord[] };

/** GET /api/dev/fees/[mint] — creator fees accrue per CREATOR vault, not per mint */
export type CreatorFeesResponse = {
  mint: string;
  /** the creator wallet (= `creator`) */
  wallet: string | null;
  creator: string | null;
  /** true when the creator is one of the vault wallets */
  isMine: boolean;
  vault: string | null;
  /** claimable + cashback, SOL decimal string (null when unreadable) */
  pendingSol: string | null;
  /** SOL claimed through this app for this creator (activity journal) */
  claimedSol: string;
  claimableSol: string | null;
  cashbackSol: string | null;
  ammPendingSol: string | null;
};
/** POST /api/dev/fees/claim → { jobId } (job.extra: totalSol, signatures) */
/** POST /api/dev/wash — SPL-transfer every token of `wallets` (default all vault wallets) to fresh vault wallets */
export type WashRequest = { mint: string; wallets?: string[]; cuPrice?: number };
export type FeesClaimRequest = { mint?: string; wallet?: string; wallets?: string[]; cuPrice?: number };
export type DumpRequest = {
  mint: string;
  /** omitted = every vault wallet */
  wallets?: string[];
  percent: number;
  bundle?: boolean;
  slippageBps?: number;
  cuPrice?: number;
  tipSol?: string;
};
export type VolumeStartRequest = VolumeConfig & { action: "start"; mint: string };
export type VolumeStopRequest = { action: "stop"; mint: string };
/** restart a volume bot restored after a server restart (status.resumable) with its saved config */
export type VolumeResumeRequest = { action: "resume"; mint: string };
export type VolumeStatus = {
  mint: string;
  running: boolean;
  /** true when the bot was restored after a restart and can be resumed with {action:"resume"} */
  resumable?: boolean;
  jobId: string | null;
  round: number;
  rounds: number;
  /** last confirmed signature */
  lastTx: string | null;
  /** last 50 trades of the bot */
  log: JobStep[];
  config: VolumeConfig | null;
};
export type AutoDumpArmRequest = AutoDumpConfig & { action: "arm"; mint: string };
export type AutoDumpDisarmRequest = { action: "disarm"; mint: string };
/** re-arm a watcher restored after a server restart (status.resumable) with its saved config */
export type AutoDumpResumeRequest = { action: "resume"; mint: string };
export type AutoDumpStatus = {
  mint: string;
  armed: boolean;
  /** true when the watcher was restored disarmed after a restart; its `config` is the saved one */
  resumable?: boolean;
  percent: number | null;
  mcUsd: number | null;
  delaySec: number | null;
  /** epoch ms when the delay trigger fires (null without a delay) */
  firesAt: number | null;
  config: AutoDumpConfig | null;
  armedAt: number | null;
  /** last market cap USD observed by the watcher */
  lastMcUsd: number | null;
  firedAt: number | null;
  jobId: string | null;
};

/* --------------------------------------------------------------- trending */

export type TrendingWindow = "1m" | "5m" | "1h" | "6h" | "24h";
export type TrendingEntry = {
  card: FeedCard;
  /** SOL volume observed inside the window */
  volumeSol: number;
  trades: number;
  /** market cap change over the window, % (null when no sample old enough) */
  mcChangePct: number | null;
  /** seconds of history actually available for this mint (≤ window) */
  coverageSec: number;
  score: number;
};
/** GET /api/trending?window= — ranked from the feed's own curve samples (only mints the feed
 *  has seen since this server started; nothing is fetched from a third party) */
export type TrendingResponse = { window: TrendingWindow; at: number; entries: TrendingEntry[] };

export type DashboardLaunch = LaunchRecord & {
  marketCapSol: number | null;
  marketCapUsd: number | null;
  progress: number | null;
  complete: boolean | null;
};
export type PnlWindow = {
  /** realised cash-flow from this app's journal: sells − buys (SOL, decimal string) */
  realisedSol: string;
  buysSol: string;
  sellsSol: string;
  trades: number;
};
/** GET /api/dashboard */
export type DashboardResponse = {
  recentLaunches: DashboardLaunch[];
  pnl: { "24h": PnlWindow; "7d": PnlWindow; "30d": PnlWindow; all: PnlWindow };
  /** running/paused tasks across live launches + standalone volume bots */
  activeTasks: { launchId: string; mint: string; symbol: string; task: LaunchTaskState }[];
  totalSol: string | null;
  solPrice: number | null;
};

/* -------------------------------------------------------------- positions */

/** one row per (wallet, mint) holding or with trade history */
export type PositionRow = {
  wallet: string;
  label: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  image: string | null;
  /** tokens (decimal string, 6 decimals applied) */
  amount: string;
  valueSol: string;
  costSol: string;
  realisedSol: string;
  pnlSol: string;
  supplyPct: number | null;
  isDev: boolean;
  onCurve: boolean;
  progress: number | null;
  marketCapSol: number | null;
};
/** GET /api/positions?wallets=a,b&mints=m1,m2 → PositionRow[] (defaults: every vault wallet × launched+tracked mints) */
export type PositionsResponse = PositionRow[];

/* --------------------------------------------------------------- activity */

export type ActivityItem = {
  id: string;
  at: number;
  kind: string;
  ok: boolean;
  message: string;
  mint?: string;
  wallets?: string[];
  signature?: string;
  jobId?: string;
  data?: Record<string, unknown>;
};
/** GET /api/activity?limit= */
export type ActivityResponse = { items: ActivityItem[] };

/* ---------------------------------------------------------------- presets */

export type LaunchPreset = {
  id: string;
  name: string;
  createdAt: number;
  /** form values to restore; free-form, UI-owned */
  data: Record<string, unknown>;
};
/** GET /api/presets */
export type PresetsResponse = { presets: LaunchPreset[] };
/** POST /api/presets — one of: upsert, remove, replace-all */
export type PresetsUpdateRequest =
  | { preset: Omit<LaunchPreset, "createdAt"> & { createdAt?: number } }
  | { remove: string }
  | { presets: LaunchPreset[] };

/** POST /api/dev/fees/claim → { jobId } */
export type FeesClaimResponse = JobCreated;

/** One wallet's slice of a position (UI aggregation of PositionRow by mint, see src/lib/positions.ts) */
export type PositionWallet = {
  address: string;
  label: string;
  amount: string;
  valueSol: string;
  costSol: string;
  realisedSol: string;
  pnlSol: string;
  supplyPct: number | null;
  isDev: boolean;
};
/** Per-mint view of PositionRow[] used by Holdings and the dev room */
export type Position = {
  mint: string;
  symbol: string | null;
  name: string | null;
  image: string | null;
  amount: string;
  valueSol: string;
  costSol: string;
  realisedSol: string;
  pnlSol: string;
  supplyPct: number | null;
  onCurve: boolean;
  progress: number | null;
  marketCapSol: number | null;
  wallets: PositionWallet[];
};
