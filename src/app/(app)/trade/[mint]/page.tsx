"use client";
import { use, useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Card, KV, Loading, Page, Segmented, Spinner, Tabs, cx } from "@/components/ui";
import { CandleChart } from "@/components/trade/Chart";
import { TradePanel } from "@/components/trade/TradePanel";
import { DevRoom, TokenHeader } from "@/components/dev/DevRoom";
import { useGet, useSSE } from "@/lib/api";
import { useWallets } from "@/lib/store";
import { groupPositions } from "@/lib/positions";
import { age, pct, short, sol, solscanAccount, solscanTx, time } from "@/lib/format";
import type { Candle, CandleTf, FeedTrade, PositionsResponse, TokenCandlesResponse, TokenHoldersResponse, TokenInfo, TokenTradesResponse } from "@/lib/types";

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
  const positions = useGet<PositionsResponse>(`/api/positions?mints=${mint}`, 5000);
  const myValue = groupPositions(positions.data).find((p) => p.mint === mint)?.valueSol;

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
    <Page>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {/* header */}
          <Card>
            <TokenHeader mint={mint} token={t} error={token.error} retry={token.refresh} />
          </Card>

          {/* chart */}
          <Card
            glow
            title={`${t?.symbol ?? short(mint)} / SOL`}
            description={candles.data ? `${candles.data.trades} trades on the curve · price in SOL per token` : "Price in SOL per token, built from the bonding-curve history."}
            icon={<Icon3D name="trending" size={24} />}
            actions={<Segmented size="xs" value={tf} onChange={setTf} options={TF.map((x) => ({ value: x, label: x }))} />}
            flush
          >
            {candles.error ? (
              <ApiError error={candles.error} retry={candles.refresh} />
            ) : candles.loading && !candles.data ? (
              <div className="h-[380px] flex items-center justify-center text-text-3">
                <Spinner />
              </div>
            ) : !candles.data?.candles.length ? (
              <div className="h-[380px] flex flex-col items-center justify-center text-center gap-1 px-6">
                <span className="text-[15px] font-semibold">No trade yet on the curve</span>
                <span className="text-sm text-text-2">Candles appear as soon as the first trade lands.</span>
              </div>
            ) : (
              <CandleChart candles={candles.data.candles} live={liveCandle} />
            )}
          </Card>

          {/* tabs */}
          <Card flush className="min-h-[320px]">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: "trades", label: "Trades" }, { value: "holders", label: "Holders" }, { value: "positions", label: "My positions" }]} />
            <div className="flex-1 overflow-auto">
              {tab === "trades" ? (
                <TradesTab mint={mint} live={liveTrades} mine={mine} />
              ) : tab === "holders" ? (
                <HoldersTab mint={mint} mine={mine} />
              ) : (
                <div className="p-4">
                  <DevRoom mint={mint} embedded />
                </div>
              )}
            </div>
          </Card>
        </div>

        <Card glow title={side(t)} description="One click per wallet. Nothing is sent before you press the big button." icon={<Icon3D name="buy" size={24} />} className="xl:sticky xl:top-[72px]">
          <TradePanel mint={mint} symbol={t?.symbol ?? null} valueSol={myValue !== undefined ? Number(myValue) : undefined} />
        </Card>
      </div>
    </Page>
  );
}

function side(t: TokenInfo | null) {
  return t?.symbol ? `Trade ${t.symbol}` : "Trade";
}

