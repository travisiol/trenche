/* The Robinhood Chain (EVM) wallets, kept in their own folder next to the Solana vault:
 *   <data dir>/robinhood/eth-wallet.enc.json   encrypted keystore (same format + same passphrase as the vault), every wallet
 *   <data dir>/robinhood/ADDRESS.txt           the public addresses, readable without DONCHAIN
 *   <data dir>/robinhood/meta.json             which wallet is the main one (launches, bridge default) — public data only
 *   <data dir>/robinhood/backups/              a dated copy of the keystore before every write
 * The first wallet is created the first time the unlocked vault asks for one; the file is never regenerated (a file that
 * does not open is an error, not a reason to make a new key). A removed wallet stays in the encrypted file (deletedAt).
 * Private keys leave this module only via exportEvmKey. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { loadKeystore, saveKeystore } from "@/engine/keystore.js";
import { HttpError } from "../api";
import { requireUnlocked } from "../engine";
import { logActivity, readJson, store, writeJson } from "../store";
import { verifyPassphrase } from "../wallets";

type Entry = { label: string; privateKey: `0x${string}`; address: string; createdAt: number; deletedAt?: number };
type Bag = { entries: Entry[] | null };
export type EvmWallet = { address: string; label: string; createdAt: number; main: boolean };

export const MAX_EVM_WALLETS = 100;

export function rhDir(): string {
  return join(store().dir, "robinhood");
}
const keystorePath = () => join(rhDir(), "eth-wallet.enc.json");
const metaPath = () => join(rhDir(), "meta.json");

function bag(): Bag {
  const rt = store().runtime;
  if (!rt.rhWallet) rt.rhWallet = { entries: null } satisfies Bag;
  return rt.rhWallet as Bag;
}

const lc = (a: string) => a.toLowerCase();

function writeAddressFile(entries: Entry[]): void {
  const live = entries.filter((e) => !e.deletedAt);
  writeFileSync(
    join(rhDir(), "ADDRESS.txt"),
    [
      "DONCHAIN — Robinhood Chain wallets (chain id 4663, gas in ETH)",
      "",
      ...live.map((e) => `${e.address}  ${e.label}`),
      "",
      "The private keys are in eth-wallet.enc.json, encrypted with your DONCHAIN vault passphrase.",
      "Export them from DONCHAIN › Robinhood › Wallets › Export key. Never share them.",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

function backup(reason: string): void {
  const src = keystorePath();
  if (!existsSync(src)) return;
  const dir = join(rhDir(), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  copyFileSync(src, join(dir, `eth-wallet-${stamp}-${reason}.enc.json`));
  const all = readdirSync(dir).filter((f) => f.startsWith("eth-wallet-")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 100))) {
    try {
      unlinkSync(join(dir, old));
    } catch {
      /* keep it */
    }
  }
}

function persist(entries: Entry[], reason: string): void {
  backup(reason);
  saveKeystore(keystorePath(), store().passphrase!, entries);
  bag().entries = entries;
  writeAddressFile(entries);
}

/** every entry (removed ones included), decrypted once per unlock; creates the first wallet when there is no file */
function entries(): Entry[] {
  requireUnlocked();
  const st = store();
  const b = bag();
  if (b.entries) return b.entries;
  const path = keystorePath();
  mkdirSync(rhDir(), { recursive: true });
  if (existsSync(path)) {
    let raw: unknown;
    try {
      raw = loadKeystore(path, st.passphrase!);
    } catch (e) {
      throw new HttpError(500, `The Robinhood wallet file (${path}) does not open with the vault passphrase: ${e instanceof Error ? e.message : e}. Nothing was changed.`);
    }
    const list = (Array.isArray(raw) ? raw : []).filter((e): e is Entry => !!e && typeof e === "object" && /^0x[0-9a-fA-F]{64}$/.test(String((e as Entry).privateKey)));
    if (!list.length) throw new HttpError(500, `The Robinhood wallet file (${path}) holds no key. Nothing was changed.`);
    b.entries = list;
    return list;
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  persist([{ label: "Robinhood 1", privateKey, address: account.address, createdAt: Date.now() }], "create");
  logActivity(st, { kind: "wallets", ok: true, message: `Robinhood Chain wallet created: ${account.address} (${path}).` });
  return bag().entries!;
}

const live = () => entries().filter((e) => !e.deletedAt);

function mainAddress(): string {
  const list = live();
  const saved = readJson<{ main?: string }>(metaPath(), {}).main;
  const hit = saved ? list.find((e) => lc(e.address) === lc(saved)) : undefined;
  return (hit ?? list[0])?.address ?? "";
}

export function evmWallets(): EvmWallet[] {
  const main = lc(mainAddress());
  return live().map((e) => ({ address: e.address, label: e.label, createdAt: e.createdAt, main: lc(e.address) === main }));
}

function entryOf(address: string): Entry {
  const e = live().find((x) => lc(x.address) === lc(address));
  if (!e) throw new HttpError(404, `Robinhood wallet ${address.slice(0, 10)}… is not in DONCHAIN.`);
  return e;
}

/** a wallet's signer — the main wallet when no address is given; throws 423 while the vault is locked */
export function evmAccount(address?: string | null): PrivateKeyAccount {
  if (!address) {
    const main = mainAddress();
    if (!main) {
      // every wallet removed: make a fresh main one rather than leaving the page without a wallet
      return privateKeyToAccount(entryOf(evmCreate(1)[0].address).privateKey);
    }
    address = main;
  }
  return privateKeyToAccount(entryOf(address).privateKey);
}

export function evmIsOwn(address: string): boolean {
  return live().some((e) => lc(e.address) === lc(address));
}

export function evmCreate(count: number, label?: string): EvmWallet[] {
  const list = entries();
  const n = Math.max(1, Math.min(50, Math.round(count) || 1));
  if (list.filter((e) => !e.deletedAt).length + n > MAX_EVM_WALLETS) throw new HttpError(400, `${MAX_EVM_WALLETS} Robinhood wallets maximum.`);
  const base = list.length;
  const made: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const privateKey = generatePrivateKey();
    const a = privateKeyToAccount(privateKey);
    made.push({ label: label?.trim() ? (n > 1 ? `${label.trim()} ${i + 1}` : label.trim()) : `Robinhood ${base + i + 1}`, privateKey, address: a.address, createdAt: Date.now() });
  }
  persist([...list, ...made], "create");
  logActivity(store(), { kind: "wallets", ok: true, message: `Robinhood Chain: ${n} wallet(s) created.` });
  const main = lc(mainAddress());
  return made.map((e) => ({ address: e.address, label: e.label, createdAt: e.createdAt, main: lc(e.address) === main }));
}

