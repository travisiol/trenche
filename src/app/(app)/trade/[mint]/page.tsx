"use client";
/** Block X /sol/trading/[mint]: 68px token header · chart (1s…1m, MC/Price) · Trades list · right panel (Buy/Sell, Token info) · Positions/Wallets. */
import { CopyCa } from "@/components/bx/CopyCa";
import { use, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, ExternalLink, Globe, UserRoundCog, UsersRound, Zap } from "lucide-react";
import { type PositionsResponse, type TokenHoldersResponse, type TokenInfo, type TokenTradesResponse, type JobCreated } from "@/lib/types";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useSolPrice, useVault, useWallets } from "@/lib/store";
import { age, pct, short, sol, solscanAccount, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { TxLink, useExplorerSuffix } from "@/components/bx/Job";
import { pushRecent } from "@/components/bx/recent";
import { TokenChart } from "@/components/trade/Chart";
import { InstantTrade, InstantTradeButton, TradePanel } from "@/components/trade/TradePanel";
import { tradeRowStyle } from "@/components/trade/tradeRowStyle";
import { mergePending, trackTradeJob, usePendingTrades, type ListedTrade } from "@/lib/pendingTrades";

const LG = "(min-width: 1024px)";
const subscribeLg = (cb: () => void) => {
  const m = window.matchMedia(LG);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const isLg = () => window.matchMedia(LG).matches;

export default function TradePage({ params }: PageProps<"/trade/[mint]">) {
  const { mint } = use(params);
  // token info 3 s (pump.fun coin row + cached curve read), candles 3 s, positions 15 s (RPC history walk)
  const token = useGet<TokenInfo>(`/api/token/${mint}`, 3000);
  const positions = useGet<PositionsResponse>(`/api/positions?mints=${mint}`, 15000);
  const holders = useGet<TokenHoldersResponse>(`/api/token/${mint}/holders`, 15000);
  const wallets = useWallets();
  const vault = useVault();
  const price = useSolPrice();
  const suffix = useExplorerSuffix();
  const [bottom, setBottom] = useState<"positions" | "wallets">("positions");
  const [infoOpen, setInfoOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [instant, setInstant] = useState(false);
  const t = token.data;
  const c = t?.curve ?? null;
  const solUsd = t?.solPrice ?? price.data?.usd ?? null;
  const rows = (positions.data ?? []).filter((r) => r.mint === mint);
  const walletKey = [...(wallets.data?.wallets ?? []).map((w) => w.address), ...(wallets.data?.history ?? [])].join(",");
  const mine = useMemo(() => new Set(walletKey ? walletKey.split(",") : []), [walletKey]);
  // one chart only (desktop grid or mobile column): two would each poll the candle history
  const lg = useSyncExternalStore(subscribeLg, isLg, () => true);
  const supply = Number(c?.tokenTotalSupply ?? 1e15) / 1e6 || 1e9;

  // recently viewed strip (this machine) + server-side list for the search dialog History
  useEffect(() => {
    if (t) pushRecent({ mint, symbol: t.symbol, name: t.name, image: t.image });
  }, [mint, t]);

  const progress = t?.complete ? 100 : (c?.progress ?? 0);
  // a migrated curve holds no reserves: price / MC / liquidity live on the PumpSwap pool, which this server does not read
  const onCurve = !!c && !c.complete;
  const mcUsd = onCurve ? (c.marketCapUsd ?? (solUsd ? c.marketCapSol * solUsd : null)) : null;
  const priceUsd = onCurve && solUsd ? c.priceSol * solUsd : null;
  // the current pump.fun curve layout keeps realSolReserves at 1 lamport (SOL sits elsewhere): below 0.001 SOL the field is unusable → "—"
  const liqSol = onCurve && Number(c.realSolReserves) >= 1e6 ? Number(c.realSolReserves) / 1e9 : null;
  const r = 23;
  const circ = 2 * Math.PI * r;

  const header = (
    <div className="no-scrollbar flex h-full w-full min-w-0 items-center justify-between gap-5 overflow-x-auto overflow-y-hidden px-2">
      <div className="flex min-w-0 shrink-[2] items-center gap-2.5">
        <div className="relative h-11 w-11 shrink-0 overflow-visible" title={`Bonding curve ${progress.toFixed(1)}%`}>
          <svg className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[50px] w-[50px] -translate-x-1/2 -translate-y-1/2" viewBox="0 0 50 50" aria-hidden>
            <circle cx="25" cy="25" r={r} fill="none" stroke="var(--line-100)" strokeWidth="1.5" />
            <circle cx="25" cy="25" r={r} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray={`${(progress / 100) * circ} ${circ}`} transform="rotate(-90 25 25)" />
          </svg>
          <div className="absolute inset-0 z-[1] flex items-center justify-center">
            <div className="rounded-[7px] p-px" style={{ backgroundColor: "rgba(82, 212, 143, 0.2)" }}>
              <div className="rounded-[6px] bg-bg-100 p-px">
                <div className="relative h-9 w-9 overflow-hidden rounded-[6px]">
                  <div className="pointer-events-none absolute inset-0 z-10 rounded-[6px] border border-white/10" />
                  {t?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- token image
                    <img src={t.image} alt="" className="h-full w-full rounded-[6px] object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-black text-xs font-semibold text-white">{(t?.symbol ?? "?").slice(0, 1)}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <a href={t?.links.pumpfun ?? `https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer" className="absolute -bottom-0.5 -right-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bg-100" style={{ border: "1.5px solid rgb(82, 212, 143)" }} title="Pump.fun">
            {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
            <img src="/launchpads/pumpfun.svg" alt="Pump.fun" className="h-[7px] w-[7px] object-contain" />
          </a>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <div className="flex min-w-0 items-center gap-1">
              <span className="shrink-0 text-xl font-semibold leading-[21px] text-text-100">{t?.symbol ?? short(mint)}</span>
              <span className="max-w-[12ch] truncate text-base font-normal leading-4 text-text-300">{t?.name ?? ""}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1 pl-1">
              <button type="button" onClick={() => navigator.clipboard?.writeText(mint).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1000)))} className="text-text-300 transition-colors hover:text-accent" aria-label="Copy address" title="Copy">
                {copied ? <Check className="h-3.5 w-3.5 text-green-100" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[13px] font-normal text-text-300">
            {t?.createdAt ? <span className="text-age">{age(t.createdAt)}</span> : null}
            <CopyCa ca={mint} />
            {t?.twitter ? (
              <a href={t.twitter} target="_blank" rel="noreferrer" className="flex h-full items-center text-xblue hover:text-text-100" aria-label="Twitter">
                𝕏
              </a>
            ) : null}
            {t?.website ? (
              <a href={t.website} target="_blank" rel="noreferrer" className="flex items-center text-text-200 transition-colors hover:text-accent" aria-label="Website" title="Website">
                <Globe className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <a href={solscanAccount(mint) + suffix} target="_blank" rel="noreferrer" className="text-text-200 transition-colors hover:text-accent" aria-label="Explorer">
              <ExternalLink className="h-[15px] w-[15px]" />
            </a>
            {t?.creator ? (
              <span className="inline-flex items-center gap-0.5 font-medium text-text-300" title={`Creator ${t.creator}`}>
                dev <span className="font-mono text-text-200">{short(t.creator)}</span>
                {mine.has(t.creator) ? <span className="text-green-100">(you)</span> : null}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <div className="no-scrollbar flex items-center gap-4 overflow-x-auto">
          {[
            ["MC", mcUsd !== null ? usd(mcUsd) : onCurve ? `${sol(c.marketCapSol)} SOL` : "—", "text-base font-semibold text-text-100"],
            ["Price", priceUsd !== null ? `${priceUsd < 0.001 ? priceUsd.toExponential(2) : priceUsd.toFixed(6)}` : onCurve ? `${c.priceSol.toExponential(2)} SOL` : "—", "text-sm font-medium leading-[18px] text-text-200"],
            ["Liq", liqSol !== null ? (solUsd ? usd(liqSol * solUsd) : `${sol(liqSol)} SOL`) : "—", "text-sm font-medium leading-[18px] text-yellow-100"],
            ["Bonded", t?.complete ? "Migrated" : c ? `${c.progress.toFixed(1)}%` : "—", "text-sm font-medium leading-[18px] text-text-200"],
          ].map(([k, v, cls]) => (
            <div key={k} className="shrink-0 whitespace-nowrap text-left text-xs leading-4">
              <div className="mb-0.5 text-text-300">{k}</div>
              <div className={cls}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const tradesList = <TradesList mint={mint} mine={mine} supply={supply} solUsd={solUsd} priceSol={c && !c.complete ? c.priceSol : null} />;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-100">
      <div className="h-[68px] shrink-0 border-b border-line-100 lg:hidden">{header}</div>
      <div className="hidden min-h-0 flex-1 gap-px overflow-auto bg-line-100 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[68px_minmax(360px,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_400px_320px] xl:grid-rows-[68px_minmax(360px,1fr)_260px]">
        <div className="min-w-0 bg-bg-100 lg:col-start-1 lg:row-start-1 xl:col-span-1">
          <div className="h-[68px] border-b border-line-100">{header}</div>
        </div>
        <div className="min-h-0 bg-bg-100 lg:col-start-1 lg:row-start-2 xl:col-span-1">
          <section className="h-full min-h-0 overflow-hidden bg-bg-100">
            {lg ? <TokenChart mint={mint} solUsd={solUsd} supplyTokens={supply} mine={mine} creator={t?.creator ?? null} /> : null}
          </section>
        </div>
        <div className="relative min-h-0 bg-bg-100 lg:col-start-1 lg:row-start-3 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <section className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-100">
            <div className="flex h-10 shrink-0 items-center border-b border-line-100 px-2">
              <button type="button" className="relative h-full px-3 text-xs font-medium text-text-100">
                Trades
                <span className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{tradesList}</div>
          </section>
        </div>
        <aside className="min-h-0 bg-bg-100 lg:col-start-2 lg:row-span-3 lg:row-start-1 xl:col-start-3">
          <div className="h-full min-h-0 overflow-y-auto">
            <TradePanel mint={mint} symbol={t?.symbol ?? null} rows={rows} />
            <section className="flex flex-col border-b border-line-100 bg-bg-100">
              <div className="flex h-9 items-center gap-4 px-2">
                <button type="button" onClick={() => setInfoOpen((o) => !o)} className="group flex h-7 items-center gap-1 rounded px-2 text-[13px] font-medium text-text-200 transition-colors hover:bg-white/[0.04] hover:text-text-100">
                  Token Info
                  <ChevronDown className={cx("h-4 w-4 transition-transform duration-150", infoOpen ? "rotate-180" : "")} />
                </button>
              </div>
              {infoOpen ? (
                <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-text-300">Bonding curve</span>
                      <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                        <span className={t?.complete ? "text-increase" : "text-text-200"}>{t?.complete ? "Migrated" : `${progress.toFixed(1)}%`}</span>
                      </div>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-line-100">
                      <div className="h-full rounded-full bg-increase transition-[width] duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Risk icon={<UsersRound className="h-3.5 w-3.5 shrink-0" />} value={holders.data ? pct(holders.data.top10Pct, 1) : holders.error ? "n/a" : "…"} label="Top 10 H." good={(holders.data?.top10Pct ?? 0) <= 30} />
                    <Risk icon={<UserRoundCog className="h-3.5 w-3.5 shrink-0" />} value={holders.data ? pct(holders.data.devPct, 1) : holders.error ? "n/a" : "…"} label="Dev H." good={(holders.data?.devPct ?? 0) <= 10} />
                    <Risk icon={<UsersRound className="h-3.5 w-3.5 shrink-0" />} value={holders.data ? String(holders.data.holders.filter((h) => !h.isCurve && Number(h.amount) > 0).length) : holders.error ? "n/a" : "…"} label="Holders" neutral />
                  </div>
                  <div className="h-px bg-line-100/70" />
                  <div className="grid grid-cols-3 gap-2">
                    <Risk icon={<UserRoundCog className="h-3.5 w-3.5 shrink-0" />} value={rows.length ? pct(rows.reduce((n, r) => n + (r.supplyPct ?? 0), 0), 1) : "0.0%"} label="You H." good />
                  </div>
                  {holders.error ? <p className="text-[10px] text-text-300">Holders need an indexed RPC (Helius key in Settings).</p> : null}
                  <p className="text-[10px] text-text-300">Snipers, insiders, bundlers, phishing, fresh wallets and rug ratio need a wallet-history index this server does not have.</p>
                </div>
              ) : null}
            </section>
            <div className="border-t border-line-100">
              <div className="space-y-1.5 px-3 py-3 text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className="text-text-300">Launchpad</span>
                  <span className="truncate font-mono capitalize text-text-100">pumpfun</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-text-300">{t?.complete ? "Pool" : "Curve"}</span>
                  <span className="max-w-[190px] truncate font-mono text-text-100" title={c?.bondingCurve ?? undefined}>{c?.bondingCurve ?? "—"}</span>
                </div>
                {t?.creator ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-text-300">Creator</span>
                    <span className="max-w-[190px] truncate font-mono text-text-100">{t.creator}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
        <div className="relative min-h-0 bg-bg-100 lg:col-start-1 lg:row-start-4 xl:col-span-2 xl:row-start-3">
          <section className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-100">
            <div className="flex h-10 shrink-0 items-center border-b border-line-100 px-2">
              {(["positions", "wallets"] as const).map((b) => (
                <button key={b} type="button" onClick={() => setBottom(b)} className={cx("relative h-full px-3 text-xs font-medium capitalize transition-colors", bottom === b ? "text-text-100" : "text-text-300 hover:text-text-200")}>
                  {b}
                  {bottom === b ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" /> : null}
                </button>
              ))}
              <Link href={`/launch?open=${mint}`} className="ml-auto flex items-center gap-1 rounded px-2 text-[12px] font-medium text-text-300 hover:text-text-100" title="Open this token in the launch workspace">
                <Zap className="h-3.5 w-3.5" />
                <span>Workspace</span>
              </Link>
              <InstantTradeButton open={instant} onClick={() => setInstant((o) => !o)} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <Positions rows={rows} mint={mint} mode={bottom} />
            </div>
          </section>
        </div>
      </div>
      <InstantTrade mint={mint} symbol={t?.symbol ?? null} rows={rows} open={instant} onClose={() => setInstant(false)} />
      {/* mobile */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="h-[min(210px,34svh)] shrink-0 overflow-hidden border-b border-line-100">{!lg ? <TokenChart mint={mint} solUsd={solUsd} supplyTokens={supply} mine={mine} creator={t?.creator ?? null} /> : null}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TradePanel mint={mint} symbol={t?.symbol ?? null} rows={rows} />
          <div className="h-[320px]">{tradesList}</div>
        </div>
      </div>
    </div>
  );
}

function Risk({ icon, value, label, good, neutral }: { icon: React.ReactNode; value: string; label: string; good?: boolean; neutral?: boolean }) {
  return (
    <div className="flex h-[55px] min-w-0 flex-col items-center justify-start gap-1.5 rounded border border-line-100/70 px-1.5 pb-1.5 pt-1.5">
      <div className={cx("flex min-w-0 items-center gap-1 font-mono text-[13px]", value === "n/a" || value === "…" ? "text-text-300" : neutral ? "text-text-200" : good ? "text-increase" : "text-decrease")}>
        {icon}
        {value}
      </div>
      <div className="truncate text-[10px] leading-4 text-text-300">{label}</div>
    </div>
  );
}

function TradesList({ mint, mine, supply, solUsd, priceSol }: { mint: string; mine: Set<string>; supply: number; solUsd: number | null; priceSol: number | null }) {
  // 2 s while the page is open; the server caches pump.fun's answer so every open client shares one upstream call
  const q = useGet<TokenTradesResponse>(`/api/token/${mint}/trades?limit=100`, 2000);
  const [filter, setFilter] = useState<"all" | "others">("all");
  const [othersUsd, setOthersUsd] = useState(false);
  const [newestFirst, setNewestFirst] = useState(true);
  // our own sent transactions are listed at once (pending → landed → confirmed) until the API returns them
  const pending = usePendingTrades(mint);
  const all = useMemo<ListedTrade[]>(() => mergePending(q.data?.trades ?? [], pending, priceSol), [q.data, pending, priceSol]);
  const others = useMemo(() => {
    const list = all.filter((tr) => !mine.has(tr.wallet));
    const buys = list.filter((tr) => tr.side === "buy");
    const sells = list.filter((tr) => tr.side === "sell");
    const b = buys.reduce((n, tr) => n + Number(tr.solAmount), 0);
    const sl = sells.reduce((n, tr) => n + Number(tr.solAmount), 0);
    return { list, buys: buys.length, sells: sells.length, buySol: b, sellSol: sl, net: b - sl };
  }, [all, mine]);
  const rows = useMemo(() => {
    const list = filter === "others" ? others.list : all;
    return newestFirst ? list : [...list].reverse();
  }, [all, others, filter, newestFirst]);
  const othersVal = othersUsd && solUsd ? usd(others.net * solUsd) : `${others.net >= 0 ? "" : "−"}${sol(Math.abs(others.net))}`;
  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Activity monitor">
      <div className="mb-2 mt-2 flex items-center gap-2 px-2" role="tablist">
        <div className="flex shrink-0 items-center gap-1 pl-0.5">
          <button type="button" role="tab" aria-selected className="px-2 py-1 text-sm font-medium text-text-100">
            Trades
          </button>
        </div>
        <div className="flex flex-nowrap items-center gap-0 bg-btn-secondary p-0.5">
          <button type="button" onClick={() => setFilter("all")} className={cx("cursor-pointer whitespace-nowrap border px-2 py-1 text-xs font-medium leading-none", filter === "all" ? "border-line-200 bg-input-200 text-text-100" : "border-transparent text-text-300 hover:text-text-100")}>
            All
          </button>
          <button type="button" onClick={() => setFilter("others")} className={cx("flex cursor-pointer items-center gap-1 whitespace-nowrap border px-2 py-1 text-xs font-medium leading-none", filter === "others" ? "border-line-200 bg-input-200 text-text-100" : "border-transparent text-text-300 hover:text-text-100")} title={`Others (excl. your wallets): ${others.buys} buys ${sol(others.buySol)} · ${others.sells} sells ${sol(others.sellSol)} · net ${sol(others.net)}`}>
            Others
            <span className={cx("font-mono", others.net > 0 ? "text-increase" : others.net < 0 ? "text-decrease" : "text-text-300")} onClick={(e) => { e.stopPropagation(); setOthersUsd((v) => !v); }} title="Show others value in USD">
              {othersVal}
            </span>
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-8 flex-row items-center px-2 text-sm text-text-300">
          <div className="flex w-[22.5%] items-center gap-1 px-1">
            <span>Total</span>
          </div>
          <div className="flex w-[22.5%] items-center gap-1 px-1">
            <span className="px-0.5 text-sm font-medium">MC</span>
          </div>
          <div className="flex w-[40%] items-center justify-start gap-1 p-1">
            <span className="text-sm font-medium" title="Highlight own wallets as name chip">Trader</span>
          </div>
          <button type="button" onClick={() => setNewestFirst((v) => !v)} className="flex w-[15%] items-center justify-end p-1 hover:text-text-100" title={newestFirst ? "Newest first — click for oldest" : "Oldest first — click for newest"}>
            <span className="text-[13px] leading-4">Age</span>
          </button>
        </div>
        <div className="h-px bg-line-100" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.error ? <p className="px-3 py-6 text-center text-xs text-decrease">{failureMessage(q.error)}</p> : !rows.length ? <p className="px-3 py-6 text-center text-xs text-text-300">{q.loading ? "Reading the curve history…" : filter === "others" ? "No trade from other wallets yet." : "No trade on this curve yet."}</p> : null}
          {rows.map((tr) => {
            const mcSol = Number(tr.priceSol) * supply;
            const own = mine.has(tr.wallet);
            const st = tradeRowStyle(tr.side, own);
            return (
              <div key={`${tr.signature}:${tr.wallet}:${tr.side}`} className="relative py-px">
                <div className={cx("relative flex h-[30px] cursor-pointer flex-row px-2 hover:brightness-125", st.row, tr.pending === "sent" ? "opacity-60" : tr.pending === "failed" ? "line-through opacity-50" : "")}>
                  <div className="relative flex w-[22.5%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                    <div className={cx("flex items-center gap-0.5 text-[13px] font-normal leading-4", st.amount)}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                      <img src="/solana.svg" alt="" width={12} height={12} className="h-3 w-3 shrink-0 object-contain" />
                      <span>{sol(tr.solAmount)}</span>
                    </div>
                  </div>
                  <div className="relative flex w-[22.5%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                    <div className="text-[13px] font-normal text-text-200">{solUsd ? usd(mcSol * solUsd) : `${sol(mcSol)} SOL`}</div>
                  </div>
                  <div className="relative flex w-[40%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                    <div className="flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden text-[13px] font-medium leading-6 text-text-300" title={tr.wallet}>
                      <span className={cx("max-w-[120px] truncate font-medium", own ? "rounded bg-white/[0.06] px-1 text-text-100" : "text-text-200")}>{own ? "you" : tr.wallet.slice(-4)}</span>
                    </div>
                  </div>
                  <div className="relative flex w-[15%] items-center justify-end gap-1 overflow-hidden whitespace-nowrap p-1 leading-none">
                    {tr.pending ? (
                      <span className={cx("text-[11px] font-medium uppercase leading-4", tr.pending === "failed" ? "text-decrease" : tr.pending === "sent" ? "animate-pulse text-text-300" : "text-green-100")} title="Sent from this terminal — the trade API has not listed it yet">
                        {tr.pending}
                      </span>
                    ) : (
                      <span className="text-[13px] leading-4 text-text-300">{age(tr.blockTime * 1000)}</span>
                    )}
                    <TxLink sig={tr.signature} className="text-text-300" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Positions({ rows, mint, mode }: { rows: PositionsResponse; mint: string; mode: "positions" | "wallets" }) {
  const wallets = useWallets();
  const settings = useSettings();
  const vault = useVault();
  const [busy, setBusy] = useState<string | null>(null);
  const held = rows.filter((r) => Number(r.amount) > 0);
  const sell = async (addr: string, percent: number) => {
    setBusy(`${addr}${percent}`);
    try {
      toast(`Selling ${percent}%`, "info");
      const r = await post<JobCreated>("/api/trade/sell", { mint, wallets: [addr], percent, slippageBps: settings.data?.slippageBps ?? 2000 });
      trackTradeJob(r.jobId, { mint, side: "sell", label: `Sell ${percent}%` });
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  if (mode === "wallets") {
    const list = (wallets.data?.wallets ?? []).filter((w) => !w.archived);
    if (!list.length) return <div className="flex h-full min-h-[140px] items-center justify-center px-5 text-sm text-text-300">Create a managed wallet in Portfolio to trade.</div>;
    return (
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg-100 text-[11px] text-text-300">
          <tr className="border-b border-line-50">
            <th className="px-3 py-2 text-left font-normal">Wallet</th>
            <th className="px-2 py-2 text-right font-normal">SOL</th>
            <th className="px-2 py-2 text-right font-normal">Tokens</th>
            <th className="px-2 py-2 text-right font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {list.map((w) => {
            const r = rows.find((x) => x.wallet === w.address);
            return (
              <tr key={w.address} className="border-b border-line-50 hover:bg-hover-100">
                <td className="px-3 py-2 text-text-100">
                  {w.label || short(w.address)} <span className="font-mono text-text-300">{short(w.address, 4, 4)}</span>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-text-200">{sol(w.sol)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-text-200">{r ? sol(r.amount, 0) : "0"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-text-200">{r ? `${sol(r.valueSol)} SOL` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  if (!held.length) return <div className="flex h-full min-h-[140px] items-center justify-center px-5 text-sm text-text-300">{wallets.data?.wallets.length ? "None of your wallets holds this token." : "Add a managed wallet to track positions."}</div>;
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-bg-100 text-[11px] text-text-300">
        <tr className="border-b border-line-50">
          <th className="px-3 py-2 text-left font-normal">Wallet</th>
          <th className="px-2 py-2 text-right font-normal">Tokens</th>
          <th className="px-2 py-2 text-right font-normal">Supply</th>
          <th className="px-2 py-2 text-right font-normal">Value</th>
          <th className="px-2 py-2 text-right font-normal">Cost</th>
          <th className="px-2 py-2 text-right font-normal">PnL</th>
          <th className="px-2 py-2 text-right font-normal" />
        </tr>
      </thead>
      <tbody>
        {held.map((r) => {
          const p = Number(r.pnlSol);
          return (
            <tr key={r.wallet} className="border-b border-line-50 hover:bg-hover-100">
              <td className="px-3 py-2 text-text-100">
                {r.label || short(r.wallet)} {r.isDev ? <span className="rounded bg-accent-muted px-1 text-[10px] text-accent">dev</span> : null}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-text-200">{sol(r.amount, 0)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-text-200">{pct(r.supplyPct, 2)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-text-100">{sol(r.valueSol)} SOL</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-text-300">{sol(r.costSol)} SOL</td>
              <td className={cx("px-2 py-2 text-right font-mono tabular-nums", p > 0 ? "text-increase" : p < 0 ? "text-decrease" : "text-text-200")}>
                {p > 0 ? "+" : ""}
                {sol(r.pnlSol)} SOL
              </td>
              <td className="px-2 py-2 text-right">
                <div className="flex justify-end gap-1">
                  {[50, 100].map((n) => (
                    <button key={n} type="button" disabled={!(vault.data?.unlocked ?? false) || busy === `${r.wallet}${n}`} onClick={() => sell(r.wallet, n)} className="rounded border border-decrease/40 px-1.5 py-0.5 text-[10px] font-medium text-decrease hover:bg-decrease/10 disabled:opacity-40">
                      Sell {n}%
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
