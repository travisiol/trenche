/* Hot state: everything a buy / sell / dump needs, kept warm in memory while a token or launch page is open, so the
 * click → "sent" path does no RPC read at all (sign + sendTransaction only).
 *
 *  - blockhash: refreshed every 2 s by the ticker (4 s on a public RPC); a click uses the cached one (≤ 20 s old,
 *    i.e. ≥ ~40 s of validity left) and only fetches when nothing is cached (page not open, API caller);
 *  - per viewed mint: bonding curve + every vault wallet's SOL balance and token balance (ATA), ONE chunked
 *    getMultipleAccounts per tick, re-read ~150 ms after one of our transactions lands (processed);
 *  - token program per mint and every PDA / ATA: cached forever (engine pdas.js memoizes derivations);
 *  - priority fee estimate per viewed mint (priority.ts, 5 s), Sender ping and the read RPC's WebSocket kept open.
 * `touchHot(mint)` is called by the routes a token / launch page polls; the ticker stops 90 s after the last touch. */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM, associatedTokenAddress, bondingCurvePda, parseBondingCurve, type BondingCurve } from "@/engine/solana/pump/pdas.js";
import { priorityFee } from "./priority";
import { warmSender } from "./sender";
import { warmSocket } from "./sigsub";
import { store } from "./store";

export type HotBalance = { sol: bigint; tokens: bigint | null; ataExists: boolean };
export type HotMint = {
  mint: string;
  tokenProgram: string | null;
  curve: BondingCurve | null;
  /** the curve account does not exist (not a pump.fun mint / migrated and closed) */
  curveMissing: boolean;
  at: number;
  owners: Set<string>;
  bal: Map<string, HotBalance>;
  activeUntil: number;
  refreshing: Promise<void> | null;
  dirtyTimer: ReturnType<typeof setTimeout> | null;
};
type Blockhash = { blockhash: string; lastValidBlockHeight: number; at: number };
type HotGlobal = {
  mints: Map<string, HotMint>;
  bh: Blockhash | null;
  bhInflight: Promise<Blockhash> | null;
  timer: ReturnType<typeof setInterval> | null;
  activeUntil: number;
  tokenPrograms: Map<string, string>;
  reads: number;
};
declare global {
  var __trenchHot: HotGlobal | undefined;
}
function g(): HotGlobal {
  if (!globalThis.__trenchHot) globalThis.__trenchHot = { mints: new Map(), bh: null, bhInflight: null, timer: null, activeUntil: 0, tokenPrograms: new Map(), reads: 0 };
  return globalThis.__trenchHot;
}

const ACTIVE_MS = 90_000;
/** a cached blockhash is used on the hot path up to this age (a blockhash lives ~60–90 s) */
const BLOCKHASH_MAX_AGE = 20_000;
const conn = () => store().sol.connection();
const isPublic = () => /publicnode|api\.(mainnet-beta|devnet)\.solana\.com/i.test(store().sol.config.rpcUrl);
const tickMs = () => (isPublic() ? 4000 : 2000);

/* ---------------------------------------------------------------- blockhash */

function fetchBlockhash(): Promise<Blockhash> {
  const s = g();
  if (s.bhInflight) return s.bhInflight;
  s.bhInflight = conn()
    .getLatestBlockhash("confirmed")
    .then((b) => {
      s.bh = { ...b, at: Date.now() };
      return s.bh;
    })
    .finally(() => {
      s.bhInflight = null;
    });
  return s.bhInflight;
}

/** blockhash for signing: the warm one when fresh enough (no RPC), else one fetch */
export async function blockhashNow(): Promise<{ blockhash: string; lastValidBlockHeight: number; cached: boolean }> {
  const b = g().bh;
  if (b && Date.now() - b.at < BLOCKHASH_MAX_AGE) return { blockhash: b.blockhash, lastValidBlockHeight: b.lastValidBlockHeight, cached: true };
  const f = await fetchBlockhash();
  return { blockhash: f.blockhash, lastValidBlockHeight: f.lastValidBlockHeight, cached: false };
}

