"use client";
/** Block X /sol/trading/[mint]: 68px token header · chart (1s…1m, MC/Price) · Trades list · right panel (Buy/Sell, Token info) · Positions/Wallets. */
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, Crosshair, ExternalLink, Globe, UserRoundCog, UsersRound, Zap } from "lucide-react";
import type { CandleTf, PositionsResponse, TokenCandlesResponse, TokenHoldersResponse, TokenInfo, TokenTradesResponse, JobCreated } from "@/lib/types";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useSolPrice, useVault, useWallets } from "@/lib/store";
import { age, pct, short, sol, solscanAccount, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { TxLink, useExplorerSuffix } from "@/components/bx/Job";
import { pushRecent } from "@/components/bx/recent";
import { CandleChart } from "@/components/trade/Chart";
import { TradePanel, usePresets } from "@/components/trade/TradePanel";

const TF: CandleTf[] = ["1s", "15s", "1m"];

export default function TradePage({ params }: PageProps<"/trade/[mint]">) {
  const { mint } = use(params);
  const token = useGet<TokenInfo>(`/api/token/${mint}`, 2000);
  const [tf, setTf] = useState<CandleTf>("15s");
  const [mode, setMode] = useState<"MC" | "Price">("MC");
  const candles = useGet<TokenCandlesResponse>(`/api/token/${mint}/candles?tf=${tf}`, 5000);
  const positions = useGet<PositionsResponse>(`/api/positions?mints=${mint}`, 5000);
  const holders = useGet<TokenHoldersResponse>(`/api/token/${mint}/holders`, 15000);
  const wallets = useWallets();
  const vault = useVault();
  const settings = useSettings();
  const presets = usePresets();
  const price = useSolPrice();
  const suffix = useExplorerSuffix();
  const [bottom, setBottom] = useState<"positions" | "wallets">("positions");
  const [infoOpen, setInfoOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const t = token.data;
  const c = t?.curve ?? null;
  const solUsd = t?.solPrice ?? price.data?.usd ?? null;
  const rows = (positions.data ?? []).filter((r) => r.mint === mint);
  const mine = new Set((wallets.data?.wallets ?? []).map((w) => w.address));
  const supply = Number(c?.tokenTotalSupply ?? 1e15) / 1e6 || 1e9;

  // recently viewed strip
  useEffect(() => {
    if (t) pushRecent({ mint, symbol: t.symbol, name: t.name, image: t.image });
  }, [mint, t]);
  // keys 1/2/3: quick buy with the active wallet
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = (settings.data?.keybinds.quickBuy ?? ["1", "2", "3"]).indexOf(e.key);
      if (idx < 0) return;
      const active = wallets.data?.active;
      if (!vault.data?.unlocked || !active) return toast("Unlock the vault and pick an active wallet in Portfolio", "err");
      try {
        await post<JobCreated>("/api/trade/buy", { mint, wallets: [active], sol: presets[idx], slippageBps: settings.data?.slippageBps ?? 2000 });
        toast(`Buying ${presets[idx]} SOL`, "info");
      } catch (err) {
        toast(failureMessage(err), "err");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mint, presets, settings.data, wallets.data?.active, vault.data?.unlocked]);

  const progress = t?.complete ? 100 : (c?.progress ?? 0);
  const mcUsd = c ? (c.marketCapUsd ?? (solUsd ? c.marketCapSol * solUsd : null)) : null;
  const priceUsd = c && solUsd ? c.priceSol * solUsd : null;
  const liqSol = c ? Number(c.realSolReserves) / 1e9 : null;
  const chartCandles = (candles.data?.candles ?? []).map((k) => (mode === "MC" && solUsd ? { ...k, open: k.open * supply * solUsd, high: k.high * supply * solUsd, low: k.low * supply * solUsd, close: k.close * supply * solUsd } : k));
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
            <button type="button" className="cursor-pointer text-text-300 transition-colors hover:text-text-100" title={mint} onClick={() => navigator.clipboard?.writeText(mint)}>
              {mint.slice(0, 4)}...{mint.slice(-4)}
            </button>
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
            ["MC", mcUsd !== null ? usd(mcUsd) : c ? `${sol(c.marketCapSol)} SOL` : "—", "text-base font-semibold text-text-100"],
            ["Price", priceUsd !== null ? `$${priceUsd < 0.001 ? priceUsd.toExponential(2) : priceUsd.toFixed(6)}` : c ? `${c.priceSol.toExponential(2)} SOL` : "—", "text-sm font-medium leading-[18px] text-text-200"],
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

  const tradesList = <TradesList mint={mint} mine={mine} supply={supply} solUsd={solUsd} />;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-100">
      <div className="h-[68px] shrink-0 border-b border-line-100 lg:hidden">{header}</div>
      <div className="hidden min-h-0 flex-1 gap-px overflow-auto bg-line-100 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[68px_minmax(360px,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_400px_320px] xl:grid-rows-[68px_minmax(360px,1fr)_260px]">
        <div className="min-w-0 bg-bg-100 lg:col-start-1 lg:row-start-1 xl:col-span-1">
          <div className="h-[68px] border-b border-line-100">{header}</div>
        </div>
        <div className="min-h-0 bg-bg-100 lg:col-start-1 lg:row-start-2 xl:col-span-1">
          <section className="h-full min-h-0 overflow-hidden bg-bg-100">
            <section className="relative h-full min-h-0 w-full" aria-label="Price chart">
              <div className="absolute left-2 top-2 z-10 flex flex-wrap items-center gap-1">
                <div className="inline-flex items-center rounded border border-line-100 bg-bg-50 p-px">
                  {TF.map((x) => (
                    <button key={x} type="button" onClick={() => setTf(x)} className={cx("h-5 rounded px-1.5 text-[10px] font-medium transition-colors", tf === x ? "bg-bg-100 text-text-100" : "text-text-300 hover:text-text-100")}>
                      {x}
                    </button>
                  ))}
                </div>
                <div className="inline-flex items-center rounded border border-line-100 bg-bg-50 p-px">
                  {(["MC", "Price"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMode(m)} className={cx("h-5 rounded px-1.5 text-[10px] font-medium transition-colors", mode === m ? "bg-bg-100 text-text-100" : "text-text-300 hover:text-text-100")}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-full min-h-0 w-full">
                {candles.error ? (
                  <div className="flex h-full items-center justify-center text-xs text-decrease">{failureMessage(candles.error)}</div>
                ) : !chartCandles.length ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                    <p className="text-sm text-text-200">{candles.loading ? "Loading chart…" : "No trade yet on the curve"}</p>
                    <p className="text-xs text-text-300">Candles are built from the bonding-curve history as soon as a trade lands.</p>
                  </div>
                ) : (
                  <CandleChart candles={chartCandles} live={null} height={440} unitLabel={mode === "MC" && solUsd ? "Market cap, USD" : "SOL per token"} />
                )}
              </div>
            </section>
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
                    <Risk icon={<Crosshair className="h-3.5 w-3.5 shrink-0" />} value={rows.length ? pct(rows.reduce((n, r) => n + (r.supplyPct ?? 0), 0), 1) : "0.0%"} label="You H." good />
                  </div>
                  {holders.error ? <p className="text-[10px] text-text-300">Holders need an indexed RPC (Helius key in Settings).</p> : null}
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
                  <span className="text-text-300">Curve</span>
                  <span className="max-w-[190px] truncate font-mono text-text-100">{c?.bondingCurve ?? "—"}</span>
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
              <Link href={`/launch?open=${mint}`} className="ml-auto flex items-center gap-1 rounded-full border border-accent/50 bg-transparent py-1 pl-2 pr-3 text-[12px] font-medium leading-4 text-accent hover:bg-accent-muted">
                <Zap className="h-4 w-4" />
                <span>Dev room</span>
              </Link>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <Positions rows={rows} mint={mint} mode={bottom} />
            </div>
          </section>
        </div>
      </div>
      {/* mobile */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="h-[min(210px,34svh)] shrink-0 overflow-hidden border-b border-line-100">{chartCandles.length ? <CandleChart candles={chartCandles} live={null} height={210} /> : <div className="flex h-full items-center justify-center text-xs text-text-300">No trade yet</div>}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TradePanel mint={mint} symbol={t?.symbol ?? null} rows={rows} />
          <div className="h-[320px]">{tradesList}</div>
        </div>
      </div>
    </div>
  );
}

function Risk({ icon, value, label, good }: { icon: React.ReactNode; value: string; label: string; good: boolean }) {
  return (
    <div className="flex h-[55px] min-w-0 flex-col items-center justify-start gap-1.5 rounded border border-line-100/70 px-1.5 pb-1.5 pt-1.5">
      <div className={cx("flex min-w-0 items-center gap-1 font-mono text-[13px]", value === "n/a" || value === "…" ? "text-text-300" : good ? "text-increase" : "text-decrease")}>
        {icon}
        {value}
      </div>
      <div className="truncate text-[10px] leading-4 text-text-300">{label}</div>
    </div>
  );
}

function TradesList({ mint, mine, supply, solUsd }: { mint: string; mine: Set<string>; supply: number; solUsd: number | null }) {
  const q = useGet<TokenTradesResponse>(`/api/token/${mint}/trades?limit=100`, 5000);
  const rows = q.data?.trades ?? [];
  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Activity monitor">
      <div className="mb-2 mt-2 flex items-center gap-2 px-2" role="tablist">
        <div className="flex shrink-0 items-center gap-1 pl-0.5">
          <button type="button" role="tab" aria-selected className="px-2 py-1 text-sm font-medium text-text-100">
            Trades
          </button>
        </div>
        <div className="flex flex-nowrap items-center gap-0 bg-btn-secondary p-0.5">
          <button type="button" className="cursor-pointer whitespace-nowrap border border-line-200 bg-input-200 px-2 py-1 text-xs font-medium leading-none text-text-100">
            All
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
            <span className="text-sm font-medium">Trader</span>
          </div>
          <div className="flex w-[15%] items-center justify-end p-1">
            <span className="text-[13px] leading-4">Age</span>
          </div>
        </div>
        <div className="h-px bg-line-100" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.error ? <p className="px-3 py-6 text-center text-xs text-decrease">{failureMessage(q.error)}</p> : !rows.length ? <p className="px-3 py-6 text-center text-xs text-text-300">{q.loading ? "Reading the curve history…" : "No trade on this curve yet."}</p> : null}
          {rows.map((tr) => {
            const mcSol = Number(tr.priceSol) * supply;
            const own = mine.has(tr.wallet);
            return (
              <div key={tr.signature} className="relative py-px">
                <div className="relative flex h-[30px] cursor-pointer flex-row bg-bg-100 px-2 hover:bg-hover-100" style={{ backgroundImage: `linear-gradient(to right, color-mix(in srgb, var(--${tr.side === "buy" ? "increase" : "decrease"}) ${Math.min(20, Math.round(Number(tr.solAmount) * 20))}%, transparent) 0%, transparent 100%)` }}>
                  <div className="relative flex w-[22.5%] items-center justify-start overflow-hidden whitespace-nowrap p-1 leading-none">
                    <div className={cx("flex items-center gap-0.5 text-[13px] font-normal leading-4", tr.side === "buy" ? "text-increase" : "text-decrease")}>
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
                      <span className={cx("max-w-[120px] truncate font-medium", own ? "rounded bg-accent-muted px-1 text-accent" : "text-text-200")}>{own ? "you" : tr.wallet.slice(-4)}</span>
                    </div>
                  </div>
                  <div className="relative flex w-[15%] items-center justify-end gap-1 overflow-hidden whitespace-nowrap p-1 leading-none">
                    <span className="text-[13px] leading-4 text-text-300">{age(tr.blockTime * 1000)}</span>
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
      await post<JobCreated>("/api/trade/sell", { mint, wallets: [addr], percent, slippageBps: settings.data?.slippageBps ?? 2000 });
      toast(`Selling ${percent}%`, "info");
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
