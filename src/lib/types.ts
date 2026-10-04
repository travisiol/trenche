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
/** Block X "Create Wallets": `label` = label prefix ("Sniper" → Sniper 1, Sniper 2…), count 1..WALLET_LIMITS.maxCreate (400 above) */
export type WalletsGenerateRequest = { count: number; label?: string; group?: string };
export type WalletsGenerateResponse = WalletsResponse & { addresses: string[] };
/** one base58 secret (or JSON byte array) per line, optional "label, key"; `prefix` labels the imported wallets
 *  ("Imported 1", "Imported 2"…); more than WALLET_LIMITS.maxImport keys → 400 */
export type WalletsImportRequest = { lines: string[]; prefix?: string };
export const WALLET_LIMITS = { maxCreate: 50, maxImport: 50 } as const;
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
/** POST /api/jobs/[id]/stop → JobView: sets the cooperative stop flag (a waiting disperse/deposit job ends at its
 *  next check; a trade in flight is never cancelled). 409 when the job already ended. */
export type JobStopResponse = JobView;

/* ------------------------------------------------------------------ funds */

export type FundWithdrawRequest = { from: string; to: string; sol: string; viaRelay?: boolean };
/** viaRelay: source → fresh in-memory relay wallet → destination (two signatures per transfer; the relay key is
 *  never stored; on a hop-2 failure the relay sweeps back to the source). The job shows both hops.
 *  Block X drag-and-drop shape: `{ sources, targets, sol? }` — pairs sources[i] → targets[i % targets.length];
 *  without `sol` each source sends its whole balance minus fees. */
export type FundTransferRequest =
  | { from: string; to: string; sol: string; viaRelay?: boolean }
  | { sources: string[]; targets: string[]; sol?: string; viaRelay?: boolean; delayMinutes?: number };
