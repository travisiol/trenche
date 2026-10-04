"use client";
import Link from "next/link";
import { useState } from "react";
import type { ActivityResponse, JobCreated, Position, PositionsResponse } from "@/lib/types";
import { post, failureMessage, useGet } from "@/lib/api";
import { groupPositions } from "@/lib/positions";
import { useSettings } from "@/lib/store";
import { dateTime, pct, short, signedSol, sol, solscanTx } from "@/lib/format";
import { ApiError, Button, Empty, Loading, TokenImage, cx, toast } from "../ui";
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
      toast(`Selling ${percent} % of ${p.symbol ?? short(p.mint)} on ${addrs.length} wallet${addrs.length !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex gap-1.5 justify-end">
      {[50, 100].map((n) => (
        <Button key={n} size={size} variant="danger" busy={busy === n} onClick={() => sell(n)}>
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
      {pos.error ? (
        <div className="p-3">
          <ApiError error={pos.error} retry={pos.refresh} compact />
        </div>
      ) : null}
      {pos.loading && !pos.data ? (
        <Loading>Reading token accounts…</Loading>
      ) : !rows.length && !pos.error ? (
        <Empty icon={<Icon3D name="buy" size={48} />} title="No holdings">
          Tokens bought from Trenches, Trade or a launch show up here with their value and PnL.
        </Empty>
      ) : (
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>Token</th>
              <th className="r">Amount</th>
              <th className="r">Value</th>
              <th className="r">PnL</th>
              <th className="r">Supply</th>
              <th className="r">Bonded</th>
              <th className="r" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const pnl = Number(p.pnlSol);
              return (
                <tr key={p.mint} className="hover:bg-white/[0.02]">
                  <td>
                    <Link href={`/trade/${p.mint}`} className="flex items-center gap-3 min-w-0">
                      <TokenImage src={p.image} alt={p.symbol ?? "?"} size={32} />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{p.symbol ?? short(p.mint)}</div>
                        <div className="hint truncate">
                          {p.name ?? ""} · {p.wallets.length} wallet{p.wallets.length > 1 ? "s" : ""}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="r">{sol(p.amount, 0)}</td>
                  <td className="r">{sol(p.valueSol)} SOL</td>
                  <td className={cx("r", pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "")}>{signedSol(p.pnlSol)} SOL</td>
                  <td className="r text-text-2">{pct(p.supplyPct, 2)}</td>
                  <td className="r text-text-2">{p.onCurve ? pct(p.progress) : "Migrated"}</td>
                  <td className="r">
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
      {act.error ? (
        <div className="p-3">
          <ApiError error={act.error} retry={act.refresh} compact />
        </div>
      ) : null}
      {act.loading && !act.data ? (
        <Loading>Loading the journal…</Loading>
      ) : !items.length && !act.error ? (
        <Empty title="Nothing yet" compact>
          Every send, buy, sell, launch and claim is journaled here with its signature.
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 min-h-12 py-2 border-b border-line/60 text-sm">
              <span className={cx("w-2 h-2 rounded-full shrink-0", a.ok ? "bg-up" : "bg-down")} />
              <span className="label w-20 shrink-0 truncate">{a.kind}</span>
              <span className="truncate text-text-2 min-w-0 flex-1">{a.message}</span>
              {a.mint ? (
                <Link href={`/trade/${a.mint}`} className="mono text-[13px] text-text-3 hover:text-accent hidden sm:inline">
                  {short(a.mint)}
                </Link>
              ) : null}
              <span className="flex items-center gap-3 shrink-0 text-[13px]">
                {a.signature ? (
                  <a href={solscanTx(a.signature)} target="_blank" rel="noreferrer" className="mono text-accent hover:underline">
                    {short(a.signature)} ↗
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