/* ---------------------------------------------------------------- per-mint snapshot */

function vaultOwners(): string[] {
  const st = store();
  if (!st.sol.unlocked) return [];
  return st.sol.wallets.map((w) => w.address).filter((a) => !st.walletMeta.meta[a]?.archived);
}

function chunkSize(): number {
  return isPublic() ? 10 : 100;
}

async function readChunked(keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  const size = chunkSize();
  const out: (AccountInfo<Buffer> | null)[] = [];
  const parts: PublicKey[][] = [];
  for (let i = 0; i < keys.length; i += size) parts.push(keys.slice(i, i + size));
  const res = await Promise.all(parts.map((p) => conn().getMultipleAccountsInfo(p, "confirmed")));
  for (const r of res) out.push(...r);
  return out;
}

const tokenAmount = (info: AccountInfo<Buffer> | null): bigint | null => {
  if (!info?.data) return BigInt(0);
  try {
    return Buffer.from(info.data).readBigUInt64LE(64);
  } catch {
    return null;
  }
};

/** ONE chunked getMultipleAccounts: curve (+ mint when its token program is unknown) + owners + their ATAs */
async function readSnapshot(h: HotMint, owners: string[]): Promise<void> {
  const s = g();
  const mintPk = new PublicKey(h.mint);
  const ownerPks = owners.map((o) => new PublicKey(o));
  const known = h.tokenProgram ?? s.tokenPrograms.get(h.mint) ?? null;
  const programs = known ? [new PublicKey(known)] : [new PublicKey(TOKEN_2022_PROGRAM), new PublicKey(TOKEN_PROGRAM)];
  const keys: PublicKey[] = [bondingCurvePda(mintPk), ...(known ? [] : [mintPk]), ...ownerPks];
  for (const p of programs) keys.push(...ownerPks.map((o) => associatedTokenAddress(o, mintPk, p)));
  s.reads++;
  const infos = await readChunked(keys);
  let i = 0;
  const curveInfo = infos[i++];
  let program = known;
  if (!known) {
    const mintInfo = infos[i++];
    if (mintInfo) {
      program = mintInfo.owner.toBase58() === TOKEN_2022_PROGRAM ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
      s.tokenPrograms.set(h.mint, program);
    }
  }
  const sols = owners.map(() => infos[i++]);
  const ataSets = programs.map(() => owners.map(() => infos[i++]));
  const pIndex = known ? 0 : program === TOKEN_PROGRAM ? 1 : 0;
  h.tokenProgram = program;
  try {
    h.curve = curveInfo ? parseBondingCurve(curveInfo.data) : null;
  } catch {
    h.curve = null;
  }
  h.curveMissing = !curveInfo;
  owners.forEach((o, k) => {
    const ata = ataSets[pIndex][k];
    h.bal.set(o, { sol: BigInt(sols[k]?.lamports ?? 0), tokens: tokenAmount(ata), ataExists: !!ata });
    h.owners.add(o);
  });
  h.at = Date.now();
}

function hotOf(mint: string): HotMint {
  const s = g();
  let h = s.mints.get(mint);
  if (!h) {
    h = { mint, tokenProgram: s.tokenPrograms.get(mint) ?? null, curve: null, curveMissing: false, at: 0, owners: new Set(), bal: new Map(), activeUntil: 0, refreshing: null, dirtyTimer: null };
    s.mints.set(mint, h);
    if (s.mints.size > 50) {
      const oldest = [...s.mints.values()].sort((a, b) => a.activeUntil - b.activeUntil)[0];
      if (oldest && oldest.mint !== mint) s.mints.delete(oldest.mint);
    }
  }
  return h;
}

function refresh(h: HotMint, owners: string[]): Promise<void> {
  if (h.refreshing) return h.refreshing.then(() => (owners.every((o) => h.owners.has(o)) ? undefined : refresh(h, owners)));
  const all = [...new Set([...owners, ...vaultOwners()])];
  h.refreshing = readSnapshot(h, all).finally(() => {
    h.refreshing = null;
  });
  return h.refreshing;
}