/** Legacy shape (min/max per wallet, delays in ms) — still accepted. */
export type FundDisperseLegacyRequest = {
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
/** Block X Disperse drawer. Either `from` (an existing vault wallet) or `createDeposit: true` (a fresh vault wallet
 *  "Deposit N" is generated, returned in the response for the QR, and the job WAITS until it holds the planned
 *  total + fees — up to `waitMinutes`, default 120 — before sending; POST /api/jobs/[id]/stop cancels the wait).
 *  Amounts: `totalSol` split across `to` ("Split equal"), or `amounts` per wallet (rows the user edited), or
 *  `amountSol` per wallet. `variationPct` 0..100 randomises each row around the equal share while the sum still
 *  matches the total (0 = equal). `delayMinutes` between wallets (0 = ASAP). */
export type FundDisperseRequest = {
  from?: string;
  createDeposit?: boolean;
  to: string[];
  totalSol?: string;
  amountSol?: string;
  amounts?: Record<string, string>;
  variationPct?: number;
  delayMinutes?: number;
  waitMinutes?: number;
  viaRelay?: boolean;
  /** optional saved-preset name for the activity journal */
  presetName?: string;
};
export type FundDisperseResponse = JobCreated & {
  /** the funding wallet (the fresh deposit wallet when createDeposit) */
  from: { address: string; label: string; isDeposit: boolean };
  plan: { address: string; label: string; sol: string }[];
  /** SOL the source must hold before anything is sent (sum + fees) */
  needSol: string;
  totalSol: string;
};
/** POST /api/fund/distribute — Block X "Distribute" drop zone: ONE source → many targets, equal split of
 *  `totalSol` (default: the source's whole balance minus fees), same variation/delay options as Disperse. */
export type FundDistributeRequest = { sources: string[]; targets: string[]; totalSol?: string; variationPct?: number; delayMinutes?: number; viaRelay?: boolean };
/** Reverse Disperse / Consolidate: every source sweeps its whole balance to `to` (any address, e.g. the deposit
 *  wallet). Block X shapes also accepted: `{ sources, targets: [to] }` and `{ groupId, to }`. `delayMinutes`
 *  between wallets (0 = ASAP). */
export type FundConsolidateRequest = {
  from?: string[];
  sources?: string[];
  groupId?: string;
  to?: string;
  targets?: string[];
  /** each source empties itself through its own fresh relay wallet (2 signatures per source) */
  viaRelay?: boolean;
  delayMinutes?: number;
  /** "reverse" labels the job "Reverse Disperse" in Activity (same sweep) */
  kind?: "consolidate" | "reverse";
};
/** Saved Disperse presets (Preset select / Save as / Update / Delete in the drawer): GET/POST /api/fund/disperse/presets */
export type DispersePreset = { id: string; name: string; totalSol: string; variationPct: number; delayMinutes: number; viaRelay: boolean; createdAt: number };
export type DispersePresetsResponse = { presets: DispersePreset[] };
export type DispersePresetsUpdateRequest = { preset: Omit<DispersePreset, "createdAt" | "id"> & { id?: string } } | { remove: string };
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
/* --------------------------------------------------------------- settings */

export type Cluster = "mainnet" | "devnet";

/** Block X "Trading Presets" dialog (Buy Settings / Sell Settings / slippage + tip per preset / Multi wallet trading) */
export type TradingPreset = {
  /** Buy Settings → Native amounts (SOL, decimal strings), the 4 round buttons of Instant Trade / order rail */
  buyAmounts: [string, string, string, string];
  /** Buy Settings → Percent of native balance (0..100) */
  buyPercents: [number, number, number, number];
  /** Sell Settings → percent of the token balance (0..100) */
  sellPercents: [number, number, number, number];
  /** 0..100 */
  slippagePercent: number;
  /** Jito/priority tip in SOL (decimal string) */
  tipSol: string;
  /** Multi wallet trading → "Buys value spread" 0..100: each wallet buy is randomised around the average,
   *  the total still matches the input amount × wallets */
  buysValueSpreadPct: number;
  /** Multi wallet trading → "Buys delay" 0..1 s between wallet buys */
  buysDelaySec: number;
};
export type TradingPresets = [TradingPreset, TradingPreset, TradingPreset];
/** Block X defaults, observed 2026-10-04 */
export const TRADING_PRESET_DEFAULTS: TradingPresets = [
  { buyAmounts: ["0.1", "0.15", "0.22", "0.5"], buyPercents: [10, 25, 50, 100], sellPercents: [5, 10, 20, 50], slippagePercent: 30, tipSol: "0.0002", buysValueSpreadPct: 0, buysDelaySec: 0 },
  { buyAmounts: ["0.2", "0.35", "0.5", "1"], buyPercents: [15, 30, 50, 75], sellPercents: [10, 25, 50, 75], slippagePercent: 30, tipSol: "0.0002", buysValueSpreadPct: 0, buysDelaySec: 0 },
  { buyAmounts: ["0.5", "1", "2", "5"], buyPercents: [25, 50, 75, 100], sellPercents: [25, 50, 75, 100], slippagePercent: 30, tipSol: "0.0002", buysValueSpreadPct: 0, buysDelaySec: 0 },
];
export const TRADING_PRESET_LIMITS = { maxSpreadPct: 100, maxDelaySec: 1, maxSlippagePercent: 100 } as const;
/** Settings → default tip everywhere (tasks, trades, presets) — Block X ships 0.0002 SOL */
export const DEFAULT_TIP_SOL = "0.0002";
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
  /** default of the Launch Token modal "Auto-claim rewards → dev wallet" switch (true): every launch arms an
   *  auto-claim watcher that sends the pump.fun creator fees to the dev wallet (see AutoClaimStatus) */
  autoClaimRewards: boolean;
  slippageBps: number;
  /** priority fee, micro-lamports per CU */
  cuPrice: number;
  /** default Jito tip in SOL (decimal string) — DEFAULT_TIP_SOL (0.0002) */
  tipSol: string;
  /** legacy quick-buy amounts P1..P3 in SOL (decimal strings) = tradingPresets[n].buyAmounts[0]; kept for the old UI */
  presets: [string, string, string];
  /** Block X Trading Presets P1..P3 (see TradingPreset) */
  tradingPresets: TradingPresets;
  keybinds: { quickBuy: [string, string, string]; close: string };
  theme: "dark";
  /** pump.fun constants in use for this cluster (null until the first trade/launch read them on devnet) */
  pump: { cluster: Cluster; feeRecipients: string[]; secondRecipients: string[]; initialVirtualSol: string; initialVirtualTokens: string; initialRealTokens: string; at: number } | null;
};
/** POST /api/settings — partial; `pumpportalKey: ""` clears the key, omit to keep.
 *  `tradingPresets`: 3 entries, each a PARTIAL TradingPreset merged over the saved one (omit a field to keep it). */
export type SettingsUpdateRequest = Partial<
  Omit<Settings, "hasPumpportalKey" | "hasHeliusKey" | "theme" | "explorerSuffix" | "effectiveRpcUrl" | "effectiveSendRpcUrl" | "pump" | "tradingPresets">
