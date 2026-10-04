"use client";
import { use, useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Capsule, Panel, Segmented, Spinner, Tabs, cx } from "@/components/ui";
import { CandleChart } from "@/components/trade/Chart";
import { TradePanel } from "@/components/trade/TradePanel";
import { DevRoom, TokenHeader } from "@/components/dev/DevRoom";
import { useGet, useSSE } from "@/lib/api";
import { useWallets } from "@/lib/store";
import { age, pct, short, sol, solscanAccount, solscanTx, time } from "@/lib/format";
import type { Candle, CandleTf, FeedTrade, TokenCandlesResponse, TokenHoldersResponse, TokenInfo, TokenTradesResponse } from "@/lib/ui-types";

const TF: CandleTf[] = ["1s", "15s", "1m"];
const TF_SEC: Record<CandleTf, number> = { "1s": 1, "15s": 15, "1m": 60 };

export default function TradePage({ params }: PageProps<"/trade/[mint]">) {
  const { mint } = use(params);
  const token = useGet<TokenInfo>(`/api/token/${mint}`, 2000);
  const [tf, setTf] = useState<CandleTf>("15s");
  const candles = useGet<TokenCandlesResponse>(`/api/token/${mint}/candles?tf=${tf}`, 5000);
  const [tab, setTab] = useState<"trades" | "holders" | "positions">("trades");
  const [liveTrades, setLiveTrades] = useState<FeedTrade[]>([]);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const wallets = useWallets();
  const mine = new Set((wallets.data?.wallets ?? []).map((w) => w.address));

  // live trades from the feed stream (only real PumpPortal trade events carry this mint reliably)
  useSSE("/api/feed/stream", {
    trade: (d) => {
      const t = d as FeedTrade;
      if (t.mint !== mint) return;
      setLiveTrades((l) => [t, ...l].slice(0, 200));
      if (t.marketCapSol === null) return;
      const price = t.tokenAmount ? t.solAmount / t.tokenAmount : null;
      if (!price) return;
      const bucket = Math.floor(t.at / 1000 / TF_SEC[tf]) * TF_SEC[tf];
      setLiveCandle((c) =>
        c && c.time === bucket
          ? { ...c, high: Math.max(c.high, price), low: Math.min(c.low, price), close: price, volume: c.volume + t.solAmount }
          : { time: bucket, open: c?.close ?? price, high: price, low: price, close: price, volume: t.solAmount },
      );
    },
  });

  const t = token.data;
  return (
    <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 p-4 min-h-0">
      <div className="flex flex-col gap-4 min-w-0">
        <Panel bodyClassName="p-4">
          <TokenHeader mint={mint} token={t} error={token.error} retry={token.refresh} />
        </Panel>

        <Panel glow bodyClassName="p-0">
          <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
            <Icon3D name="trending" size={18} />
            <span className="text-xs font-semibold">{t?.symbol ?? short(mint)} / SOL</span>
            <span className="ml-auto flex items-center gap-2">
              {candles.data ? <span className="mono text-[11px] text-text-3">{candles.data.trades} trades</span> : null}
              <Segmented size="xs" value={tf} onChange={setTf} options={TF.map((x) => ({ value: x, label: x }))} />
            </span>
          </div>
          {candles.error ? (
            <ApiError error={candles.error} retry={candles.refresh} />
          ) : candles.loading && !candles.data ? (
            <div className="h-[380px] flex items-center justify-center text-text-3">
              <Spinner />
            </div>
          ) : !candles.data?.candles.length ? (
            <div className="h-[380px] flex flex-col items-center justify-center text-text-3 text-xs gap-1">
              <span className="font-medium text-text-2">No trade yet on the curve</span>
              <span>Candles are built from the bonding-curve history as soon as a trade lands.</span>
            </div>
          ) : (
            <CandleChart candles={candles.data.candles} live={liveCandle} unitLabel="SOL per token" />
          )}
        </Panel>

        <Panel bodyClassName="p-0 flex flex-col min-h-[280px]">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "trades", label: "Trades" }, { value: "holders", label: "Holders" }, { value: "positions", label: "Positions" }]} />
          <div className="flex-1 overflow-y-auto">
            {tab === "trades" ? <TradesTab mint={mint} live={liveTrades} mine={mine} /> : tab === "holders" ? <HoldersTab mint={mint} mine={mine} /> : <div className="p-3"><DevRoom mint={mint} embedded /></div>}
          </div>
        </Panel>
      </div>

      <Panel glow title="Trade" icon={<Icon3D name="buy" size={22} />} bodyClassName="p-4" className="xl:sticky xl:top-[72px] self-start">
        <TradePanel mint={mint} symbol={t?.symbol ?? null} />
      </Panel>
    </div>
  );
}