/** private keys (0x + 64 hex, one per line, optional label before it) */
export function evmImport(text: string): { imported: number; skipped: string[] } {
  const list = entries();
  const skipped: string[] = [];
  const add: Entry[] = [];
  for (const [i, line] of String(text ?? "").split(/\r?\n/).entries()) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/(0x)?([0-9a-fA-F]{64})\b/);
    if (!m) {
      skipped.push(`Line ${i + 1}: no private key (64 hex characters).`);
      continue;
    }
    const pk = `0x${m[2].toLowerCase()}` as `0x${string}`;
    const a = privateKeyToAccount(pk);
    const existing = list.find((e) => lc(e.address) === lc(a.address));
    if (existing && !existing.deletedAt) {
      skipped.push(`Line ${i + 1}: ${a.address.slice(0, 10)}… already in DONCHAIN.`);
      continue;
    }
    if (existing) {
      delete existing.deletedAt; // re-import of a removed wallet = restore it
      add.push(existing);
      continue;
    }
    if (add.some((e) => lc(e.address) === lc(a.address))) continue;
    const label = s.replace(m[0], "").replace(/[,;\t]/g, " ").trim() || `Imported ${list.length + add.length + 1}`;
    add.push({ label: label.slice(0, 40), privateKey: pk, address: a.address, createdAt: Date.now() });
  }
  const fresh = add.filter((e) => !list.includes(e));
  if (live().length + fresh.length > MAX_EVM_WALLETS) throw new HttpError(400, `${MAX_EVM_WALLETS} Robinhood wallets maximum.`);
  if (add.length) {
    persist([...list, ...fresh], "import");
    logActivity(store(), { kind: "wallets", ok: true, message: `Robinhood Chain: ${add.length} wallet(s) imported.` });
  }
  return { imported: add.length, skipped };
}

export function evmRename(address: string, label: string): void {
  const e = entryOf(address);
  e.label = String(label ?? "").trim().slice(0, 40) || e.label;
  persist(entries(), "rename");
}

export function evmSetMain(address: string): void {
  const e = entryOf(address);
  writeJson(metaPath(), { main: e.address });
}

/** hidden from DONCHAIN, kept in the encrypted file (re-importing the key brings it back) */
export function evmRemove(address: string): void {
  const e = entryOf(address);
  if (live().length <= 1) throw new HttpError(400, "Keep at least one Robinhood wallet.");
  e.deletedAt = Date.now();
  persist(entries(), "remove");
  if (lc(readJson<{ main?: string }>(metaPath(), {}).main ?? "") === lc(e.address)) writeJson(metaPath(), { main: live()[0].address });
  logActivity(store(), { kind: "wallets", ok: true, message: `Robinhood Chain wallet removed (kept encrypted): ${e.address}.` });
}

export function exportEvmKey(passphrase: string, address?: string | null): { address: string; privateKey: string; path: string } {
  requireUnlocked();
  if (!verifyPassphrase(passphrase)) throw new HttpError(401, "Incorrect passphrase.");
  const e = entryOf(address || mainAddress());
  logActivity(store(), { kind: "wallets", ok: true, message: `Robinhood Chain key exported (${e.address}).` });
  return { address: e.address, privateKey: e.privateKey, path: keystorePath() };
}

export function evmKeystorePath(): string {
  return keystorePath();
}