> & {
  pumpportalKey?: string;
  /** "" clears, omit keeps */
  heliusKey?: string;
  tradingPresets?: [Partial<TradingPreset>, Partial<TradingPreset>, Partial<TradingPreset>];
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
  /** where the row came from: pump.fun's API, the RPC curve read, both, or nothing answered */
  source: "pump" | "rpc" | "pump+rpc" | "none";
  /** all-time-high market cap in SOL (pump.fun), null when unknown */
  athMarketCapSol: number | null;
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
export type TokenTradesResponse = { mint: string; trades: TokenTrade[]; supplyTokens: string; source: "pump" | "rpc" };

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

/** Block X chart timeframes; every bucket is built from the same last-600-trades curve history */
export type CandleTf = "1s" | "5s" | "15s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
export const CANDLE_TFS: CandleTf[] = ["1s", "5s", "15s", "1m", "5m", "15m", "1h", "4h", "1D"];
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
export type TokenCandlesResponse = { mint: string; tf: CandleTf; candles: Candle[]; trades: number; source: "pump" | "trades" | "rpc" };

/** Block X trading page "window stats" (5m +25.9% · Vol · Buys · Sells · Net Vol.) */
export type StatsWindow = "5m" | "1h" | "6h" | "24h";
export type WindowStats = {
  /** SOL traded inside the window (buys + sells) */
  volumeSol: number;
  buysSol: number;
  sellsSol: number;
  /** buys − sells */
  netSol: number;
  buys: number;
  sells: number;
  /** price change over the window in %, null when no trade old enough */
  priceChangePct: number | null;
  /** seconds of trade history actually covered (≤ window; shorter when the history was truncated) */
  coverageSec: number;
  /** true when the window reaches past the oldest trade the server could read (numbers are a lower bound) */
  partial: boolean;
};
/** GET /api/token/[mint]/stats — computed from curveTradeHistory (last 600 curve trades; nothing from third parties) */
export type TokenStatsResponse = {
  mint: string;
  at: number;
  /** last trade price, SOL per token (null without trades) */
  lastPriceSol: number | null;
  tradesRead: number;
  windows: Record<StatsWindow, WindowStats>;
  source: "pump" | "rpc";
};

/* ------------------------------------------------------------ rpc health */

/** GET /api/rpc/health — the bottom-bar status pill */
export type RpcHealthResponse = {
  provider: "public" | "private";
  /** read RPC URL with any api-key masked */
  url: string;
  /** median round-trip of the last 20 upstream calls (ms), null before the first call */
  latencyMs: number | null;
  /** 429 / rate-limit answers in the last 60 s */
  rateLimited: number;
  requestsLastMinute: number;
  cacheHitsLastMinute: number;
  inflight: number;
  queued: number;
  lastError: string | null;
  lastErrorAt: number | null;
  at: number;
  /** pump.fun data API (coin / trades / candles) */
  pump: { ok: boolean; blockedUntil: number | null; lastError: string | null; lastErrorAt: number | null; lastOkAt: number | null; callsLastMinute: number };
};

/** Holdings strip "Recently viewed": server-side list, newest first, 20 max */
export type RecentToken = { mint: string; symbol: string | null; name: string | null; image: string | null; at: number };
/** GET /api/recent · POST /api/recent {mint} (upserts to the front, resolves metadata) · DELETE /api/recent (clear) */
export type RecentResponse = { recent: RecentToken[] };
export type RecentAddRequest = { mint: string };
export const RECENT_MAX = 20;

/* ------------------------------------------------------------------ trade */

/** Market buy from the order rail / Instant Trade / Trenches "Buy" chip.
 *  Amount: `sol` (explicit SOL per wallet) · or `preset` + `amountIndex` (tradingPresets[preset-1].buyAmounts[i]) ·
 *  or `preset` + `percentIndex` (buyPercents[i] % of each wallet's SOL balance) · or `percentOfBalance`.
 *  With `preset`, slippage/tip/spread/delay default to that preset's values (explicit fields win).
 *  spreadPct > 0 randomises each wallet's amount around the average (total unchanged); delaySec > 0 sends the
 *  wallets one after the other with that pause (0 = all at once). */
export type TradeBuyRequest = {
  mint: string;
  wallets: string[];
  /** SOL per wallet */
  sol?: string;
  preset?: 1 | 2 | 3;
  amountIndex?: 0 | 1 | 2 | 3;
  percentIndex?: 0 | 1 | 2 | 3;
  /** 1..100 % of each wallet's SOL balance (fees kept aside) */
  percentOfBalance?: number;
  slippageBps?: number;
  cuPrice?: number;
  /** tip in SOL (default: the preset's, else Settings.tipSol); added as a Jito tip transfer to every trade tx */
  tipSol?: string;
  /** send through Jito bundles of 5 txs (default Settings.jitoEnabled; needs a tip > 0) */
  bundle?: boolean;
  spreadPct?: number;
  delaySec?: number;
};
/** `percent` explicit, or `preset` + `percentIndex` (tradingPresets[preset-1].sellPercents[i]) */
export type TradeSellRequest = {
  mint: string;
  wallets: string[];
  /** 1..100 */
  percent?: number;
  preset?: 1 | 2 | 3;
  percentIndex?: 0 | 1 | 2 | 3;
  slippageBps?: number;
  cuPrice?: number;
  tipSol?: string;
  bundle?: boolean;
};
/** POST /api/trade/buy|sell → the job plus the resolved per-wallet plan (what the job will send) */
export type TradeCreated = JobCreated & { plan: { address: string; sol?: string; percent?: number }[]; slippageBps: number; tipSol: string; spreadPct: number; delaySec: number };

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
  /** legacy alias of vanitySuffix */
  vanity?: string;
  /** mint address must end with this (case-insensitive), e.g. "pump". Ground in worker processes (≤ 90 s); when
   *  `mint`/`mintSecret` are given it only VALIDATES them (400 when the address does not end with it). */
  vanitySuffix?: string;
  /** "Fetch mint address": use a mint reserved earlier by POST /api/launch/mint (its address) */
  mint?: string;
  /** "Import your own mint keypair": base58 secret key or JSON byte array; stored server-side (runtime.json)
   *  and signs the create tx. 400 when it is not a valid keypair / does not end with vanitySuffix. */
  mintSecret?: string;
  /** only "SOL" is supported here — anything else → 400 (Block X offers USDC/xStocks, DONCHAIN does not) */
  quote?: string;
  launchpad?: string;
};
export type LaunchPrepareResponse = { uri: string; mint: string; name: string; symbol: string; /** "generated" | "vanity" | "reserved" | "imported" */ mintSource: "generated" | "vanity" | "reserved" | "imported" };

