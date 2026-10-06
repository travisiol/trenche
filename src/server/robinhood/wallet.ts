/* The Robinhood Chain (EVM) dev wallet, kept in its own folder next to the Solana vault:
 *   <data dir>/robinhood/eth-wallet.enc.json   encrypted keystore (same format + same passphrase as the vault)
 *   <data dir>/robinhood/ADDRESS.txt           the public address, readable without DONCHAIN
 *   <data dir>/robinhood/backups/              a dated copy of the keystore made when the wallet is created
 * Created once, the first time the unlocked vault asks for it; never regenerated over an existing file (a file that
 * does not open is an error, not a reason to make a new key). The private key leaves this module only via exportEvmKey. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { loadKeystore, saveKeystore } from "@/engine/keystore.js";
import { HttpError } from "../api";
import { requireUnlocked } from "../engine";
import { logActivity, store } from "../store";
import { verifyPassphrase } from "../wallets";

type Entry = { label: string; privateKey: `0x${string}`; address: string; createdAt: number };
type Bag = { entries: Entry[] | null; account: PrivateKeyAccount | null };

export function rhDir(): string {
  return join(store().dir, "robinhood");
}
const keystorePath = () => join(rhDir(), "eth-wallet.enc.json");

function bag(): Bag {
  const rt = store().runtime;
  if (!rt.rhWallet) rt.rhWallet = { entries: null, account: null } satisfies Bag;
  return rt.rhWallet as Bag;
}

/** public address without unlocking (null until the wallet exists): the decrypted one, else ADDRESS.txt */
export function evmAddressIfKnown(): string | null {
  const b = bag();
  if (b.account) return b.account.address;
  try {
    return readFileSync(join(rhDir(), "ADDRESS.txt"), "utf8").match(/0x[0-9a-fA-F]{40}/)?.[0] ?? null;
  } catch {
    return null;
  }
}

export function evmWalletExists(): boolean {
  return existsSync(keystorePath());
}

function writeAddressFile(address: string): void {
  writeFileSync(
    join(rhDir(), "ADDRESS.txt"),
    [
      "DONCHAIN — Robinhood Chain wallet (chain id 4663, gas in ETH)",
      "",
      `Address: ${address}`,
      "",
      "The private key is in eth-wallet.enc.json, encrypted with your DONCHAIN vault passphrase.",
      "Export it from DONCHAIN › Robinhood › Export key. Never share it.",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

/** the dev wallet's signer (created on first call); throws 423 while the vault is locked */
export function evmAccount(): PrivateKeyAccount {
  requireUnlocked();
  const st = store();
  const b = bag();
  if (b.account && b.entries) return b.account;
  const path = keystorePath();
  mkdirSync(rhDir(), { recursive: true });
  if (existsSync(path)) {
    let raw: unknown;
    try {
      raw = loadKeystore(path, st.passphrase!);
    } catch (e) {
      throw new HttpError(500, `The Robinhood wallet file (${path}) does not open with the vault passphrase: ${e instanceof Error ? e.message : e}. Nothing was changed.`);
    }
    const entries = (Array.isArray(raw) ? raw : []).filter((e): e is Entry => !!e && typeof e === "object" && /^0x[0-9a-fA-F]{64}$/.test(String((e as Entry).privateKey)));
    if (!entries.length) throw new HttpError(500, `The Robinhood wallet file (${path}) holds no key. Nothing was changed.`);
    b.entries = entries;
    b.account = privateKeyToAccount(entries[0].privateKey);
    return b.account;
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const entries: Entry[] = [{ label: "Robinhood dev", privateKey, address: account.address, createdAt: Date.now() }];
  saveKeystore(path, st.passphrase!, entries);
  const backups = join(rhDir(), "backups");
  mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  copyFileSync(path, join(backups, `eth-wallet-${stamp}-create.enc.json`));
  writeAddressFile(account.address);
  b.entries = entries;
  b.account = account;
  logActivity(st, { kind: "wallets", ok: true, message: `Robinhood Chain wallet created: ${account.address} (${path}).` });
  return account;
}

export function exportEvmKey(passphrase: string): { address: string; privateKey: string; path: string } {
  requireUnlocked();
  if (!verifyPassphrase(passphrase)) throw new HttpError(401, "Incorrect passphrase.");
  const account = evmAccount();
  const entry = bag().entries!.find((e) => e.address.toLowerCase() === account.address.toLowerCase())!;
  logActivity(store(), { kind: "wallets", ok: true, message: `Robinhood Chain key exported (${account.address}).` });
  return { address: account.address, privateKey: entry.privateKey, path: keystorePath() };
}

export function evmKeystorePath(): string {
  return keystorePath();
}
