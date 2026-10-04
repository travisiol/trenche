"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FeedCard as Card, JobCreated } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { useSettings, useVault, useWallets } from "@/lib/store";
import { age, compact, pct, short, sol, usd } from "@/lib/format";
import { Button, Capsule, Copy, Progress, TokenImage, cx, toast } from "../ui";

export function FeedCardView({ card, now, preset, hovered, onHover }: { card: Card; now: number; preset: string; hovered: boolean; onHover: (mint: string | null) => void }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const vault = useVault();
  const wallets = useWallets();
  const settings = useSettings();
  const canSign = (vault.data?.unlocked ?? false) && !!wallets.data?.active;

  const quickBuy = async () => {
    const active = wallets.data?.active;
    if (!active) return toast("No active wallet", "err");
    setBusy(true);
    try {
      await post<JobCreated>("/api/trade/buy", { mint: card.mint, wallets: [active], sol: preset, slippageBps: settings.data?.slippageBps ?? 2000 });
      toast(`Buying ${preset} SOL of ${card.symbol ?? short(card.mint)}`, "info");
      setConfirm(false);
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-mint={card.mint}
      onMouseEnter={() => onHover(card.mint)}
      onMouseLeave={() => onHover(null)}
      onClick={() => router.push(`/trade/${card.mint}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/trade/${card.mint}`)}
      className={cx("card p-2.5 flex gap-2.5 cursor-pointer fade-in", hovered ? "!border-accent/60" : "")}
    >
      <TokenImage src={card.image} alt={card.symbol ?? "?"} size={56} className="rounded-xl" />
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-[13px] truncate">{card.symbol ?? short(card.mint)}</span>
          <span className="text-text-3 text-xs truncate">{card.name}</span>
          <span className="ml-auto text-[11px] text-up mono shrink-0">{age(card.createdAt, now)}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <Copy text={card.mint} className="text-text-3">
            {short(card.mint, 4, 4)}
          </Copy>
          {card.isMayhem ? <Capsule tone="warn">mayhem</Capsule> : null}
          {card.migrated ? <Capsule tone="up">migrated</Capsule> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <Capsule k="MC">{card.marketCapUsd !== null ? usd(card.marketCapUsd) : card.marketCapSol !== null ? `${sol(card.marketCapSol)} SOL` : "—"}</Capsule>
          {card.volumeSol !== null ? <Capsule k="V" title={card.volumeApprox ? "approximate (curve deltas every 2 s)" : "real trade events"}>{sol(card.volumeSol)}{card.volumeApprox ? "~" : ""}</Capsule> : null}
          {card.trades !== null ? <Capsule k="TX">{compact(card.trades)}{card.volumeApprox ? "~" : ""}</Capsule> : null}
          {card.feesSol !== null ? <Capsule k="F">{sol(card.feesSol)}</Capsule> : null}
          {card.devBuySol !== null ? <Capsule k="Dev buy">{sol(card.devBuySol)}</Capsule> : null}
        </div>
        {card.progress !== null && !card.migrated ? (
          <div className="flex items-center gap-2">
            <Progress value={card.progress} className="flex-1" />
            <span className="mono text-[10px] text-text-2 w-9 text-right">{card.progress.toFixed(0)} %</span>
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          {card.top10Pct !== null ? <Capsule k="Top 10" tone={card.top10Pct > 30 ? "down" : undefined}>{pct(card.top10Pct)}</Capsule> : null}
          {card.devPct !== null ? <Capsule k="Dev" tone={card.devPct > 10 ? "warn" : undefined}>{pct(card.devPct)}</Capsule> : null}
          {card.bundlePct !== null ? <Capsule k="Bundle">{pct(card.bundlePct)}</Capsule> : null}
          {card.holders !== null ? <Capsule k="H">{card.holders}</Capsule> : null}
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            {confirm ? (
              <span className="flex gap-1">
                <Button size="xs" variant="up" busy={busy} onClick={quickBuy}>
                  Confirm {preset}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>
                  ×
                </Button>
              </span>
            ) : (
              <Button size="xs" variant="primary" disabled={!canSign} onClick={() => setConfirm(true)} title={canSign ? "Quick buy with the active wallet" : "Unlock the vault and pick an active wallet"}>
                ⚡ {preset} SOL
              </Button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