/** POST /api/launch/mint — Block X "Fetch mint address": grinds a keypair whose address ends with `suffix`
 *  (default "pump") in worker processes and reserves it server-side (runtime.json). Returns a job; when the job is
 *  done `job.extra.mint` is the address, to pass as LaunchPrepareRequest.mint. */
export type MintReserveRequest = { suffix?: string; caseSensitive?: boolean; /** default 90 000 */ timeoutMs?: number };
export type ReservedMint = { mint: string; suffix: string; at: number; /** set once used by /api/launch/prepare */ usedAt: number | null };
/** GET /api/launch/mint */
export type ReservedMintsResponse = { mints: ReservedMint[]; /** grind jobs still running */ grinding: { jobId: string; suffix: string; startedAt: number }[] };
/** POST /api/launch/mint/[address]/release → { ok: true } (drops an unused reserved mint) */

/** GET /api/launch/calc?devBuySol=1&buys=0.5,0.5,0.25 — Block X "Bundle calculator — Pump.fun curve".
 *  Rows land in this order on a FRESH curve of the active cluster (engine planBuys / FRESH_CURVE): the dev buy
 *  first, then each bundle buy. supplyPct = tokens / total supply (1 B). */
export type LaunchCalcRow = {
  index: number;
  /** "Dev buy" or "Buy n" */
  label: string;
  solIn: string;
  /** tokens received (decimal string, 6 decimals applied) */
  tokens: string;
  supplyPct: number;
  cumulativeSupplyPct: number;
  cumulativeSol: string;
  /** SOL actually paid into the curve after the 1.25 % pump.fun fee */
  solToCurve: string;
};
export type LaunchCalcResponse = {
  cluster: Cluster;
  rows: LaunchCalcRow[];
  total: { solIn: string; tokens: string; supplyPct: number };
  /** market cap after all buys, SOL and USD (null without a SOL price) */
  marketCapSol: number;
  marketCapUsd: number | null;
  curve: { virtualSol: string; virtualTokens: string; realTokens: string; totalSupply: string; feeBps: number };
};

/** Launch drafts (Block X sidebar "Draft" tab): server-side JSON, autosaved by the modal on every close.
 *  `form` is UI-owned (same shape the launch modal keeps in memory); the server only indexes name/symbol/image. */
export type LaunchDraft = {
  id: string;
  /** indexed from form.name / form.symbol / form.imageDataUrl for the sidebar row (null when empty) */
  name: string | null;
  symbol: string | null;
  image: string | null;
  form: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** set when the draft was launched: the mint (the row moves to the Launched tab) */
  launchedMint: string | null;
};
/** GET /api/launch/drafts */
export type LaunchDraftsResponse = { drafts: LaunchDraft[] };
/** POST /api/launch/drafts {id?, form} → { draft } (upsert; a missing id creates "d_…"); DELETE /api/launch/drafts/[id] → { ok: true } */
export type LaunchDraftSaveRequest = { id?: string; form: Record<string, unknown> };
export type LaunchDraftResponse = { draft: LaunchDraft };
export const DRAFT_LIMITS = { max: 200, maxFormBytes: 6_000_000 } as const;

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
/* Block X task model (BEHAVIOUR.md §4.4 task setup dialogs), reproduced 1:1.
 *   bundle  = ≤ 4 wallets buying inside the Jito bundle with the create tx (one tx each → distinct buyers);
 *             runs with the create, no start/pause/stop; "Sell all on external" = sell 100 % of the bundle wallets
 *             when net external SOL reaches the threshold
 *   sniper  = wallets that buy right after the create confirms, min/max delay between wallet buys, retry on/off +
 *             max retries, "Stop on activity" = cancel the task once net external volume hits the threshold
 *   buy     = periodic buys from the wallets (pausable), interval/amount ranges, duration limit, max trades per
 *             wallet, auto-start, "Stop on activity"
 *   volume  = same + mode Buy only / Sell only / Buy + Sell, buy ratio
 *   wash    = source → wash-wallet PAIRING: each source's tokens move to its 1–3 wash wallets by SPL transfer in
 *             random slices, random delay between pairs; wash wallets auto-paired from a group, any vault wallet
 *             or fresh generated wallets
 * "external volume" = curve volume minus the SOL this app's own wallets traded (an approximation, see autodump.ts).
 */