function TradesTab({ mint, live, mine }: { mint: string; live: FeedTrade[]; mine: Set<string> }) {
  const q = useGet<TokenTradesResponse>(`/api/token/${mint}/trades?limit=100`, 5000);
  if (q.error) return <ApiError error={q.error} retry={q.refresh} />;
  if (q.loading && !q.data)
    return (
      <div className="flex items-center gap-2 text-xs text-text-3 p-4">
        <Spinner size={14} /> Reading curve history…
      </div>
    );
  const rows = q.data?.trades ?? [];
  return (
    <table className="w-full text-xs">
      <thead className="label text-left">
        <tr className="border-b border-line">
          <th className="font-medium px-3 py-2">Time</th>
          <th className="font-medium px-3 py-2">Side</th>
          <th className="font-medium px-3 py-2 text-right">SOL</th>
          <th className="font-medium px-3 py-2 text-right">Price</th>
          <th className="font-medium px-3 py-2">Wallet</th>
          <th className="font-medium px-3 py-2 text-right">Tx</th>
        </tr>
      </thead>
      <tbody>
        {live.map((t, i) => (
          <tr key={`l${i}`} className={cx("h-9 border-b border-line/60", t.side === "buy" ? "flash-up" : "flash-down")}>
            <td className="px-3 mono text-text-3">{time(t.at)}</td>
            <td className={cx("px-3 font-medium", t.side === "buy" ? "text-up" : "text-down")}>{t.side}</td>
            <td className="px-3 text-right mono">{sol(t.solAmount)}</td>
            <td className="px-3 text-right mono text-text-3">{t.tokenAmount ? (t.solAmount / t.tokenAmount).toExponential(2) : "—"}</td>
            <td className="px-3 mono">{t.trader ? <span className={mine.has(t.trader) ? "text-accent" : ""}>{short(t.trader)}</span> : "—"}</td>
            <td className="px-3 text-right">{t.signature ? <a href={solscanTx(t.signature)} target="_blank" rel="noreferrer" className="text-accent hover:underline mono">{short(t.signature)}</a> : <span className="text-text-3">live</span>}</td>
          </tr>
        ))}
        {rows.map((t) => (
          <tr key={t.signature} className="h-9 border-b border-line/60 hover:bg-white/[0.02]">
            <td className="px-3 mono text-text-3">{time(t.blockTime * 1000)}</td>
            <td className={cx("px-3 font-medium", t.side === "buy" ? "text-up" : "text-down")}>{t.side}</td>
            <td className="px-3 text-right mono">{sol(t.solAmount)}</td>
            <td className="px-3 text-right mono text-text-3">{Number(t.priceSol).toExponential(2)}</td>
            <td className="px-3 mono">
              <a href={solscanAccount(t.wallet)} target="_blank" rel="noreferrer" className={cx("hover:text-accent", mine.has(t.wallet) ? "text-accent" : "")}>
                {short(t.wallet)}
              </a>
            </td>
            <td className="px-3 text-right">
              <a href={solscanTx(t.signature)} target="_blank" rel="noreferrer" className="text-accent hover:underline mono">
                {short(t.signature)}
              </a>
            </td>
          </tr>
        ))}
        {!rows.length && !live.length ? (
          <tr>
            <td colSpan={6} className="p-4 text-text-3 text-center">
              No trade on this curve yet.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function HoldersTab({ mint, mine }: { mint: string; mine: Set<string> }) {
  const q = useGet<TokenHoldersResponse>(`/api/token/${mint}/holders`, 10000);
  if (q.error) return <ApiError error={q.error} retry={q.refresh} />;
  if (q.loading && !q.data)
    return (
      <div className="flex items-center gap-2 text-xs text-text-3 p-4">
        <Spinner size={14} /> getTokenLargestAccounts…
      </div>
    );
  const rows = q.data?.holders ?? [];
  return (
    <div>
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line text-[11px] text-text-3">
        <Capsule k="Top 10">{pct(q.data?.top10Pct, 1)}</Capsule>
        <Capsule k="Dev">{pct(q.data?.devPct, 1)}</Capsule>
        <span className="ml-auto mono">{rows.length} accounts</span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((h, i) => (
            <tr key={h.account} className="h-9 border-b border-line/60 hover:bg-white/[0.02]">
              <td className="px-3 mono text-text-3 w-8">{i + 1}</td>
              <td className="px-3 mono">
                <a href={solscanAccount(h.owner ?? h.account)} target="_blank" rel="noreferrer" className={cx("hover:text-accent", h.owner && mine.has(h.owner) ? "text-accent" : "")}>
                  {short(h.owner ?? h.account, 6, 6)}
                </a>
                {h.isCurve ? <Capsule tone="accent" className="ml-2">curve</Capsule> : null}
                {h.isDev ? <Capsule tone="warn" className="ml-2">dev</Capsule> : null}
                {h.owner && mine.has(h.owner) ? <Capsule tone="up" className="ml-2">mine</Capsule> : null}
              </td>
              <td className="px-3 text-right mono">{sol(Number(h.amount) / 1e6, 0)}</td>
              <td className="px-3 text-right mono text-text-2 w-20">{pct(h.pct, 2)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td className="p-4 text-text-3 text-center">No holder found.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[10px] text-text-3">Top 20 accounts from the RPC; {age(q.at)} ago.</p>
    </div>
  );
}
