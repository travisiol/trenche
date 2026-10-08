/* Robinhood mode settings, kept apart from the Solana ones in <data dir>/robinhood/settings.json */
import { join } from "node:path";
import { HttpError } from "../api";
import { readJson, writeJson } from "../store";
import { rhDir } from "./wallet";

export type RhSettings = {
  /** min-out haircut on every buy / sell (bundle buys and Sell All also assume the other wallets land first) */
  slippagePct: number;
  /** gas limit of a bundle buy signed before its curve exists (a buy uses ~103k; the rest is not charged) */
  bundleGasLimit: number;
  /** defaults of the Launch form */
  devBuyEth: string;
  bundleEth: string;
  creatorTaxBps: number;
};

export const RH_DEFAULTS: RhSettings = { slippagePct: 20, bundleGasLimit: 260_000, devBuyEth: "0.01", bundleEth: "0.005", creatorTaxBps: 0 };

const path = () => join(rhDir(), "settings.json");

export function rhSettings(): RhSettings {
  return { ...RH_DEFAULTS, ...readJson<Partial<RhSettings>>(path(), {}) };
}

const ethStr = (v: unknown, what: string) => {
  const s = String(v ?? "").replace(",", ".").trim();
  if (!/^\d*\.?\d+$/.test(s)) throw new HttpError(400, `${what}: an ETH amount.`);
  return s;
};

export function saveRhSettings(patch: Partial<RhSettings>): RhSettings {
  const cur = rhSettings();
  const next: RhSettings = { ...cur };
  if (patch.slippagePct !== undefined) {
    const n = Number(patch.slippagePct);
    if (!(n >= 0.5 && n <= 90)) throw new HttpError(400, "Slippage: 0.5–90 %.");
    next.slippagePct = n;
  }
  if (patch.bundleGasLimit !== undefined) {
    const n = Math.round(Number(patch.bundleGasLimit));
    if (!(n >= 120_000 && n <= 1_000_000)) throw new HttpError(400, "Bundle gas limit: 120 000 – 1 000 000.");
    next.bundleGasLimit = n;
  }
  if (patch.devBuyEth !== undefined) next.devBuyEth = ethStr(patch.devBuyEth, "Dev buy");
  if (patch.bundleEth !== undefined) next.bundleEth = ethStr(patch.bundleEth, "Bundle buy");
  if (patch.creatorTaxBps !== undefined) {
    const n = Math.round(Number(patch.creatorTaxBps));
    if (!(n >= 0 && n <= 1000)) throw new HttpError(400, "Creator tax: 0–10 %.");
    next.creatorTaxBps = n;
  }
  writeJson(path(), next);
  return next;
}