export type LaunchTaskType = "bundle" | "sniper" | "buy" | "volume" | "wash";
export type TradeMode = "buy" | "sell" | "both";

export type LaunchTaskBase = {
  /** client id, optional — the server assigns `t<n>` when missing */
  id?: string;
  type: LaunchTaskType;
  /** wallet addresses (wash: the SOURCE wallets) */
  walletIds: string[];
  /** group ids, expanded server-side (archived wallets skipped) */
  walletGroupIds?: string[];
  /** SOL per wallet, keyed by address (bundle/sniper); missing address → task default `buyAmount` */
  walletBuyAmounts?: Record<string, string>;
  buyAmount?: string;
};
export type BundleTask = LaunchTaskBase & {
  type: "bundle";
  /** default 30 */
  slippagePercent?: number;
  /** Jito tip in SOL, decimal string; default DEFAULT_TIP_SOL (0.0002) */
  tip?: string;
  /** "Sell all on external": sell 100 % of THESE wallets when net external SOL ≥ threshold */
  sellOnExternalEnabled?: boolean;
  sellOnExternalThreshold?: string;
  /** bundle resend attempts when it does not land, 0..5 (default 0) */
  autoRetryCount?: number;
  autoStart?: boolean;
};
export type SniperTask = LaunchTaskBase & {
  type: "sniper";
  /** "Delay between wallet buys · 0 = all instant", seconds 0..1 (TASK_LIMITS.maxSniperDelaySec) */
  minDelaySec?: number;
  maxDelaySec?: number;
  /** default 30 */
  slippagePercent?: number;
  tip?: string;
  /** Retry On/Off (default on) + Max retries (default 1, ≤ TASK_LIMITS.maxAutoRetryCount) */
  retry?: boolean;
  maxRetries?: number;
  /** legacy alias of maxRetries (retry is implied when > 0) */
  autoRetryCount?: number;
  /** "Stop on activity": cancel the task once net external volume ≥ threshold SOL */
  stopOnActivityEnabled?: boolean;
  stopOnActivityThreshold?: string;
  autoStart?: boolean;
};
export type TradeTask = LaunchTaskBase & {
  type: "buy" | "volume";
  /** Min (s) / Max (s) between trades */
  minIntervalSec?: number;
  maxIntervalSec?: number;
  /** Min (SOL) / Max (SOL) per trade */
  minTradeAmount?: string;
  maxTradeAmount?: string;
  /** default 20 */
  slippagePercent?: number;
  tip?: string;
  /** volume only: Buy only / Sell only / Buy + Sell (buy tasks are always "buy") */
  tradeMode?: TradeMode;
  /** % of trades that are buys when tradeMode = "both", default 50 */
  buyRatioPercent?: number;
  /** "Max Trades per Wallet", 1..10000; empty = unbounded until duration/stop */
  maxTradesPerWallet?: number;
  /** "Duration Limit (min)", 1..1440; empty = no limit */
  maxDurationMinutes?: number;
  /** "Auto-Start": fire as soon as the mint is known (default true) */
  autoStart?: boolean;
  /** "Stop on activity" + SOL threshold */
  stopOnActivityEnabled?: boolean;
  stopOnActivityThreshold?: string;
};
/** one source wallet → its wash wallets */
export type WashPair = { source: string; wash: string[] };
export type WashTask = LaunchTaskBase & {
  type: "wash";
  /** explicit pairs (the dialog's "Mark source wallets above to pair them"); when omitted the server auto-pairs
   *  every source in walletIds/walletGroupIds with `perSource` wallets from `autoPairFrom` */
  pairs?: WashPair[];
  /** wash wallets per source, 1..3 (default 1) */
  perSource?: 1 | 2 | 3;
  /** "Auto-pair from": "any" = any vault wallet not already used by this launch, "fresh" = generate new vault
   *  wallets (label wash-n, group "wash"), or a group id */
  autoPairFrom?: "any" | "fresh" | string;
  /** "Delay between pairs — random, in seconds. 0 = no delay." */
  minDelaySec?: number;
  maxDelaySec?: number;
  autoStart?: boolean;
};
export type LaunchTask = BundleTask | SniperTask | TradeTask | WashTask;

