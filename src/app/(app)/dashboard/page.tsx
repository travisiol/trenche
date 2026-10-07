"use client";
/** Block X /sol/dashboard: welcome row, New on chain · Portfolio PnL + calendar · Latest launches · Active tasks · Rewards. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, BookOpen, ChartLine, Gift, Rocket } from "lucide-react";
import { BxCard, BxSeg, PadAvatar, cx } from "@/components/bx/ui";
import { DOCS_URL } from "@/components/bx/Shell";
import { PnlCalendar, type DayPnl } from "@/components/bx/PnlCalendar";
import { PnlFees } from "@/components/bx/PnlFees";
import { SharePnlButton } from "@/components/bx/SharePnl";
import { useDrafts } from "@/components/launch/drafts";
import { TaskRowCompact } from "@/components/dev/TaskRowCompact";
import { failureMessage, useGet } from "@/lib/api";
import { useSolPrice, useWallets } from "@/lib/store";
import { groupPositions } from "@/lib/positions";
import { usd } from "@/lib/format";
import type { DashboardResponse, FeesSummaryResponse, PositionsResponse } from "@/lib/types";

type Win = "1D" | "7D" | "30D" | "All";
const WIN_KEY: Record<Win, "24h" | "7d" | "30d" | "all"> = { "1D": "24h", "7D": "7d", "30D": "30d", All: "all" };

function money(sol: number, solUsd: number | null, unit: "USD" | "SOL", signed = false) {
  const sign = signed && sol > 0 ? "+" : "";
  if (unit === "USD" && solUsd) return `${sign}${usd(sol * solUsd, 1)}`;
  const abs = Math.abs(sol);
  return `${sign}${sol < 0 ? "-" : ""}${abs.toFixed(abs < 1 ? 3 : 2)} SOL`;
}

export default function DashboardPage() {
  const router = useRouter();
  const dash = useGet<DashboardResponse>("/api/dashboard", 5000);
  const positions = useGet<PositionsResponse>("/api/positions", 10000);
  const price = useSolPrice();
  const wallets = useWallets();
  const [win, setWin] = useState<Win>("30D");
  const [unit, setUnit] = useState<"USD" | "SOL">("USD");
  const d = dash.data;
  const solUsd = d?.solPrice ?? price.data?.usd ?? null;
  const pnl = d?.pnl[WIN_KEY[win]];
  /** NET of every fee (on-chain ledger): gross curve cash-flow − costs + creator fees claimed */
  const realised = pnl ? Number(pnl.netSol) : 0;
  const volume = pnl ? Number(pnl.buysSol) + Number(pnl.sellsSol) : 0;
  const grouped = groupPositions(positions.data);
  /** what the tokens still held are worth now (their cost is already inside the net figure) */
  const holdings = grouped.filter((p) => Number(p.amount) > 0).reduce((n, p) => n + Number(p.valueSol), 0);
  /** realized is average-cost (a held coin's cost is not in it): total = realized + (held value − held cost) */
  const openCost = d ? Number(d.openCostSol ?? 0) : 0;
  // positions not read yet: no held value to set against their cost — the total stays the realized figure meanwhile
  const heldKnown = !!positions.data;
  const total = realised + (heldKnown ? holdings - openCost : 0);
  const basis = pnl ? Number(pnl.buysSol) : 0;
  const pct = basis > 0 ? (total / basis) * 100 : 0;
  const launches = d?.recentLaunches ?? [];
  /** Block X lists drafts under Latest launches too (`??` avatar · $TOKEN · Draft · $0.00) */
  const { drafts } = useDrafts();
  const draftRows = drafts.filter((x) => !x.launchedMint).slice(0, 5);
  /** per-launch result = net ledger result on the mint + current value of what is still held */
  const heldByMint = new Map(grouped.map((p) => [p.mint, Number(p.amount) > 0 ? Number(p.valueSol) : 0]));
  const pnlByMint = new Map((d?.mints ?? []).map((m) => [m.mint, Number(m.netSol) + (heldByMint.get(m.mint) ?? 0)]));
  /** hover breakdown of a launch row — the same lines as the PnL next to "Tasks" on the launch page */
  const breakdownByMint = new Map(
    (d?.mints ?? []).map((m) => {
      const held = heldByMint.get(m.mint) ?? 0;
      const s = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(4)} SOL`;
      return [
        m.mint,
        [
          `Trades ${s(Number(m.tradingSol) + held)} — sold ${Number(m.sellsSol).toFixed(4)} − bought ${Number(m.buysSol).toFixed(4)}${held ? ` + still held ${held.toFixed(4)}` : ""} (pump.fun fees inside)`,
          `Launch costs −${Number(m.costsSol).toFixed(4)} SOL — creation ${Number(m.launchSol).toFixed(4)} · priority/tips/network ${Number(m.txFeesSol).toFixed(4)} · token accounts ${Number(m.rentSol).toFixed(4)}`,
          `Creator fees +${Number(m.creatorFeesSol).toFixed(4)} SOL — produced by every trade on this token, claimed or pending${m.creatorFeesComplete ? "" : " (still being read)"}`,
          `= Net ${s(Number(m.netSol) + held)}`,
        ].join("\n"),
      ] as const;
    }),
  );
  const days = new Map<string, DayPnl>((d?.days ?? []).map((x) => [x.date, x]));
  const walletCount = (wallets.data?.wallets ?? []).filter((w) => !w.archived).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-100">
      <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-y-contain lg:overflow-hidden">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 lg:h-full lg:min-h-0 lg:pb-4 xl:px-8">
          <section className="hidden shrink-0 items-center justify-between gap-3 lg:flex">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-text-100">Welcome back</h1>
              <p className="mt-0.5 text-[13px] text-text-300">Solana overview — launches, portfolio PnL and rewards.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3.5 text-[13px] font-medium text-text-200 transition-colors hover:border-accent/35 hover:text-text-100">
                <BookOpen className="h-4 w-4" />
                Platform guide
              </a>
              <button type="button" onClick={() => router.push("/launch?new=1")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover">
                <Rocket className="h-4 w-4" />
                New launch
              </button>
            </div>
          </section>

          <section className="grid grid-cols-1 items-stretch gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1.05fr)_minmax(0,1fr)] lg:overflow-hidden">
            {/* Latest launches */}
            <BxCard
              className="order-2 flex min-h-[360px] lg:order-none lg:col-start-2 lg:row-start-1 lg:min-h-0"
              title="Latest launches"
              icon={<Rocket className="h-4 w-4 text-accent" />}
              right={
                <>
                  <UnitToggle unit={unit} onChange={setUnit} />
                  <Link href="/launch" className="text-[13px] font-medium text-accent transition-colors hover:text-accent-hover">
                    All
                  </Link>
                </>
              }
            >
              <ul className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 pb-3 max-lg:overflow-visible lg:overflow-y-auto">
                <li>
                  <button type="button" onClick={() => router.push("/launch?new=1")} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-dashed border-line-100 bg-bg-100 text-accent">
                      <Rocket className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium tracking-[-0.02em] text-text-100">New launch</span>
                      <span className="block truncate text-[12px] text-text-300">Create a token on this chain</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium tabular-nums text-text-300">{money(0, solUsd, unit)}</span>
                  </button>
                </li>
                {launches.map((l) => {
                  const p = pnlByMint.get(l.mint);
                  return (
                    <li key={l.mint}>
                      <Link href={`/launch?open=${l.mint}`} title={breakdownByMint.get(l.mint)} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
                        <PadAvatar src={l.image} alt={l.symbol} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium tracking-[-0.02em] text-text-100">{l.symbol}</span>
                          <span className="block truncate text-[12px] text-text-300">{l.name}</span>
                        </span>
                        <span className={cx("inline-flex shrink-0 items-center gap-1 text-[13px] font-medium tabular-nums", p === undefined ? "text-text-300" : p > 0 ? "text-increase" : p < 0 ? "text-decrease" : "text-text-300")}>{p === undefined ? "—" : money(p, solUsd, unit, true)}</span>
                      </Link>
                    </li>
                  );
                })}
                {draftRows.map((x) => (
                  <li key={x.id}>
                    <Link href={`/launch?draft=${x.id}`} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
                      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-100 bg-bg-100 text-[11px] font-semibold text-text-300">
                        {x.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local data URL
                          <img src={x.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                          "??"
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium tracking-[-0.02em] text-text-100">{x.symbol ? `${x.symbol}` : "$TOKEN"}</span>
                        <span className="block truncate text-[12px] text-text-300">Draft{x.name ? ` · ${x.name}` : ""}</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium tabular-nums text-text-300">{money(0, solUsd, unit)}</span>
                    </Link>
                  </li>
                ))}
                {Array.from({ length: Math.max(0, 5 - launches.length - draftRows.length) }).map((_, i) => (
                  <li key={`ph${i}`} className="pointer-events-none">
                    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 opacity-40">
                      <span className="h-8 w-8 shrink-0 rounded-md border border-line-100 bg-bg-100" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium tracking-[-0.02em] text-text-300">$TOKEN</span>
                        <span className="block truncate text-[12px] text-text-300">Name</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium tabular-nums text-text-300">{money(0, solUsd, unit)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </BxCard>

            {/* Portfolio PnL */}
            <div className="order-1 min-w-0 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0">
              <div className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border border-line-100 bg-bg-50 lg:h-full lg:min-h-0">
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 px-5 xl:h-[56px]">
                    <div className="flex items-center gap-2">
                      <ChartLine className="h-4 w-4 text-accent" />
                      <h2 className="text-[16px] font-medium tracking-[-0.02em] text-text-100">Portfolio PnL</h2>
                    </div>
                    <div className="flex items-center gap-1">
                      <UnitToggle unit={unit} onChange={setUnit} />
                      <BxSeg value={win} onChange={setWin} options={(["1D", "7D", "30D", "All"] as Win[]).map((w) => ({ value: w, label: w }))} />
                      <SharePnlButton period={win} label />
                    </div>
                  </div>
                  <div className="shrink-0 border-b border-line-50 px-6 pb-4 pt-1">
                    <p className="text-[14px] text-text-300">Total PnL · net of fees</p>
                    <p className={cx("mt-0.5 text-[28px] font-medium tracking-[-0.03em] tabular-nums xl:text-[32px]", total > 0 ? "text-increase" : total < 0 ? "text-decrease" : "text-text-100")}>
                      <span className="inline-flex items-center gap-1.5">{money(total, solUsd, unit, true)}</span> ({pct >= 0 ? "+" : ""}
                      {pct.toFixed(1)}%)
                    </p>
                    <PnlFees pnl={pnl} solUsd={solUsd} unit={unit} className="mt-1" />
                    <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 xl:mt-4 xl:gap-y-3">
                      {[
                        [`${win} Net Realized`, money(realised, solUsd, unit, true), realised],
                        ["Holdings (current value)", heldKnown ? money(holdings, solUsd, unit) : "—", 0],
                        [`${win} Total Volume`, money(volume, solUsd, unit), 0],
                        [`${win} Gross (sells − buys)`, money(pnl ? Number(pnl.realisedSol) : 0, solUsd, unit, true), pnl ? Number(pnl.realisedSol) : 0],
                      ].map(([k, v, tone]) => (
                        <div key={String(k)} className="min-w-0">
                          <p className="truncate text-[13px] text-text-300">{k}</p>
                          <p className={cx("mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[15px] font-medium tabular-nums", Number(tone) > 0 ? "text-increase" : Number(tone) < 0 ? "text-decrease" : "text-text-100")}>
                            <span className="truncate">{v}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-auto flex min-h-0 flex-1 flex-col border-t border-line-50">
                    <PnlCalendar days={days} solUsd={solUsd} unit={unit} />
                  </div>
                </div>
              </div>
            </div>

            {/* Rewards */}
            <BxCard className="order-3 flex min-h-[320px] lg:order-none lg:col-start-2 lg:row-start-2 lg:min-h-0" title="Rewards" icon={<Gift className="h-4 w-4 text-accent" />}>
              <RewardsSummary walletCount={walletCount} />
              {d?.activeTasks.length ? (
                <div className="flex flex-col gap-1.5 border-t border-line-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-text-100">
                    <Activity className="h-3.5 w-3.5 text-accent" /> Active tasks <span className="font-mono text-text-300">{d.activeTasks.length}</span>
                  </div>
                  {d.activeTasks.map((t) => (
                    <TaskRowCompact key={`${t.launchId}-${t.task.id}`} launchId={t.launchId} t={t.task} symbol={t.symbol} />
                  ))}
                </div>
              ) : null}
            </BxCard>
          </section>
        </div>
      </div>
    </div>
  );
}

function UnitToggle({ unit, onChange }: { unit: "USD" | "SOL"; onChange: (u: "USD" | "SOL") => void }) {
  return (
    <button type="button" onClick={() => onChange(unit === "USD" ? "SOL" : "USD")} className="group/pnl-unit inline-flex h-4 flex-row items-center justify-center gap-1 rounded px-1.5 pl-2 transition-colors duration-150 hover:cursor-pointer hover:bg-white/[0.04]" aria-label={unit === "USD" ? "Display position in SOL" : "Display position in USD"} title={unit === "USD" ? "Show SOL" : "Show USD"}>
      <span className="text-xs font-normal leading-4 text-text-300 transition-colors duration-150 group-hover/pnl-unit:text-text-200">PnL</span>
      <span className="text-[10px] font-medium text-text-300">{unit}</span>
    </button>
  );
}

/** Block X Rewards card: pills "SOL fees" · "<pending> SOL pending" from GET /api/dev/fees/summary, text, Portfolio / Rewards. */
function RewardsSummary({ walletCount }: { walletCount: number }) {
  const fees = useGet<FeesSummaryResponse>("/api/dev/fees/summary", 15000);
  const f = fees.data;
  const pending = f?.pendingSol ?? f?.claimableSol ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-5 pb-6">
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <div className="flex h-12 items-center gap-2.5 rounded-lg border border-line-100 bg-bg-100 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
          <img src="/solana.svg" alt="" className="h-6 w-6" />
          <span className="text-[13px] font-medium text-text-200">SOL fees</span>
        </div>
        <div className="flex h-12 items-center gap-2.5 rounded-lg border border-line-100 bg-bg-100 px-4" title={f?.unreadable.length ? `${f.unreadable.length} creator vault(s) unreadable` : f ? `${f.creators.length} creator wallet(s) · ${f.launches} launch(es) · claimed ${f.claimedSol} SOL` : undefined}>
          <span className="text-lg font-medium tabular-nums text-text-100">{fees.error ? "—" : pending === null ? (f ? "—" : "…") : Number(pending).toFixed(3)}</span>
          <span className="text-[13px] font-medium text-text-200">SOL pending</span>
        </div>
      </div>
      <p className="text-center text-[13px] leading-relaxed text-text-300">{fees.error ? failureMessage(fees.error) : !walletCount ? "Add a developer wallet to claim pad fees." : !f || !f.launches ? "Launch a token to start earning pad fees." : `Creator fees of ${f.launches} launch${f.launches !== 1 ? "es" : ""}, claimable on the Rewards page.`}</p>
      <div className="flex w-full max-w-[320px] items-center gap-2">
        <Link href="/portfolio" className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-line-100 bg-bg-100 text-[13px] font-medium text-text-200 transition-colors hover:border-accent/35 hover:text-text-100">
          Portfolio
        </Link>
        <Link href="/rewards" className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-line-100 bg-bg-100 text-[13px] font-medium text-text-200 transition-colors hover:border-accent/35 hover:text-text-100">
          Rewards
        </Link>
      </div>
    </div>
  );
}