export type Snapshot = { mint: string; tokenProgram: PublicKey; curve: BondingCurve | null; curveMissing: boolean; bal: Map<string, HotBalance>; ageMs: number; fromMemory: boolean };

/** curve + balances of `owners` on `mint`: from memory when younger than `maxAgeMs`, else ONE read */
export async function hotSnapshot(mint: string, owners: string[], maxAgeMs: number): Promise<Snapshot> {
  const h = hotOf(mint);
  const fresh = h.at > 0 && Date.now() - h.at <= maxAgeMs && h.tokenProgram && owners.every((o) => h.owners.has(o));
  if (!fresh) await refresh(h, owners);
  return {
    mint,
    tokenProgram: new PublicKey(h.tokenProgram ?? TOKEN_2022_PROGRAM),
    curve: h.curve,
    curveMissing: h.curveMissing,
    bal: new Map(owners.map((o) => [o, h.bal.get(o) ?? { sol: BigInt(0), tokens: BigInt(0), ataExists: false }])),
    ageMs: Date.now() - h.at,
    fromMemory: !!fresh,
  };
}

/** token program of a mint (cached forever once read) */
export function cachedTokenProgram(mint: string): string | null {
  return g().tokenPrograms.get(mint) ?? null;
}

export function rememberTokenProgram(mint: string, owner: string): void {
  g().tokenPrograms.set(mint, owner === TOKEN_2022_PROGRAM ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM);
}

/** one of our transactions on `mint` landed: re-read its snapshot shortly (coalesced) */
export function hotDirty(mint: string): void {
  const h = g().mints.get(mint);
  if (!h) return;
  h.at = 0; // never served from memory again until re-read
  if (h.dirtyTimer) return;
  h.dirtyTimer = setTimeout(() => {
    h.dirtyTimer = null;
    void refresh(h, []).catch(() => {});
  }, 150);
}

/* ---------------------------------------------------------------- ticker */

async function tick(): Promise<void> {
  const s = g();
  const now = Date.now();
  const active = [...s.mints.values()].filter((h) => h.activeUntil > now);
  if (s.activeUntil <= now && active.length === 0) {
    if (s.timer) clearInterval(s.timer);
    s.timer = null;
    return;
  }
  const cfg = store().sol.config;
  warmSender(cfg.sendRpcUrl);
  warmSocket(cfg.rpcUrl);
  await Promise.all([
    fetchBlockhash().catch(() => null),
    ...active.map((h) => refresh(h, []).catch(() => null)),
    ...active.map((h) => priorityFee(h.mint, store().settings.cuPrice).catch(() => null)),
  ]);
}

/** a page that may trade is open: keep the blockhash (and `mint`'s snapshot / fee) warm for the next 90 s */
export function touchHot(mint?: string | null): void {
  const s = g();
  const now = Date.now();
  s.activeUntil = now + ACTIVE_MS;
  if (mint) {
    try {
      new PublicKey(mint);
    } catch {
      return;
    }
    hotOf(mint).activeUntil = now + ACTIVE_MS;
  }
  if (!s.timer) {
    s.timer = setInterval(() => void tick().catch(() => {}), tickMs());
    void tick().catch(() => {});
  }
}

export function hotHealth(): { active: number; blockhashAgeMs: number | null; snapshots: { mint: string; ageMs: number; wallets: number }[]; reads: number } {
  const s = g();
  const now = Date.now();
  return {
    active: [...s.mints.values()].filter((h) => h.activeUntil > now).length,
    blockhashAgeMs: s.bh ? now - s.bh.at : null,
    snapshots: [...s.mints.values()].filter((h) => h.activeUntil > now).map((h) => ({ mint: h.mint, ageMs: h.at ? now - h.at : -1, wallets: h.owners.size })),
    reads: s.reads,
  };
}
