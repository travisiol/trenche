/* Vault (keystore) + wallet metadata + balances. Secrets never leave this module except via exportKeys. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { assertStrongPassphrase, keystoreExists, loadKeystore, saveKeystore } from "@/engine/keystore.js";
import { parseSolanaKey } from "@/engine/solana/keys.js";
import { generateSolanaWallets, parseSolanaWalletLines } from "@/engine/solana/state.js";
import type { VaultStatus, WalletGroup, WalletInfo, WalletsResponse } from "@/lib/types";
import { WALLET_LIMITS } from "@/lib/types";
import { HttpError, solString } from "./api";
import { getAccountsChunked, requireUnlocked } from "./engine";
import { logActivity, saveWalletMeta, store, type KeystoreEntry } from "./store";

export function vaultStatus(): VaultStatus {
  const st = store();
  return { exists: keystoreExists(st.paths.keystore), unlocked: st.sol.unlocked && !!st.passphrase, path: st.paths.keystore };
}

function parseEntries(raw: unknown): KeystoreEntry[] {
  if (!Array.isArray(raw)) throw new HttpError(500, "Keystore content is not a wallet list.");
  return raw
    .filter((e): e is KeystoreEntry => !!e && typeof e === "object" && typeof (e as KeystoreEntry).secret === "string")
    .map((e) => ({ label: String(e.label ?? ""), secret: e.secret, ...(typeof e.deletedAt === "number" ? { deletedAt: e.deletedAt } : {}) }));
}

function load(st = store(), entries: KeystoreEntry[]): void {
  st.vault = entries;
  // removed wallets stay in the encrypted vault (restorable) but are not loaded: they cannot sign anything
  st.sol.load(entries.filter((e) => !e.deletedAt));
  // keep meta in sync: every wallet has an order
  let changed = false;
  let maxOrder = Math.max(-1, ...Object.values(st.walletMeta.meta).map((m) => m.order));
  for (const w of st.sol.wallets) {
    if (!st.walletMeta.meta[w.address]) {
      st.walletMeta.meta[w.address] = { group: null, archived: false, order: ++maxOrder };
      changed = true;
    }
  }
  // drop meta left by wallets that are no longer in this vault, and an active wallet that is not in it
  const known = new Set(st.sol.wallets.map((w) => w.address));
  for (const a of Object.keys(st.walletMeta.meta)) {
    if (!known.has(a)) {
      delete st.walletMeta.meta[a];
      changed = true;
    }
  }
  if (st.walletMeta.active && !known.has(st.walletMeta.active)) {
    st.walletMeta.active = null;
    changed = true;
  }
  if (!st.walletMeta.active && st.sol.wallets[0]) {
    st.walletMeta.active = st.sol.wallets[0].address;
    changed = true;
  }
  if (changed) saveWalletMeta(st);
}

export function vaultCreate(passphrase: string): VaultStatus {
  const st = store();
  if (keystoreExists(st.paths.keystore)) throw new HttpError(409, "A vault already exists. Unlock it instead.");
  assertStrongPassphrase(passphrase);
  saveKeystore(st.paths.keystore, passphrase, []);
  st.passphrase = passphrase;
  load(st, []);
  logActivity(st, { kind: "vault", ok: true, message: "Vault created." });
  return vaultStatus();
}

export function vaultUnlock(passphrase: string): VaultStatus {
  const st = store();
  if (!keystoreExists(st.paths.keystore)) throw new HttpError(404, "No vault yet. Create one first.");
  let raw: unknown;
  try {
    raw = loadKeystore(st.paths.keystore, passphrase);
  } catch (e) {
    throw new HttpError(401, e instanceof Error ? e.message : "Incorrect passphrase.");
  }
  st.passphrase = passphrase;
  load(st, parseEntries(raw));
  logActivity(st, { kind: "vault", ok: true, message: `Vault unlocked: ${st.sol.wallets.length} wallet(s).` });
  return vaultStatus();
}

export function vaultLock(): VaultStatus {
  const st = store();
  st.passphrase = null;
  st.vault = [];
  st.sol.lock();
  delete st.runtime.rhWallet; // the decrypted Robinhood Chain key (robinhood/wallet.ts)
  return vaultStatus();
}

/** re-check the passphrase against the keystore (export) */
export function verifyPassphrase(passphrase: string): boolean {
  const st = store();
  try {
    loadKeystore(st.paths.keystore, passphrase);
    return true;
  } catch {
    return false;
  }
}