export const TASK_DEFAULTS = {
  bundle: { slippagePercent: 30, tip: DEFAULT_TIP_SOL, autoRetryCount: 0, autoStart: true, sellOnExternalEnabled: false, sellOnExternalThreshold: "0" },
  sniper: { slippagePercent: 30, tip: DEFAULT_TIP_SOL, minDelaySec: 0, maxDelaySec: 1, retry: true, maxRetries: 1, autoRetryCount: 1, autoStart: true, stopOnActivityEnabled: false, stopOnActivityThreshold: "0" },
  buy: {
    minIntervalSec: 0,
    maxIntervalSec: 1,
    minTradeAmount: "0.1",
    maxTradeAmount: "0.2",
    slippagePercent: 20,
    tip: DEFAULT_TIP_SOL,
    tradeMode: "buy" as TradeMode,
    buyRatioPercent: 50,
    autoStart: true,
    stopOnActivityEnabled: false,
    stopOnActivityThreshold: "0",
  },
  volume: {
    minIntervalSec: 0,
    maxIntervalSec: 1,
    minTradeAmount: "0.1",
    maxTradeAmount: "0.2",
    slippagePercent: 20,
    tip: DEFAULT_TIP_SOL,
    tradeMode: "both" as TradeMode,
    buyRatioPercent: 50,
    autoStart: true,
    stopOnActivityEnabled: false,
    stopOnActivityThreshold: "0",
  },
  wash: { perSource: 1 as 1 | 2 | 3, autoPairFrom: "any" as "any" | "fresh" | string, minDelaySec: 0, maxDelaySec: 0, autoStart: true },
} as const;

export const TASK_LIMITS = {
  maxWalletsPerTask: 50,
  /** Jito bundle = create tx + 4 buy txs = 5 txs max */
  maxWalletsPerBundleTask: 4,
  maxSlippagePercent: 100,
  maxIntervalSec: 86400,
  /** sniper "Delay between wallet buys" input: 0..1 s */
  maxSniperDelaySec: 1,
  maxDurationMinutes: 1440,
  maxTradesPerWallet: 10000,
  maxAutoRetryCount: 5,
  /** wash wallets per source */
  maxWashPerSource: 3,
  maxWashDelaySec: 3600,
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
  /** Launch Token modal "Auto Dump": dump ALL launch wallets (100 %) once net EXTERNAL volume ≥ threshold SOL
   *  (external = curve volume minus the SOL this app's own wallets traded — an approximation) */
  sellOnExternalEnabled?: boolean;
  sellOnExternalThreshold?: string;
  /** Launch Token modal "Auto Dev Sell": sell 100 % of the DEV wallet this many milliseconds after the token goes
   *  live (`mode: "ms"`) or once market cap ≥ `value` USD (`mode: "mc"`). Independent of autoDump. */
  autoDevSell?: { mode: "ms" | "mc"; value: number };
  /** BRIEF auto-dump: sell X % when MC ≥ Y USD or after N s (merged with sellOnExternal into one watcher) */
  autoDump?: AutoDumpConfig;
  /** Launch Token modal "Auto-claim rewards → dev wallet": once the create confirms, a watcher reads the creator
   *  vault every `intervalSec` (default 300) and claims to the dev wallet when pending ≥ `minSol` (default 0.01).
   *  Omitted = `enabled: Settings.autoClaimRewards` (true by default). */
  autoClaim?: AutoClaimRequestConfig;
  slippageBps?: number;
  cuPrice?: number;
  cashback?: boolean;
  /** the draft this launch came from: marked launched (row moves to the Launched tab) once the create confirms */
  draftId?: string;
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
  /** wash: the resolved source → wash-wallet pairs */
  pairs?: WashPair[];
  /** sniper/buy/volume "Stop on activity" and bundle "Sell all on external": the watcher's view */
  activity?: { thresholdSol: string; externalVolumeSol: number; fired: boolean };
};
export type LaunchStep = {
  at: number;
  phase: "prepare" | "create" | "bundle" | "sniper" | "task" | "autodump" | "autoclaim" | "wash" | "info";
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
  /** "Auto Dev Sell" watcher (dev wallet only), null when not requested */
  autoDevSell: AutoDumpStatus | null;
  /** "Auto-claim rewards → dev wallet" watcher, null when never armed on this mint */
  autoClaim: AutoClaimStatus | null;
  /** set when the launch was restored from disk after a server restart (its loops are "stopped", resumable) */
  restored?: { at: number; note: string };
  draftId?: string | null;
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
  /** GET /api/dev/launches only (not stored): the auto-claim watcher of this mint, null when none */
  autoClaim?: AutoClaimStatus | null;
};

/* --------------------------------------------------------------- dev room */

/** GET /api/dev/launches */
/** launched = create confirmed on chain · failed = definitive error (reverted / refused) · pending = signature sent,
 *  chain not yet readable (an expired blockhash on a rate-limited RPC is never "failed": reconcile.ts re-checks) */
