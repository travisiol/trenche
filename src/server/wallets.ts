/* Vault (keystore) + wallet metadata + balances. Secrets never leave this module except via exportKeys. */
import { PublicKey } from "@solana/web3.js";
import { assertStrongPassphrase, keystoreExists, loadKeystore, saveKeystore } from "@/engine/keystore.js";
import { parseSolanaKey } from "@/engine/solana/keys.js";
import { generateSolanaWallets, parseSolanaWalletLines } from "@/engine/solana/state.js";
import type { VaultStatus, WalletGroup, WalletInfo, WalletsResponse } from "@/lib/types";
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
    .map((e) => ({ label: String(e.label ?? ""), secret: e.secret }));
}

function load(st = store(), entries: KeystoreEntry[]): void {
  st.vault = entries;
  st.sol.load(entries);
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

function persist(st = store()): void {
  if (!st.passphrase) throw new HttpError(423, "Keystore locked.");
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
  return { wallets, groups: st.walletMeta.groups, active: st.walletMeta.active, unlocked: st.sol.unlocked && !!st.passphrase };
}

export function generateWallets(count: number, label?: string, group?: string): string[] {
  requireUnlocked();
  const st = store();
  const prefix = (label || "wallet").trim().replace(/\s+/g, "-").slice(0, 16) || "wallet";
  const fresh = generateSolanaWallets(count, prefix, st.vault.length);
  st.vault = [...st.vault, ...fresh.map(({ label: l, secret }) => ({ label: l, secret }))];
  persist(st);
  if (group) {
    if (!st.walletMeta.groups.some((g) => g.id === group)) throw new HttpError(400, "Unknown group.");
    for (const w of fresh) st.walletMeta.meta[w.address].group = group;
    saveWalletMeta(st);
  }
  logActivity(st, { kind: "wallets", ok: true, message: `${fresh.length} wallet(s) generated.`, wallets: fresh.map((w) => w.address) });
  return fresh.map((w) => w.address);
}

export function importWallets(lines: string[]): { added: number; errors: string[] } {
  requireUnlocked();
  const st = store();
  const { entries, errors } = parseSolanaWalletLines(lines.join("\n"));
  if (entries.length === 0) throw new HttpError(400, errors[0] ?? "No valid Solana key in the input.");
  const have = new Set(st.vault.map((e) => e.secret));
  const fresh = entries.filter((e) => !have.has(e.secret));
  st.vault = [...st.vault, ...fresh.map(({ label, secret }) => ({ label, secret }))];
  persist(st);
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
  const before = st.vault.length;
  st.vault = st.vault.filter((e) => !set.has(pubkeyOf(e.secret) ?? ""));
  const removed = before - st.vault.length;
  if (removed === 0) throw new HttpError(404, "None of these wallets is in the vault.");
  persist(st);
  for (const a of addresses) delete st.walletMeta.meta[a];
  if (st.walletMeta.active && set.has(st.walletMeta.active)) st.walletMeta.active = st.sol.wallets[0]?.address ?? null;
  saveWalletMeta(st);
  logActivity(st, { kind: "wallets", ok: true, message: `${removed} wallet(s) removed from the vault.`, wallets: addresses });
  return removed;
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