const MAX_BACKUPS = 100;

/** dated copy of the encrypted vault before every write (backups/keystore-YYYYMMDD-HHMMSS.enc.json, 100 kept) — the
 *  same passphrase opens them; the file is encrypted, never a plain key */
export function backupKeystore(st = store(), reason = "write"): string | null {
  const src = st.paths.keystore;
  if (!existsSync(src)) return null;
  const dir = join(dirname(src), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const dest = join(dir, `keystore-${stamp}-${reason}.enc.json`);
  copyFileSync(src, dest);
  const all = readdirSync(dir)
    .filter((f) => /^keystore-.*\.enc\.json$/.test(f))
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) {
    try {
      unlinkSync(join(dir, old));
    } catch {
      /* keep it */
    }
  }
  return dest;
}

export function backupsDir(st = store()): string {
  return join(dirname(st.paths.keystore), "backups");
}

function persist(st = store(), reason = "write"): void {
  if (!st.passphrase) throw new HttpError(423, "Keystore locked.");
  backupKeystore(st, reason);
  saveKeystore(st.paths.keystore, st.passphrase, st.vault);
  load(st, st.vault);
}

export function walletsResponse(): WalletsResponse {
  const st = store();
  const bal = st.balances?.map ?? {};
  const wallets: WalletInfo[] = st.sol.wallets
    .map((w) => {
      const m = st.walletMeta.meta[w.address] ?? { group: null, archived: false, order: 0 };
      return { address: w.address, label: m.label || w.label, group: m.group ?? null, archived: !!m.archived, order: m.order ?? 0, sol: bal[w.address] ?? null };
    })
    .sort((a, b) => a.order - b.order);
  const listed = new Set(wallets.map((w) => w.address));
  const history = ownedAddresses().filter((a) => !listed.has(a));
  return { wallets, groups: st.walletMeta.groups, active: st.walletMeta.active, unlocked: st.sol.unlocked && !!st.passphrase, history };
}

/** every address that is ours: the vault's wallets, the trash (while unlocked) and every wallet a launch used —
 *  a dev deleted after its launch still counts in that launch's positions, PnL and "you" markers */
export function ownedAddresses(): string[] {
  const st = store();
  const out = new Set(st.sol.wallets.map((w) => w.address));
  if (st.sol.unlocked) for (const e of st.vault) if (e.deletedAt) { const a = pubkeyOf(e.secret); if (a) out.add(a); }
  for (const l of st.launches) {
    if (l.dev) out.add(l.dev);
    for (const w of l.wallets ?? []) out.add(w);
  }
  return [...out];
}

/** label of an owned address that is no longer listed (trash), else null */
export function trashedLabel(address: string): string | null {
  const st = store();
  if (!st.sol.unlocked) return null;
  return st.vault.find((e) => e.deletedAt && pubkeyOf(e.secret) === address)?.label || null;
}