export type LaunchRecordStatus = "launched" | "failed" | "pending";
export type LaunchesResponse = { launches: (LaunchRecord & { status: LaunchRecordStatus })[] };

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
/** POST /api/dev/wash — Block X wash outside a launch (CTO / any mint): explicit `pairs`, or `wallets` (sources,
 *  default: every vault wallet holding the token) auto-paired `perSource` × from `autoPairFrom` ("any" | "fresh" |
 *  group id; default "fresh"); random delay between pairs in seconds. Each source's tokens go to its wash wallets
 *  in random slices (one tx each). */
export type WashRequest = {
  mint: string;
  wallets?: string[];
  pairs?: WashPair[];
  perSource?: 1 | 2 | 3;
  autoPairFrom?: "any" | "fresh" | string;
  minDelaySec?: number;
  maxDelaySec?: number;
  cuPrice?: number;
};
/** POST /api/dev/wash → the job plus the resolved pairs */
export type WashResponse = JobCreated & { pairs: WashPair[] };
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
  /** the dump job once fired (null for a "notify" watch: Stop on activity cancels a task, sells nothing) */
  jobId: string | null;
  /** net external volume seen so far (SOL) when the watch has an external-volume trigger */
  externalVolumeSol: number | null;
};

/* ------------------------------------------------------------- auto-claim */

/** LaunchExecuteRequest.autoClaim */
export type AutoClaimRequestConfig = {
  enabled: boolean;
  /** claim once the creator vault holds at least this much (claimable + cashback), SOL decimal string; default "0.01" */
  minSol?: string;
  /** vault read period in seconds, 300..86400; default 300 */
  intervalSec?: number;
};
export const AUTO_CLAIM_DEFAULTS = { minSol: "0.01", intervalSec: 300, minIntervalSec: 300, maxIntervalSec: 86_400 } as const;
/** GET/POST /api/dev/autoclaim?mint= — the per-mint auto-claim watcher (runtime.json, resumable after a restart).
 *  pump.fun's collect_creator_fee moves the vault's lamports to the CREATOR account itself (the dev wallet that
 *  launched the token): the payer only signs the transaction, the SOL always lands on the creator. */
export type AutoClaimStatus = {
  mint: string;
  /** the creator wallet (bonding curve `creator`, else the launch's dev); null until the first read */
  creator: string | null;
  /** true when the creator is one of the vault wallets — the watcher never claims otherwise */
  creatorIsMine: boolean | null;
  /** armed: the watcher ticks */
  enabled: boolean;
  /** true when the watcher was restored disarmed after a restart; POST {action:"resume"} re-arms it */
  resumable?: boolean;
  minSol: string;
  intervalSec: number;
  armedAt: number | null;
  lastCheckAt: number | null;
  lastClaimAt: number | null;
  /** SOL claimed by this watcher (confirmed claims), decimal string */
  claimedSol: string;
  /** confirmed claims */
  claims: number;
  /** claimable + cashback at the last read, decimal string (null when unreadable) */
  pendingSol: string | null;
  /** last error (RPC, locked vault, creator not in vault, claim not confirmed); null when the last tick was clean */
  error: string | null;
  /** the running or last claim job */
  jobId: string | null;
  /** true while a claim transaction is in flight */
  claiming: boolean;
};
/** POST /api/dev/autoclaim?mint=  (mint may also be in the body). `arm` re-arms with the new values. */
export type AutoClaimActionRequest = { action: "arm" | "disarm" | "resume" | "tick"; mint?: string; minSol?: string; intervalSec?: number };

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

/* -------------------------------------------------------------- share PnL */

export type PnlSharePeriod = "1d" | "7d" | "30d" | "all";
/** GET /api/pnl/share?period=1d|7d|30d|all — the figures of the "Share PnL" card (PNG / WebM drawn in the browser).
 *  Every number comes from this app's activity journal (buy/sell entries: `data.side`, `data.solTotal`, and
 *  `data.solUsd` = SOL price at trade time, journaled since this endpoint exists) + the current positions. */
