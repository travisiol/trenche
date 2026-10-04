"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FeedCard as Card, JobCreated } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { useSettings, useVault, useWallets } from "@/lib/store";
import { age, compact, pct, short, sol, usd } from "@/lib/format";
import { Button, Capsule, Copy, KV, Progress, TokenImage, cx, toast } from "../ui";
import { Icon } from "../icons";

/** Calm card: image · symbol + name · age, then two rows of labelled stats, one quick-buy button. */
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

  const approx = card.volumeApprox ? "≈ " : "";
  return (
    <div
      role="button"
      tabIndex={0}
      data-mint={card.mint}
      onMouseEnter={() => onHover(card.mint)}
      onMouseLeave={() => onHover(null)}
      onClick={() => router.push(`/trade/${card.mint}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/trade/${card.mint}`)}
      className={cx("card p-3 flex flex-col gap-3 cursor-pointer fade-in", hovered ? "!border-accent/60" : "")}
    >
      <div className="flex items-center gap-3 min-w-0">
        <TokenImage src={card.image} alt={card.symbol ?? "?"} size={48} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm truncate">{card.symbol ?? short(card.mint)}</span>
            <span className="text-text-3 text-sm truncate">{card.name}</span>
          </div>
          <div className="flex items-center gap-2 text-[13px] mt-0.5">
            <span className="text-up mono">{age(card.createdAt, now)}</span>
            <Copy text={card.mint} className="text-text-3">
              {short(card.mint, 4, 4)}
            </Copy>
            {card.isMayhem ? <Capsule tone="warn">mayhem</Capsule> : null}
            {card.migrated ? <Capsule tone="up">Migrated</Capsule> : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <KV label="Market cap" value={card.marketCapUsd !== null ? usd(card.marketCapUsd) : card.marketCapSol !== null ? `${sol(card.marketCapSol)} SOL` : "—"} />
        <KV label="Volume" value={card.volumeSol !== null ? `${approx}${sol(card.volumeSol)} SOL` : "—"} />
        <KV label="Trades" value={card.trades !== null ? `${approx}${compact(card.trades)}` : "—"} />
      </div>
      {card.progress !== null && !card.migrated ? (
        <div className="flex items-center gap-2">
          <span className="label w-14 shrink-0">Bonded</span>
          <Progress value={card.progress} className="flex-1" />
          <span className="mono text-[13px] text-text-2 w-12 text-right">{card.progress.toFixed(0)} %</span>
        </div>
      ) : null}
      {card.top10Pct !== null || card.devPct !== null || card.devBuySol !== null || card.feesSol !== null || card.holders !== null ? (
        <div className="grid grid-cols-3 gap-2">
          {card.devBuySol !== null ? <KV label="Dev buy" value={`${sol(card.devBuySol)} SOL`} /> : null}
          {card.devPct !== null ? <KV label="Dev holds" value={pct(card.devPct)} tone={card.devPct > 10 ? "warn" : undefined} /> : null}
          {card.top10Pct !== null ? <KV label="Top 10 hold" value={pct(card.top10Pct)} tone={card.top10Pct > 30 ? "down" : undefined} /> : null}
          {card.feesSol !== null ? <KV label="Creator fees" value={`${sol(card.feesSol)} SOL`} /> : null}
          {card.holders !== null ? <KV label="Holders" value={String(card.holders)} /> : null}
          {card.bundlePct !== null ? <KV label="Bundled" value={pct(card.bundlePct)} /> : null}
        </div>
      ) : null}

      <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
        {confirm ? (
          <span className="flex gap-1.5">
            <Button size="sm" variant="up" busy={busy} onClick={quickBuy} icon="zap">
              Confirm {preset} SOL
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} aria-label="Cancel">
              <Icon name="x" size={14} />
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="primary" disabled={!canSign} onClick={() => setConfirm(true)} icon="zap" title={canSign ? "Quick buy with the active wallet" : "Unlock the vault and pick an active wallet"}>
            Buy {preset} SOL
          </Button>
        )}
      </div>
    </div>
  );
}
