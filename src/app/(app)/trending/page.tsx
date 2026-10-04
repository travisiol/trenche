"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Button, Capsule, Card, Empty, Loading, Page, PageHeader, Segmented, TokenImage, cx, toast } from "@/components/ui";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useVault, useWallets } from "@/lib/store";
import { age, compact, pct, short, sol, usd } from "@/lib/format";
import { usePresets } from "@/components/trade/TradePanel";
import type { TrendingResponse, TrendingWindow } from "@/lib/types";

const WINDOWS: { value: TrendingWindow; label: string }[] = [
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
];

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
  const approx = rows.some((r) => r.card.volumeApprox);

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
    <Page>
      <PageHeader
        icon={<Icon3D name="trending" size={40} glow />}
        title="Trending"
        description="Tokens ranked by momentum over a time window, from the curves this server has been watching."
        actions={<Segmented size="md" value={win} onChange={setWin} options={WINDOWS} />}
      />
      <Card
        title={`Top ${rows.length || ""} over ${WINDOWS.find((w) => w.value === win)?.label}`}
        description={q.data ? `Refreshed ${age(q.data.at)} ago${approx ? " · volume and trades are estimated from curve polling" : ""}` : "Loading…"}
        flush
        className="flex-1"
      >
        {q.error ? (
          <ApiError error={q.error} retry={q.refresh} />
        ) : q.loading && !q.data ? (
          <Loading>Ranking…</Loading>
        ) : !rows.length ? (
          <Empty icon={<Icon3D name="trending" size={48} />} title="Nothing ranked yet">
            Trending is computed from the feed&apos;s own curve samples since this server started. Open Trenches to warm it up, then come back.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  <th className="w-10">#</th>
                  <th>Token</th>
                  <th className="r">Market cap</th>
                  <th className="r">Volume</th>
                  <th className="r">Trades</th>
                  <th className="r">Change</th>
                  <th className="r">Bonded</th>
                  <th className="r">Age</th>
                  <th className="r" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = r.card;
                  const a = c.volumeApprox ? "≈ " : "";
                  return (
                    <tr key={c.mint} className="hover:bg-white/[0.02]">
                      <td className="mono text-text-3">{i + 1}</td>
                      <td>
                        <Link href={`/trade/${c.mint}`} className="flex items-center gap-3 min-w-0">
                          <TokenImage src={c.image} alt={c.symbol ?? "?"} size={36} />
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {c.symbol ?? short(c.mint)} <span className="text-text-3 font-normal">{c.name}</span>
                            </div>
                            <div className="mono text-[13px] text-text-3">
                              {short(c.mint, 4, 4)}
                              {r.coverageSec < 60 ? ` · only ${r.coverageSec} s of data` : ""}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="r">{c.marketCapUsd !== null ? usd(c.marketCapUsd) : c.marketCapSol !== null ? `${sol(c.marketCapSol)} SOL` : "—"}</td>
                      <td className="r">
                        {a}
                        {sol(r.volumeSol)} SOL
                      </td>
                      <td className="r">
                        {a}
                        {compact(r.trades)}
                      </td>
                      <td className={cx("r", r.mcChangePct === null ? "text-text-3" : r.mcChangePct > 0 ? "text-up" : r.mcChangePct < 0 ? "text-down" : "")}>{r.mcChangePct === null ? "—" : `${r.mcChangePct > 0 ? "+" : ""}${r.mcChangePct.toFixed(1)} %`}</td>
                      <td className="r">{c.migrated ? <Capsule tone="up">Migrated</Capsule> : <span className="text-text-2">{pct(c.progress)}</span>}</td>
                      <td className="r text-text-3">{age(c.createdAt)}</td>
                      <td className="r">
                        <Button size="sm" variant="primary" icon="zap" busy={busy === c.mint} disabled={!canSign} onClick={() => buy(c.mint, c.symbol)} title={canSign ? `Buy ${presets[0]} SOL with the active wallet` : "Unlock the vault and pick an active wallet"}>
                          Buy {presets[0]} SOL
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