function TradesTab({ mint, live, mine }: { mint: string; live: FeedTrade[]; mine: Set<string> }) {
  const q = useGet<TokenTradesResponse>(`/api/token/${mint}/trades?limit=100`, 5000);
  if (q.error) return <ApiError error={q.error} retry={q.refresh} />;
  if (q.loading && !q.data) return <Loading>Reading the curve history…</Loading>;
  const rows = q.data?.trades ?? [];
  return (
    <table className="table w-full text-sm">
      <thead>
        <tr>
          <th>Time</th>
          <th>Side</th>
          <th className="r">SOL</th>
          <th className="r">Price</th>
          <th>Wallet</th>
          <th className="r">Transaction</th>
        </tr>
      </thead>
      <tbody>
        {live.map((t, i) => (
          <tr key={`l${i}`} className={cx(t.side === "buy" ? "flash-up" : "flash-down")}>
            <td className="mono text-text-3">{time(t.at)}</td>
            <td className={cx("font-medium", t.side === "buy" ? "text-up" : "text-down")}>{t.side === "buy" ? "Buy" : "Sell"}</td>
            <td className="r">{sol(t.solAmount)}</td>
            <td className="r text-text-3">{t.tokenAmount ? (t.solAmount / t.tokenAmount).toExponential(2) : "—"}</td>
            <td className="mono">{t.trader ? <span className={mine.has(t.trader) ? "text-accent" : ""}>{short(t.trader)}</span> : "—"}</td>
            <td className="r">
              {t.signature ? (
                <a href={solscanTx(t.signature)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {short(t.signature)} ↗
                </a>
              ) : (
                <span className="text-text-3">live</span>
              )}
            </td>
          </tr>
        ))}
        {rows.map((t) => (
          <tr key={t.signature} className="hover:bg-white/[0.02]">
            <td className="mono text-text-3">{time(t.blockTime * 1000)}</td>
            <td className={cx("font-medium", t.side === "buy" ? "text-up" : "text-down")}>{t.side === "buy" ? "Buy" : "Sell"}</td>
            <td className="r">{sol(t.solAmount)}</td>
            <td className="r text-text-3">{Number(t.priceSol).toExponential(2)}</td>
            <td className="mono">
              <a href={solscanAccount(t.wallet)} target="_blank" rel="noreferrer" className={cx("hover:text-accent", mine.has(t.wallet) ? "text-accent" : "")} title={mine.has(t.wallet) ? "One of your wallets" : undefined}>
                {short(t.wallet)}
                {mine.has(t.wallet) ? " (you)" : ""}
              </a>
            </td>
            <td className="r">
              <a href={solscanTx(t.signature)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {short(t.signature)} ↗
              </a>
            </td>
          </tr>
        ))}
        {!rows.length && !live.length ? (
          <tr>
            <td colSpan={6} className="p-6 text-text-2 text-center">
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
  if (q.loading && !q.data) return <Loading>Reading the largest token accounts…</Loading>;
  const rows = q.data?.holders ?? [];
  return (
    <div>
      <div className="flex items-center gap-6 px-4 py-3 border-b border-line">
        <KV label="Top 10 hold" value={pct(q.data?.top10Pct, 1)} />
        <KV label="Dev holds" value={pct(q.data?.devPct, 1)} />
        <span className="ml-auto hint">
          Top {rows.length} accounts from the RPC · {age(q.at)} ago
        </span>
      </div>
      <table className="table w-full text-sm">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Owner</th>
            <th className="r">Tokens</th>
            <th className="r">Supply</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => (
            <tr key={h.account} className="hover:bg-white/[0.02]">
              <td className="mono text-text-3">{i + 1}</td>
              <td className="mono">
                <a href={solscanAccount(h.owner ?? h.account)} target="_blank" rel="noreferrer" className={cx("hover:text-accent", h.owner && mine.has(h.owner) ? "text-accent" : "")}>
                  {short(h.owner ?? h.account, 6, 6)}
                </a>
                {h.isCurve ? <span className="ml-2 text-[13px] text-accent">bonding curve</span> : null}
                {h.isDev ? <span className="ml-2 text-[13px] text-warn">dev</span> : null}
                {h.owner && mine.has(h.owner) ? <span className="ml-2 text-[13px] text-up">you</span> : null}
              </td>
              <td className="r">{sol(Number(h.amount) / 1e6, 0)}</td>
              <td className="r text-text-2">{pct(h.pct, 2)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={4} className="p-6 text-text-2 text-center">
                No holder found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
