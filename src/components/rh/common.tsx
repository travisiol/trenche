"use client";
/** Robinhood mode: shared types (the /api/robinhood/* answers), formatting and small pieces */
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useGet } from "@/lib/api";
import { short } from "@/lib/format";
import { cx } from "@/components/bx/ui";

export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const PONS_PAGE = (t: string) => `https://www.ponsfamily.com/launchpad/${t}`;
export const RH_LIME = "#ccff00";

export type RhWallet = { address: string; label: string; createdAt: number; main: boolean; group: string | null; balanceWei: string | null; escrowWei: string | null; launches: number };
export type RhGroup = { id: string; name: string };
export type RhBridge = {
  dir?: "rh2sol";
  inWei?: string;
  outLamports?: string;
  evmTx?: string | null;
  id: string;
  at: number;
  from: string;
  to: string;
  inLamports: string;
  outWei: string;
  status: "sending" | "deposited" | "pending" | "success" | "failure" | "refunded";
  solSignature: string | null;
  destTxs: string[];
  error: string | null;
  doneAt: number | null;
};
export type RhStatus = {
  address: string;
  totalWei: string;
  totalEscrowWei: string;
  wallets: RhWallet[];
  groups: RhGroup[];
  ethUsd: number | null;
  chainId: number;
  explorer: string;
  folder: string;
  keystore: string;
  bridges: RhBridge[];
};
export type RhSettings = { slippagePct: number; bundleGasLimit: number; devBuyEth: string; bundleEth: string; creatorTaxBps: number };
export type RhBundleBuy = { address: string; ethWei: string; hash: string | null; status: "sent" | "landed" | "failed" | "withheld"; tokens: string | null; error: string | null; sentMs: number | null };
export type RhTrade = { tx: string; block: number; li: number; ts: number; side: "buy" | "sell"; wallet: string; eth: string; tokens: string };
export type RhHolder = { address: string; label: string; group: string | null; main: boolean; ethWei: string; tokensWei: string; boughtWei: string; soldWei: string; valueEth: number | null; pnlEth: number | null; dev: boolean; bundle: boolean };
export type RhTokenView = {
  token: string;
  curve: string;
  name: string;
  symbol: string;
  logo: string | null;
  image: string | null;
  description: string;
  deployer: string | null;
  ours: boolean;
  launch: { txHash: string; at: number; dev: string | null; devBuyWei: string; bundle: RhBundleBuy[]; blockNumber: string | null; creatorTaxBps: number } | null;
  state: { quoteReserve: string; tokenReserve: string; realQuote: string; threshold: string; graduated: boolean; feeBps: number; creatorTaxBps: number; priceEth: number | null; mcapEth: number | null; progress: number | null };
  ethUsd: number | null;
  head: number;
  tradeCount: number;
  trades: RhTrade[];
  holders: RhHolder[];
  pnl: { spentWei: string; receivedWei: string; heldTokens: string; heldValueEth: number | null; launchFeeEth: number; netEth: number | null };
};
export type RhLaunchRow = { token: string; name: string; symbol: string; image: string | null; at: number; dev: string | null; bundle: number; mcapEth: number | null; progress: number | null; graduated: boolean; netEth: number | null; spentEth: number | null; heldValueEth: number | null };
export type RhTradeResult = { wallet: string; ok: boolean; hash: string | null; ethWei: string | null; tokensWei: string | null; error: string | null };
export type RhTransferResult = { from: string; to: string; valueWei: string; hash: string | null; ok: boolean; error: string | null };

/** every Robinhood page reads the same status (wallets, groups, ETH price, bridges) */
export function useRhStatus(intervalMs = 8000) {
  return useGet<RhStatus>("/api/robinhood", intervalMs);
}

export const weiNum = (wei: string | number | bigint | null | undefined) => (wei === null || wei === undefined ? 0 : Number(wei) / 1e18);
export const eth = (wei: string | number | bigint | null | undefined, dp = 5) => (wei === null || wei === undefined ? "—" : ethNum(Number(wei) / 1e18, dp));
export const ethNum = (n: number | null | undefined, dp = 5) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n === 0 ? "0" : Math.abs(n) < 10 ** -dp ? n.toExponential(2) : n.toFixed(dp).replace(/\.?0+$/, ""));
export const signed = (n: number | null | undefined, dp = 5) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${ethNum(n, dp)}`);
/** token amounts (18 decimals) as 12.3M / 845K */
export function tokens(wei: string | number | bigint | null | undefined): string {
  const n = Number(wei ?? 0) / 1e18;
  if (!n) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}
export const usdOf = (ethAmount: number | null | undefined, ethUsd: number | null | undefined) => {
  if (ethAmount === null || ethAmount === undefined || !ethUsd) return "—";
  const v = ethAmount * ethUsd;
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(2);
  return `${v < 0 ? "-" : ""}$${s}`;
};
export const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "text-text-100" : n > 0 ? "text-increase" : "text-decrease");

export function EthMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2 5 12.2 12 16.4l7-4.2L12 2Z" fill="currentColor" opacity=".9" />
      <path d="m5 13.6 7 9.4 7-9.4-7 4.2-7-4.2Z" fill="currentColor" opacity=".6" />
    </svg>
  );
}

/** the Robinhood Chain mark used by the chain switch (feather on lime) */
export function RhMark({ className }: { className?: string }) {
  return (
    <span className={cx("flex items-center justify-center rounded-[4px] bg-[#ccff00] text-black", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]">
        <path d="M19 4c-6 1-10 5-12 11l-2 5 2-1c1-3 3-5 5-6l-2 4c4-1 7-4 8-8l-3 1 3-3c.5-1 .8-2 1-3Z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Copyable({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className={cx("inline-flex min-w-0 items-center gap-1 font-mono text-xs text-text-200 hover:text-text-100", className)}
      title="Copy"
    >
      <span className="truncate">{label ?? text}</span>
      {ok ? <Check className="h-3 w-3 shrink-0 text-increase" /> : <Copy className="h-3 w-3 shrink-0 text-text-300" />}
    </button>
  );
}

export function EvmTx({ hash, label }: { hash: string; label?: string }) {
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[11px] text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
      {label ?? short(hash, 4, 4)}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function TokenAvatar({ src, symbol, size = 32 }: { src: string | null | undefined; symbol: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#ccff00]/30 bg-bg-50 text-[10px] font-semibold text-text-300" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- ipfs gateway
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        symbol.slice(0, 3).toUpperCase()
      )}
    </span>
  );
}

export function Kv({ k, v, strong, className }: { k: string; v: React.ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-3", className)}>
      <span className="text-text-300">{k}</span>
      <span className={cx("font-mono tabular-nums", strong ? "text-text-100" : "text-text-200")}>{v}</span>
    </div>
  );
}

/** a dropped / chosen image, center-cropped to a 512×512 PNG */
export async function squarePng(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Not an image."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
