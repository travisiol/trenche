"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Button, Capsule, Empty, Panel, Segmented, Spinner, TokenImage, cx, toast } from "@/components/ui";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useVault, useWallets } from "@/lib/store";
import { age, compact, pct, short, sol, usd } from "@/lib/format";
import { usePresets } from "@/components/trade/TradePanel";
import type { TrendingResponse, TrendingWindow } from "@/lib/ui-types";

const WINDOWS: TrendingWindow[] = ["1m", "5m", "1h", "6h", "24h"];

export default function TrendingPage() {
  const [win, setWin] = useState<TrendingWindow>("5m");
  const q = useGet<TrendingResponse>(`/api/trending?window=${win}`, 5000);
  const vault = useVault();
  const wallets = useWallets();
  const settings = useSettings();
  const presets = usePresets();
  const [busy, setBusy] = useState<string | null>(null);
  const canSign = (vault.data?.unlocked ?? false) && !!wallets.data?.active;
  const rows = q.data?.entries ?? [];

  const buy = async (mint: string, symbol: string | null) => {
    setBusy(mint);
    try {
      await post("/api/trade/buy", { mint, wallets: [wallets.data!.active!], sol: presets[0], slippageBps: settings.data?.slippageBps ?? 2000 });
      toast(`Buying ${presets[0]} SOL of ${symbol ?? short(mint)}`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex-1 p-4 min-h-0 flex flex-col">
      <Panel
        title="Trending"
        icon={<Icon3D name="trending" size={22} />}
        actions={
          <>
            {q.data ? <span className="text-[11px] text-text-3 mono hidden sm:inline">{rows.length} ranked · {age(q.data.at)} ago</span> : null}
            <Segmented value={win} onChange={setWin} options={WINDOWS.map((w) => ({ value: w, label: w }))} />
          </>
        }
        bodyClassName="p-0 flex-1 overflow-auto"
        className="flex-1"
      >
        {q.error ? (
          <ApiError error={q.error} retry={q.refresh} />
        ) : q.loading && !q.data ? (
          <div className="flex items-center gap-2 text-xs text-text-3 p-4">
            <Spinner size={14} /> Ranking…
          </div>
        ) : !rows.length ? (
          <Empty icon={<Icon3D name="trending" size={44} />} title="Nothing ranked yet">
            Trending is computed from the feed&apos;s own curve samples since this server started. Open Trenches to warm it up, then come back.
          </Empty>
        ) : (
          <table className="w-full text-xs">
            <thead className="label text-left sticky top-0 bg-panel">
              <tr className="border-b border-line">
                <th className="font-medium px-3 py-2 w-8">#</th>
                <th className="font-medium px-3 py-2">Token</th>
                <th className="font-medium px-3 py-2 text-right">Market cap</th>
                <th className="font-medium px-3 py-2 text-right">Volume</th>
                <th className="font-medium px-3 py-2 text-right">Trades</th>
                <th className="font-medium px-3 py-2 text-right">Change</th>
                <th className="font-medium px-3 py-2 text-right">Bonded</th>
                <th className="font-medium px-3 py-2 text-right">Age</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const c = r.card;
                return (
                  <tr key={c.mint} className="row border-b border-line/60 hover:bg-white/[0.02]">
                    <td className="px-3 mono text-text-3">{i + 1}</td>
                    <td className="px-3 py-1.5">
                      <Link href={`/trade/${c.mint}`} className="flex items-center gap-2.5 min-w-0">
                        <TokenImage src={c.image} alt={c.symbol ?? "?"} size={32} />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            {c.symbol ?? short(c.mint)} <span className="text-text-3 font-normal">{c.name}</span>
                          </div>
                          <div className="mono text-[10px] text-text-3">{short(c.mint, 4, 4)}{r.coverageSec < 60 ? ` · ${r.coverageSec}s of data` : ""}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 text-right mono">{c.marketCapUsd !== null ? usd(c.marketCapUsd) : c.marketCapSol !== null ? `${sol(c.marketCapSol)} SOL` : "—"}</td>
                    <td className="px-3 text-right mono">{sol(r.volumeSol)} SOL{c.volumeApprox ? <span className="text-text-3" title="approximate (curve deltas)">~</span> : null}</td>
                    <td className="px-3 text-right mono">{compact(r.trades)}</td>
                    <td className={cx("px-3 text-right mono", r.mcChangePct === null ? "text-text-3" : r.mcChangePct > 0 ? "text-up" : r.mcChangePct < 0 ? "text-down" : "")}>{r.mcChangePct === null ? "—" : `${r.mcChangePct > 0 ? "+" : ""}${r.mcChangePct.toFixed(1)} %`}</td>
                    <td className="px-3 text-right">{c.migrated ? <Capsule tone="up">Migrated</Capsule> : <span className="mono text-text-2">{pct(c.progress)}</span>}</td>
                    <td className="px-3 text-right mono text-text-3">{age(c.createdAt)}</td>
                    <td className="px-3 text-right">
                      <Button size="xs" variant="primary" busy={busy === c.mint} disabled={!canSign} onClick={() => buy(c.mint, c.symbol)} title={canSign ? `Buy ${presets[0]} SOL with the active wallet` : "Unlock the vault and pick an active wallet"}>
                        ⚡ {presets[0]}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
