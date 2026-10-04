"use client";
/** Block X trenches card (markup from design/blockx/trenches.html). Only computable capsules are rendered. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Zap } from "lucide-react";
import type { FeedCard as Card, JobCreated } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { useSettings, useVault, useWallets } from "@/lib/store";
import { age, compact, short, sol, usd } from "@/lib/format";
import { toast } from "../ui";
import { cx } from "../bx/ui";
import { pushRecent } from "../bx/recent";

function CopyMint({ mint }: { mint: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy address"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(mint).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1000);
        });
      }}
      className="hidden shrink-0 cursor-pointer items-center gap-1 text-[12px] font-medium text-text-300 transition-colors hover:text-text-100 lg:flex"
    >
      {mint.slice(0, 4)}...{mint.slice(-4)}
      {done ? <Check className="h-3 w-3 text-green-100" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/** Token avatar with the bonding-curve progress ring and the launchpad badge. */
export function TokenAvatarRing({ src, alt, progress, migrated }: { src: string | null; alt: string; progress: number | null; migrated: boolean }) {
  const [broken, setBroken] = useState(false);
  const r = 37;
  const c = 2 * Math.PI * r;
  const p = migrated ? 100 : Math.max(0, Math.min(100, progress ?? 0));
  return (
    <div className="relative flex flex-col items-center justify-center">
      <div className="flex h-[50px] w-[50px] flex-col items-center justify-center rounded-md lg:h-[72px] lg:w-[72px] lg:rounded-lg">
        <div className="flex h-[47px] w-[47px] flex-col items-center justify-center rounded-[5px] border-[2px] border-bg-100 bg-bg-100 lg:h-[68px] lg:w-[68px] lg:rounded-md lg:border-[3px]">
          <div className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-line-100 bg-black lg:h-[66px] lg:w-[66px] lg:rounded-[6px]">
            <div className="flex h-full w-full items-center justify-center bg-black">
              <span className="text-[15px] font-semibold leading-none text-white lg:text-[22px]">{alt.slice(0, 1).toUpperCase()}</span>
            </div>
            {src && !broken ? (
              <div className="absolute inset-0">
                <div className="relative h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element -- token image from ipfs/cdn */}
                  <img src={src} alt={alt} className="h-full w-full rounded-[6px] object-cover opacity-100 transition-opacity duration-150" onError={() => setBroken(true)} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="absolute -bottom-[2px] -right-[3px] z-10 flex h-[13px] min-w-[13px] items-center justify-center rounded-full border-[1.5px] bg-bg-100 px-[2px] lg:h-[18px] lg:min-w-[18px] lg:px-[2.5px]" style={{ borderColor: "rgb(82, 212, 143)" }} title="Pump.fun">
          {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
          <img src="/launchpads/pumpfun.svg" alt="Pump.fun" width={10} height={10} className="block h-[7px] w-[7px] object-contain lg:h-[10px] lg:w-[10px]" />
        </div>
        <div className="pointer-events-none absolute flex h-[52px] w-[52px] items-center justify-center rounded-[4px] lg:h-[74px] lg:w-[74px]">
          <svg className="h-[55px] w-[55px] lg:h-[78px] lg:w-[78px]" viewBox="0 0 78 78" aria-hidden>
            <circle cx="39" cy="39" r={r} fill="none" stroke="var(--line-100)" strokeWidth="2" />
            <circle cx="39" cy="39" r={r} fill="none" stroke={migrated ? "var(--green-100)" : "var(--accent)"} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 39 39)" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Audit({ title, value, good, children }: { title: string; value: string; good: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("flex items-center gap-1 rounded-[4px] border border-solid border-line-100 px-[6px] py-[4px] text-[12px] hover:border-line-200", good ? "text-audit-good hover:bg-audit-good-muted" : "text-decrease hover:bg-decrease/10")} title={title}>
      <div className="flex items-center gap-[3px]">
        {children}
        <span className="whitespace-nowrap">{value}</span>
      </div>
    </div>
  );
}

export function FeedCardView({ card, now, preset, hovered, onHover }: { card: Card; now: number; preset: string; hovered: boolean; onHover: (mint: string | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const vault = useVault();
  const wallets = useWallets();
  const settings = useSettings();
  const canSign = (vault.data?.unlocked ?? false) && !!wallets.data?.active;

  const quickBuy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const active = wallets.data?.active;
    if (!canSign || !active) return toast("Unlock the vault and pick an active wallet in Portfolio", "err");
    setBusy(true);
    try {
      await post<JobCreated>("/api/trade/buy", { mint: card.mint, wallets: [active], sol: preset, slippageBps: settings.data?.slippageBps ?? 2000 });
      toast(`Buying ${preset} SOL of ${card.symbol ?? short(card.mint)}`, "info");
    } catch (err) {
      toast(failureMessage(err), "err");
    } finally {
      setBusy(false);
    }
  };
  const open = () => {
    pushRecent({ mint: card.mint, symbol: card.symbol, name: card.name, image: card.image ?? card.imageCdn });
    router.push(`/trade/${card.mint}`);
  };
  const mc = card.marketCapUsd !== null ? usd(card.marketCapUsd) : card.marketCapSol !== null ? `${sol(card.marketCapSol)} SOL` : "—";
  const audits = [
    card.top10Pct !== null ? { key: "top10", title: "Top 10 holders", value: `${card.top10Pct.toFixed(0)}%`, good: card.top10Pct <= 30 } : null,
    card.devPct !== null ? { key: "dev", title: `Dev hold ${card.devPct.toFixed(1)}%`, value: `${card.devPct.toFixed(1)}%`, good: card.devPct <= 10 } : null,
  ].filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <div
      role="button"
      tabIndex={0}
      data-mint={card.mint}
      onMouseEnter={() => onHover(card.mint)}
      onMouseLeave={() => onHover(null)}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className={cx("group/card relative flex min-h-[124px] w-full shrink-0 cursor-pointer flex-col gap-1.5 overflow-hidden border-b border-solid border-line-50 p-[14px] pb-3 text-sm hover:bg-hover-100 lg:h-[124px] lg:flex-row lg:items-stretch lg:gap-2", hovered ? "bg-hover-100" : "")}
    >
      <div className="flex min-h-0 flex-1 items-start gap-2 lg:h-full lg:items-stretch">
        <div className="flex shrink-0 flex-col items-start justify-start gap-1 lg:items-center lg:justify-center">
          <div className="flex flex-col items-center justify-center gap-1">
            <TokenAvatarRing src={card.image ?? card.imageCdn} alt={card.symbol ?? "?"} progress={card.progress} migrated={card.migrated} />
          </div>
          <CopyMint mint={card.mint} />
        </div>
        <div className="flex h-full min-w-0 flex-1 overflow-hidden">
          <div className="relative flex min-w-0 flex-1 flex-col justify-between overflow-hidden pr-14">
            <div className="flex min-w-0 flex-col overflow-hidden">
              <div className="flex h-5 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-base leading-5">
                <span className="max-w-[40%] shrink-0 overflow-hidden text-ellipsis text-[16px] font-medium text-text-100">{card.symbol ?? short(card.mint)}</span>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="min-w-0 max-w-full truncate text-[14px] font-medium text-text-300 hover:text-accent">{card.name}</span>
                </div>
              </div>
              <div className="mt-[6px] flex h-[18px] min-w-0 items-center gap-3 whitespace-nowrap text-[14px] leading-[18px]">
                <p className="shrink-0 overflow-hidden text-ellipsis font-medium text-text-200">
                  <span className="font-medium text-age">{age(card.createdAt, now)}</span>
                </p>
                <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden md:gap-2">
                  {card.devBuySol !== null ? (
                    <div className="group/hold flex items-center gap-[3px] text-[12px] font-medium text-text-100" title={`Dev buy ${sol(card.devBuySol)} SOL at create`}>
                      <span className="text-text-300 group-hover/hold:text-text-100">dev</span>
                      <span>{sol(card.devBuySol)}</span>
                    </div>
                  ) : null}
                  {card.isMayhem ? <span className="rounded-[4px] bg-yellow-100/15 px-1 text-[11px] font-medium text-yellow-100">mayhem</span> : null}
                  {card.migrated ? <span className="rounded-[4px] bg-green-100/15 px-1 text-[11px] font-medium text-green-100">migrated</span> : null}
                </div>
              </div>
              <div className="mt-1 flex flex-row items-center gap-2">
                <div className="inline-flex h-4 shrink-0 items-center gap-[3px] whitespace-nowrap rounded-[16px] bg-xblue/[0.12] py-[2px] pl-[2px] pr-[5px] text-[11px] font-medium leading-3 text-xblue" title="Quote: SOL">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                  <img alt="" width={11} height={11} className="h-[11px] w-[11px] shrink-0 rounded-full border-[0.5px] border-line-200 object-cover" src="/solana.svg" />
                  <span className="whitespace-nowrap">SOL</span>
                </div>
                {!card.migrated && card.progress !== null ? <span className="text-[11px] font-medium tabular-nums text-text-300">bonded {card.progress.toFixed(0)}%</span> : null}
              </div>
            </div>
            {audits.length ? (
              <div className="mt-auto hidden h-6 items-center gap-1 overflow-hidden font-medium lg:flex">
                {audits.map((a) => (
                  <Audit key={a.key} title={a.title} value={a.value} good={a.good}>
                    <span className="text-[10px] uppercase text-text-300">{a.key === "top10" ? "T10" : "DEV"}</span>
                  </Audit>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {audits.length ? (
        <div className="flex h-6 justify-start gap-1 overflow-hidden font-medium lg:hidden">
          {audits.map((a) => (
            <Audit key={a.key} title={a.title} value={a.value} good={a.good}>
              <span className="text-[10px] uppercase text-text-300">{a.key === "top10" ? "T10" : "DEV"}</span>
            </Audit>
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 right-1 top-[14px] z-10 flex w-0 flex-col items-end justify-between font-medium">
        <div className="flex w-max flex-col items-end gap-0.5 leading-5 lg:gap-1.5">
          <div className="flex w-max flex-col items-end gap-0.5 bg-bg-100 pl-1 group-hover/card:bg-hover-100 lg:flex-row lg:justify-end lg:gap-2">
            <div className="order-1 flex items-center justify-end gap-[2px] text-[12px] leading-5 lg:order-2">
              <span className="text-[11px] font-normal text-text-300">MC</span>
              <span className="text-[12px] font-medium tabular-nums text-text-100">{mc}</span>
            </div>
            {card.volumeSol !== null ? (
              <div className="order-2 flex items-center justify-end gap-[2px] text-[12px] leading-5 lg:order-1" title={card.volumeApprox ? "Volume estimated from curve polling" : "Volume from trade events"}>
                <span className="text-[11px] font-normal text-text-300">V</span>
                <span className="text-[12px] font-medium tabular-nums text-text-100">
                  {card.volumeApprox ? "≈" : ""}
                  {sol(card.volumeSol)}
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex h-auto min-h-[18px] w-max items-start justify-end gap-2 bg-bg-100 pl-1 text-[11px] group-hover/card:bg-hover-100 lg:h-[18px] lg:items-center">
            {card.feesSol !== null ? (
              <div className="flex items-center gap-1 text-[11px] font-medium leading-[14px]" title="Total fees">
                <span className="font-normal text-text-300">F</span>
                {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                <img src="/solana.svg" alt="" width={12} height={12} className="h-3 w-3 object-contain" />
                <span className="font-medium text-text-100">{sol(card.feesSol)}</span>
              </div>
            ) : null}
            {card.trades !== null ? (
              <div className="relative flex flex-col items-end leading-[14px] lg:flex-row lg:items-center">
                <div className="flex items-center">
                  <div className="w-[18px] text-text-300">TX</div>
                  <span className="font-mono text-[11px] tabular-nums text-text-100">
                    {card.volumeApprox ? "≈" : ""}
                    {compact(card.trades)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <button type="button" onClick={quickBuy} disabled={busy} className="pointer-events-auto inline-flex h-6 min-w-12 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[6px] bg-input-200 px-1.5 text-[12px] font-semibold text-accent hover:bg-hover-200 disabled:opacity-50" title={canSign ? `Buy ${preset} SOL with the active wallet` : "Unlock the vault and pick an active wallet"}>
          <Zap className="h-3 w-3" />
          Buy
        </button>
      </div>
    </div>
  );
}