export type PnlShareResponse = {
  period: PnlSharePeriod;
  /** epoch ms of the window (`from` = the first journaled trade for "all", or `to` when the journal is empty) */
  from: number;
  to: number;
  /** sells − buys over the window (SOL, decimal string) */
  realisedSol: string;
  /** Σ sell SOL × price − Σ buy SOL × price, price at trade time when the entry has it, else the current SOL price;
   *  null when no price is known at all */
  realisedUsd: string | null;
  /** true when at least one trade in the window was valued at the CURRENT SOL price (its entry carries no price) */
  usdAtCurrentPrice: boolean;
  /** open positions' PnL (value − cost + realised) of every vault wallet on launched + tracked mints;
   *  null when the positions could not be read (locked vault, RPC) */
  unrealisedSol: string | null;
  unrealisedUsd: string | null;
  /** journaled buy/sell entries in the window (a multi-wallet buy is ONE entry) */
  trades: number;
  /** mints whose realised SOL over the window is > 0 / < 0 */
  wins: number;
  losses: number;
  /** best per-mint realised SOL over the window, null without any trade */
  bestTradeSol: string | null;
  bestTradeMint: string | null;
  bestTradeSymbol: string | null;
  /** buys + sells (SOL) */
  volumeSol: string;
  buysSol: string;
  sellsSol: string;
  /** confirmed launches in the window */
  launches: number;
  /** active (non-archived) vault wallets */
  wallets: number;
  /** current SOL/USD, null when unknown */
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

/** PATCH /api/groups/[id] {name} → WalletsResponse & { group } ; POST /api/wallets/move {addresses, group|null} → WalletsResponse */
export type GroupRenameRequest = { name: string };
export type WalletsMoveRequest = { addresses: string[]; group: string | null };

/* -------------------------------------------------------------------- CTO */

/** Block X "New CTO": run tasks on a token someone else deploys. Nothing is deployed. The address can be a token
 *  mint (known now) or a DEV wallet (the token is not created yet): the record is WATCHED for 1 hour; when the
 *  feed sees a create by that dev the mint is filled in and the tasks with autoStart fire. Kept in runtime.json. */
export type CtoStatus = "watching" | "ready" | "running" | "expired" | "stopped";
export type CtoCreateRequest = {
  /** mint or dev wallet, optional ("add it later" with PATCH) */
  address?: string;
  addressIs?: "token" | "dev";
  /** ≤ 64 chars, replaced by the token's name once known */
  name?: string;
  /** Global Task Preset id (presets.json) whose tasks are copied */
  presetId?: string;
  /** tasks to run on the token (sniper → immediate buys, buy/volume → loops, wash → pairing) */
  tasks?: LaunchTask[];
};
export type CtoRecord = {
  id: string;
  name: string;
  mint: string | null;
  devWallet: string | null;
  status: CtoStatus;
  createdAt: number;
  /** createdAt + 1 h while watching for a dev's token; null once the mint is known */
  expiresAt: number | null;
  /** when the mint became known */
  foundAt: number | null;
  symbol: string | null;
  image: string | null;
  tasks: LaunchTask[];
  taskStates: LaunchTaskState[];
  autoDump: AutoDumpStatus | null;
};
export const CTO_WATCH_MS = 3_600_000;
/** GET /api/cto */
export type CtoListResponse = { ctos: CtoRecord[] };
/** POST /api/cto → { cto } · GET/DELETE /api/cto/[id] · PATCH /api/cto/[id] { address?, addressIs?, name?, tasks? } ·
 *  POST /api/cto/[id]/start (run the tasks now, mint must be known) · POST /api/cto/[id]/stop */
export type CtoResponse = { cto: CtoRecord };
export type CtoUpdateRequest = { address?: string; addressIs?: "token" | "dev"; name?: string; tasks?: LaunchTask[] };

/* ----------------------------------------------------------------- search */

export type SearchSort = "mc" | "age" | "volume";
export type SearchResultKind = "launch" | "draft" | "cto" | "recent" | "position" | "mint";
/** one row of the "Search tokens" dialog */
export type SearchResult = {
  kind: SearchResultKind;
  mint: string | null;
  /** for kind "draft" / "cto" */
  id: string | null;
  name: string | null;
  symbol: string | null;
  image: string | null;
  marketCapSol: number | null;
  marketCapUsd: number | null;
  /** seconds since creation when known */
  ageSec: number | null;
  /** SOL volume observed (feed / stats) when known */
  volumeSol: number | null;
  progress: number | null;
  /** where a click should go: /launch/<id>, /trading/<mint>… */
  href: string;
  /** which fields matched (name, symbol, mint, label) */
  matched: string[];
};
/** GET /api/search?q=&sort=mc|age|volume&limit= — matches launches, drafts, CTOs, recently viewed, vault positions;
 *  when q is a full mint, the token itself (RPC read). `tokenInfo` is set for a full-mint query. */
export type SearchResponse = { q: string; sort: SearchSort; results: SearchResult[]; tokenInfo: TokenInfo | null; at: number };

/* ------------------------------------------------------------ fees summary */

/** GET /api/dev/fees/summary — pending creator fees over every launched mint (one call for the Dashboard Rewards
 *  card). Fees accrue per CREATOR vault: launches sharing a dev wallet share one row. */
export type FeesSummaryCreator = {
  wallet: string;
  label: string;
  vault: string | null;
  pendingSol: string | null;
  claimableSol: string | null;
  cashbackSol: string | null;
  ammPendingSol: string | null;
  mints: string[];
};
export type FeesSummaryResponse = {
  at: number;
  /** sum over creators, null when every vault was unreadable */
  pendingSol: string | null;
  claimableSol: string | null;
  cashbackSol: string | null;
  ammPendingSol: string | null;
  /** SOL claimed through this app (activity journal, all time) */
  claimedSol: string;
  launches: number;
  creators: FeesSummaryCreator[];
  /** creators whose vault could not be read (RPC) */
  unreadable: string[];
};