/** Block X "Create Wallets": numbered labels "<prefix> n" (Sniper 1, Sniper 2…), n continuing after the existing ones */
export function generateWallets(count: number, label?: string, group?: string): string[] {
  requireUnlocked();
  const st = store();
  if (!Number.isFinite(count) || count < 1) throw new HttpError(400, "Number of wallets: at least 1.");
  if (count > WALLET_LIMITS.maxCreate) throw new HttpError(400, `Generate up to ${WALLET_LIMITS.maxCreate} new developer wallets at once (asked ${count}).`);
  // no prefix typed: wallets created in a group are named after it ("dev 1", "dev 2"…), numbered on their own
  const groupName = group ? st.walletMeta.groups.find((g) => g.id === group)?.name : undefined;
  const prefix = (label || groupName || "Wallet").trim().replace(/\s+/g, " ").slice(0, 24) || "Wallet";
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`);
  let n = Math.max(0, ...Object.values(st.walletMeta.meta).map((m) => Number(m.label?.match(re)?.[1] ?? 0)), ...st.sol.wallets.map((w) => Number(w.label.match(re)?.[1] ?? 0)));
  const fresh = generateSolanaWallets(count, prefix.replace(/\s+/g, "-"), st.vault.length).map((w) => ({ ...w, label: `${prefix} ${++n}` }));
  st.vault = [...st.vault, ...fresh.map(({ label: l, secret }) => ({ label: l, secret }))];
  persist(st);
  for (const w of fresh) {
    const m = (st.walletMeta.meta[w.address] ??= { group: null, archived: false, order: 0 });
    m.label = w.label;
    if (group) {
      if (!st.walletMeta.groups.some((g) => g.id === group)) throw new HttpError(400, "Unknown group.");
      m.group = group;
    }
  }
  saveWalletMeta(st);
  logActivity(st, { kind: "wallets", ok: true, message: `${fresh.length} wallet(s) generated (${prefix}).`, wallets: fresh.map((w) => w.address) });
  return fresh.map((w) => w.address);
}

/** Block X "Import Wallets": up to 50 keys, labelled "<prefix> n" (Imported 1, Imported 2…) unless the line carries its own label */
export function importWallets(lines: string[], prefix = "Imported"): { added: number; errors: string[] } {
  requireUnlocked();
  const st = store();
  // one key per line, or comma-separated base58 keys; a JSON byte array "[1,2,…]" stays whole
  const keys = lines
    .join("\n")
    .split(/\r?\n/)
    .flatMap((l) => (l.trim().startsWith("[") ? [l.trim()] : l.split(",")))
    .map((l) => l.trim())
    .filter(Boolean);
  if (keys.length > WALLET_LIMITS.maxImport) throw new HttpError(400, `Up to ${WALLET_LIMITS.maxImport} keys per import (got ${keys.length}).`);
  const { entries, errors } = parseSolanaWalletLines(keys.join("\n"));
  if (entries.length === 0) throw new HttpError(400, errors[0] ?? "No valid Solana key in the input.");
  const trashed = new Set(st.vault.filter((e) => e.deletedAt).map((e) => e.secret));
  const back = entries.filter((e) => trashed.has(e.secret));
  if (back.length) st.vault = st.vault.map((e) => (trashed.has(e.secret) && back.some((b) => b.secret === e.secret) ? { label: e.label, secret: e.secret } : e));
  const have = new Set(st.vault.map((e) => e.secret));
  const pfx = (prefix || "Imported").trim().replace(/\s+/g, " ").slice(0, 24) || "Imported";
  const re = new RegExp(`^${pfx.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`);
  let n = Math.max(0, ...Object.values(st.walletMeta.meta).map((m) => Number(m.label?.match(re)?.[1] ?? 0)), ...st.sol.wallets.map((w) => Number(w.label.match(re)?.[1] ?? 0)));
  const fresh = entries.filter((e) => !have.has(e.secret)).map((e) => ({ secret: e.secret, label: e.label && !/^(imported|wallet|sol|key)-?\d*$/i.test(e.label) ? e.label : `${pfx} ${++n}` }));
  st.vault = [...st.vault, ...fresh.map(({ label, secret }) => ({ label, secret }))];
  persist(st);
  for (const e of fresh) {
    const addr = pubkeyOf(e.secret);
    if (addr) (st.walletMeta.meta[addr] ??= { group: null, archived: false, order: 0 }).label = e.label;
  }
  saveWalletMeta(st);
  logActivity(st, { kind: "wallets", ok: true, message: `${fresh.length} wallet(s) imported.` });
  return { added: fresh.length, errors };
}

export function updateWallet(address: string, patch: { label?: string; group?: string | null; archived?: boolean; order?: number }): void {
  const st = store();
  if (!st.sol.wallets.some((w) => w.address === address)) throw new HttpError(404, "Wallet not in the vault.");
  const m = (st.walletMeta.meta[address] ??= { group: null, archived: false, order: 0 });
  if (patch.label !== undefined) {
    const l = String(patch.label).trim().slice(0, 32);
    if (!l) throw new HttpError(400, "Label cannot be empty.");
    m.label = l;
  }
  if (patch.group !== undefined) {
    if (patch.group !== null && !st.walletMeta.groups.some((g) => g.id === patch.group)) throw new HttpError(400, "Unknown group.");
    m.group = patch.group;
  }
  if (patch.archived !== undefined) m.archived = !!patch.archived;
  if (patch.order !== undefined) {
    const target = Math.max(0, Math.round(Number(patch.order)));
    // re-index: move this wallet to `target`, shift the others
    const ordered = st.sol.wallets.map((w) => w.address).filter((a) => a !== address).sort((a, b) => (st.walletMeta.meta[a]?.order ?? 0) - (st.walletMeta.meta[b]?.order ?? 0));
    ordered.splice(Math.min(target, ordered.length), 0, address);
    ordered.forEach((a, i) => {
      (st.walletMeta.meta[a] ??= { group: null, archived: false, order: i }).order = i;
    });
  }
  saveWalletMeta(st);
}

export function setActive(address: string): void {
  const st = store();
  if (!st.sol.wallets.some((w) => w.address === address)) throw new HttpError(404, "Wallet not in the vault.");
  st.walletMeta.active = address;
  saveWalletMeta(st);
}

export function exportKeys(addresses: string[], passphrase: string): { address: string; label: string; secret: string }[] {
  requireUnlocked();
  const st = store();
  if (!verifyPassphrase(passphrase)) throw new HttpError(401, "Incorrect passphrase.");
  const out: { address: string; label: string; secret: string }[] = [];
  for (const a of addresses) {
    const w = st.sol.wallets.find((x) => x.address === a);
    if (!w) throw new HttpError(404, `Wallet ${a.slice(0, 8)}… not in the vault.`);
    const secret = st.vault.find((e) => pubkeyOf(e.secret) === a)?.secret;
    if (!secret) throw new HttpError(500, "Secret not found for this wallet.");
    out.push({ address: a, label: st.walletMeta.meta[a]?.label || w.label, secret });
  }
  logActivity(st, { kind: "wallets", ok: true, message: `Key export: ${out.length} wallet(s).`, wallets: addresses });
  return out;
}

function pubkeyOf(secret: string): string | null {
  try {
    return parseSolanaKey(secret).publicKey.toBase58();
  } catch {
    return null;
  }
}

export function removeWallets(addresses: string[]): number {
  requireUnlocked();
  const st = store();
  const set = new Set(addresses);
  // never erased: the key moves to the vault's trash (deletedAt), still encrypted, restorable from Portfolio
  const now = Date.now();
  let removed = 0;
  st.vault = st.vault.map((e) => {
    const a = pubkeyOf(e.secret) ?? "";
    if (!set.has(a) || e.deletedAt) return e;
    removed++;
    return { ...e, label: st.walletMeta.meta[a]?.label || e.label, deletedAt: now };
  });
  if (removed === 0) throw new HttpError(404, "None of these wallets is in the vault.");
  persist(st, "remove");
  for (const a of addresses) delete st.walletMeta.meta[a];
  if (st.walletMeta.active && set.has(st.walletMeta.active)) st.walletMeta.active = st.sol.wallets[0]?.address ?? null;
  saveWalletMeta(st);
  logActivity(st, { kind: "wallets", ok: true, message: `${removed} wallet(s) moved to the trash (keys kept, restorable).`, wallets: addresses });
  return removed;
}

/** wallets in the trash: removed from the list, keys still in the encrypted vault */
export function removedWallets(): { address: string; label: string; deletedAt: number }[] {
  requireUnlocked();
  return store()
    .vault.filter((e) => e.deletedAt)
    .map((e) => ({ address: pubkeyOf(e.secret) ?? "", label: e.label, deletedAt: e.deletedAt! }))
    .filter((w) => w.address)
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

/** keys found in the vault's backups (keystore.enc.json.bak + backups/*) that are no longer in the vault — e.g. wallets
 *  deleted before the trash existed — are added to the trash. Opened with the passphrase of the unlocked vault; a
 *  backup made under another passphrase is skipped. */
export function recoverFromBackups(): { recovered: number; scanned: number; unreadable: number } {
  requireUnlocked();
  const st = store();
  const files = [`${st.paths.keystore}.bak`];
  try {
    for (const f of readdirSync(backupsDir(st))) if (f.startsWith("keystore-")) files.push(join(backupsDir(st), f));
  } catch {
    /* no backups folder yet */
  }
  const have = new Set(st.vault.map((e) => e.secret));
  const found = new Map<string, KeystoreEntry>();
  let scanned = 0, unreadable = 0;
  for (const f of files) {
    if (!existsSync(f)) continue;
    scanned++;
    let raw: unknown;
    try {
      raw = loadKeystore(f, st.passphrase!);
    } catch {
      unreadable++;
      continue;
    }
    let entries: KeystoreEntry[] = [];
    try {
      entries = parseEntries(raw);
    } catch {
      unreadable++;
      continue;
    }
    for (const e of entries) if (!have.has(e.secret) && !found.has(e.secret) && pubkeyOf(e.secret)) found.set(e.secret, { label: e.label, secret: e.secret, deletedAt: Date.now() });
  }
  if (found.size) {
    st.vault = [...st.vault, ...found.values()];
    persist(st, "recover");
    logActivity(st, { kind: "wallets", ok: true, message: `${found.size} wallet(s) recovered from backups into the trash.` });
  }
  return { recovered: found.size, scanned, unreadable };
}

/** back from the trash, with their label */
export function restoreWallets(addresses: string[]): number {
  requireUnlocked();
  const st = store();
  const set = new Set(addresses);
  const labels = new Map<string, string>();
  let restored = 0;
  st.vault = st.vault.map((e) => {
    const a = pubkeyOf(e.secret) ?? "";
    if (!e.deletedAt || !set.has(a)) return e;
    restored++;
    labels.set(a, e.label);
    const { deletedAt: _gone, ...rest } = e;
    return rest;
  });
  if (!restored) throw new HttpError(404, "None of these wallets is in the trash.");
  persist(st, "restore");
  for (const [a, l] of labels) (st.walletMeta.meta[a] ??= { group: null, archived: false, order: 0 }).label = l;
  saveWalletMeta(st);
  logActivity(st, { kind: "wallets", ok: true, message: `${restored} wallet(s) restored from the trash.`, wallets: addresses });
  return restored;
}

export function createGroup(name: string): WalletGroup {
  const st = store();
  const n = name.trim().slice(0, 32);
  if (!n) throw new HttpError(400, "Group name required.");
  const g = { id: "g_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n };
  st.walletMeta.groups.push(g);
  saveWalletMeta(st);
  return g;
}

export function deleteGroup(id: string): void {
  const st = store();
  if (!st.walletMeta.groups.some((g) => g.id === id)) throw new HttpError(404, "Unknown group.");
  st.walletMeta.groups = st.walletMeta.groups.filter((g) => g.id !== id);
  for (const m of Object.values(st.walletMeta.meta)) if (m.group === id) m.group = null;
  saveWalletMeta(st);
}

export function renameGroup(id: string, name: string): WalletGroup {
  const st = store();
  const g = st.walletMeta.groups.find((x) => x.id === id);
  if (!g) throw new HttpError(404, "Unknown group.");
  const n = name.trim().slice(0, 32);
  if (!n) throw new HttpError(400, "Group name required.");
  g.name = n;
  saveWalletMeta(st);
  return g;
}

/** label every wallet of a group "<group name> 1, 2, 3…" in their list order */
export function numberGroupWallets(id: string): number {
  const st = store();
  const g = st.walletMeta.groups.find((x) => x.id === id);
  if (!g) throw new HttpError(404, "Unknown group.");
  const prefix = g.name.trim().slice(0, 24);
  const members = st.sol.wallets
    .map((w) => ({ address: w.address, order: st.walletMeta.meta[w.address]?.order ?? 0, group: st.walletMeta.meta[w.address]?.group ?? null }))
    .filter((w) => w.group === id)
    .sort((a, b) => a.order - b.order);
  members.forEach((w, i) => {
    (st.walletMeta.meta[w.address] ??= { group: id, archived: false, order: w.order }).label = `${prefix} ${i + 1}`;
  });
  saveWalletMeta(st);
  return members.length;
}

/** Move several wallets into a group (or out of every group with null) in one call. */
export function moveWallets(addresses: string[], group: string | null): void {
  const st = store();
  if (group && !st.walletMeta.groups.some((g) => g.id === group)) throw new HttpError(400, "Unknown group.");
  const known = new Set(st.sol.wallets.map((w) => w.address));
  for (const a of addresses) {
    if (!known.has(a)) throw new HttpError(404, `Unknown wallet ${a}.`);
    (st.walletMeta.meta[a] ??= { group: null, archived: false, order: 0 }).group = group;
  }
  saveWalletMeta(st);
}

/** SOL balances of every vault wallet, one batched RPC call, 5 s cache; null entries when the RPC fails */
export async function balances(force = false): Promise<Record<string, string | null>> {
  const st = store();
  const addrs = st.sol.wallets.map((w) => w.address);
  if (addrs.length === 0) return {};
  if (!force && st.balances && Date.now() - st.balances.at < 5000 && addrs.every((a) => a in st.balances!.map)) return st.balances.map;
  const map: Record<string, string | null> = {};
  try {
    const infos = await getAccountsChunked(st.sol.connection(), addrs.map((a) => new PublicKey(a)));
    addrs.forEach((a, k) => {
      map[a] = solString(BigInt(infos[k]?.lamports ?? 0));
    });
  } catch {
    for (const a of addrs) map[a] = st.balances?.map[a] ?? null;
  }
  st.balances = { at: Date.now(), map };
  return map;
}
