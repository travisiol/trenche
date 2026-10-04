"use client";
import Link from "next/link";
import { useState } from "react";
import type { ActivityResponse, JobCreated, Position, PositionsResponse } from "@/lib/types";
import { post, failureMessage, useGet } from "@/lib/api";
import { groupPositions } from "@/lib/positions";
import { useSettings } from "@/lib/store";
import { dateTime, pct, short, signedSol, sol, solscanTx } from "@/lib/format";
import { ApiError, Button, Empty, Spinner, TokenImage, cx, toast } from "../ui";
import { Icon3D } from "../Icon3D";

export function usePositions(wallets: string[] | null, intervalMs = 10000) {
  const q = wallets && wallets.length ? `/api/positions?wallets=${wallets.join(",")}` : null;
  return useGet<PositionsResponse>(q, intervalMs);
}

export function SellButtons({ p, wallets, size = "xs" }: { p: Position; wallets?: string[]; size?: "xs" | "sm" }) {
  const settings = useSettings();
  const [busy, setBusy] = useState<number | null>(null);
  const sell = async (percent: number) => {
    setBusy(percent);
    try {
      const addrs = wallets ?? p.wallets.map((w) => w.address);
      await post<JobCreated>("/api/trade/sell", { mint: p.mint, wallets: addrs, percent, slippageBps: settings.data?.slippageBps ?? 2000 });
      toast(`Selling ${percent} % of ${p.symbol ?? short(p.mint)} on ${addrs.length} wallet(s)`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex gap-1">
      {[50, 100].map((n) => (
        <Button key={n} size={size} variant="down" busy={busy === n} onClick={() => sell(n)} className="!bg-down-soft !text-down border border-down/30 hover:!bg-down/25">
          Sell {n} %
        </Button>
      ))}
    </div>
  );
}

export function Holdings({ wallets }: { wallets: string[] }) {
  const pos = usePositions(wallets);
  const rows = groupPositions(pos.data).filter((p) => Number(p.amount) > 0);
  return (
    <div className="flex flex-col min-h-0">
      {pos.error ? <ApiError error={pos.error} retry={pos.refresh} compact /> : null}
      {pos.loading && !pos.data ? (
        <div className="flex items-center gap-2 text-xs text-text-3 p-4">
          <Spinner size={14} /> Reading token accounts…
        </div>
      ) : !rows.length && !pos.error ? (
        <Empty icon={<Icon3D name="buy" size={44} />} title="No holdings">
          Tokens bought from Trenches, Trade or a launch show up here with their value and PnL.
        </Empty>
      ) : (
        <table className="w-full text-xs">
          <thead className="label text-left">
            <tr className="border-b border-line">
              <th className="font-medium px-3 py-2">Token</th>
              <th className="font-medium px-3 py-2 text-right">Amount</th>
              <th className="font-medium px-3 py-2 text-right">Value</th>
              <th className="font-medium px-3 py-2 text-right">PnL</th>
              <th className="font-medium px-3 py-2 text-right">Supply</th>
              <th className="font-medium px-3 py-2 text-right">Bonded</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const pnl = Number(p.pnlSol);
              return (
                <tr key={p.mint} className="row border-b border-line/60 hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5">
                    <Link href={`/trade/${p.mint}`} className="flex items-center gap-2.5 min-w-0">
                      <TokenImage src={p.image} alt={p.symbol ?? "?"} size={28} />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{p.symbol ?? short(p.mint)}</div>
                        <div className="text-[11px] text-text-3 truncate">{p.name ?? ""} · {p.wallets.length} wallet{p.wallets.length > 1 ? "s" : ""}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 text-right mono">{sol(p.amount, 0)}</td>
                  <td className="px-3 text-right mono">{sol(p.valueSol)} SOL</td>
                  <td className={cx("px-3 text-right mono", pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "")}>{signedSol(p.pnlSol)}</td>
                  <td className="px-3 text-right mono text-text-2">{pct(p.supplyPct, 2)}</td>
                  <td className="px-3 text-right mono text-text-2">{p.onCurve ? pct(p.progress) : "Migrated"}</td>
                  <td className="px-3 text-right">
                    <SellButtons p={p} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Activity({ limit = 50, mint }: { limit?: number; mint?: string }) {
  const act = useGet<ActivityResponse>(`/api/activity?limit=${mint ? 500 : limit}`, 5000);
  const items = (act.data?.items ?? []).filter((a) => !mint || a.mint === mint).slice(0, limit);
  return (
    <div className="flex flex-col min-h-0">
      {act.error ? <ApiError error={act.error} retry={act.refresh} compact /> : null}
      {act.loading && !act.data ? (
        <div className="flex items-center gap-2 text-xs text-text-3 p-4">
          <Spinner size={14} /> Loading journal…
        </div>
      ) : !items.length && !act.error ? (
        <Empty title="Nothing yet">Every send, buy, sell, launch and claim is journaled here with its signature.</Empty>
      ) : (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 h-10 border-b border-line/60 text-xs">
              <span className={cx("w-1.5 h-1.5 rounded-full shrink-0", a.ok ? "bg-up" : "bg-down")} />
              <span className="label w-20 shrink-0 truncate">{a.kind}</span>
              <span className="truncate text-text-2">{a.message}</span>
              {a.mint ? (
                <Link href={`/trade/${a.mint}`} className="mono text-text-3 hover:text-accent">
                  {short(a.mint)}
                </Link>
              ) : null}
              <span className="ml-auto flex items-center gap-3 shrink-0">
                {a.signature ? (
                  <a href={solscanTx(a.signature)} target="_blank" rel="noreferrer" className="mono text-accent hover:underline">
                    {short(a.signature)}
                  </a>
                ) : null}
                <span className="mono text-text-3">{dateTime(a.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
