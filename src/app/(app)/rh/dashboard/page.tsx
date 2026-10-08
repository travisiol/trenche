"use client";
/** Robinhood mode › Dashboard: ETH across the Robinhood wallets, creator fees, every launch with its market cap and
 *  PnL (all your wallets on it, read from the curve's events), recent Robinhood activity. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Rocket, Wallet } from "lucide-react";
import { failureMessage, useGet } from "@/lib/api";
import { age, short } from "@/lib/format";
import { BxCard, cx } from "@/components/bx/ui";
import type { ActivityResponse } from "@/lib/types";
import { EthMark, TokenAvatar, ethNum, signed, tone, usdOf, useRhStatus, weiNum, type RhLaunchRow } from "@/components/rh/common";

export default function RhDashboardPage() {
  const router = useRouter();
  const status = useRhStatus(10000);
  const launches = useGet<{ launches: RhLaunchRow[]; ethUsd: number | null }>("/api/robinhood/launches", 15000);
  const activity = useGet<ActivityResponse>("/api/activity?chain=robinhood&limit=60", 10000);
  const s = status.data;
  const usd = s?.ethUsd ?? launches.data?.ethUsd ?? null;
  const rows = launches.data?.launches ?? [];
  const total = weiNum(s?.totalWei);
  const fees = weiNum(s?.totalEscrowWei);
  const net = rows.length && rows.every((r) => r.netEth !== null) ? rows.reduce((t, r) => t + (r.netEth ?? 0), 0) : null;
  const holding = rows.reduce((t, r) => t + (r.heldValueEth ?? 0), 0);
  const nameOf = (a: string | null) => (a ? (s?.wallets.find((w) => w.address.toLowerCase() === a.toLowerCase())?.label ?? short(a)) : "—");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 xl:px-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="Wallets" value={s ? `${ethNum(total, 4)} ETH` : "—"} sub={`${usdOf(total, usd)} · ${s?.wallets.length ?? 0} wallets`} icon={<EthMark className="h-4 w-4 text-[#ccff00]" />} />
          <Card label="Holdings value" value={launches.data ? `${ethNum(holding, 4)} ETH` : "—"} sub={usdOf(holding, usd)} />
          <Card label="PnL (all launches)" value={net === null ? "—" : `${signed(net, 4)} ETH`} sub={usdOf(net, usd)} cls={tone(net)} />
          <Card label="Creator fees waiting" value={`${ethNum(fees, 5)} ETH`} sub={fees > 0 ? "claim in Portfolio" : usdOf(fees, usd)} cls={fees > 0 ? "text-increase" : undefined} />
        </div>

        <BxCard
          title="Launches"
          icon={<Rocket className="h-4 w-4 text-text-300" />}
          right={
            <Link href="/rh/launch" className="inline-flex h-7 items-center gap-1 rounded-md bg-[#ccff00] px-2.5 text-xs font-medium text-black hover:brightness-110">
              <Plus className="h-3.5 w-3.5" /> Launch
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-y border-line-100 text-xs text-text-300">
                  <th className="px-4 py-2 text-left font-normal">Token</th>
                  <th className="px-2 py-2 text-left font-normal">Dev</th>
                  <th className="px-2 py-2 text-right font-normal">Bundle</th>
                  <th className="px-2 py-2 text-right font-normal">Market cap</th>
                  <th className="px-2 py-2 text-left font-normal">Curve</th>
                  <th className="px-2 py-2 text-right font-normal">Invested</th>
                  <th className="px-2 py-2 text-right font-normal">Holding</th>
                  <th className="px-4 py-2 text-right font-normal">PnL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.token} onClick={() => router.push(`/rh/token/${r.token}`)} className="cursor-pointer border-b border-line-50 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <TokenAvatar src={r.image} symbol={r.symbol} size={30} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-text-100">{r.name}</span>
                            <span className="text-xs text-text-300">${r.symbol}</span>
                            {r.graduated ? <span className="rounded bg-increase/15 px-1 text-[10px] text-increase">graduated</span> : null}
                          </div>
                          <span className="text-[11px] text-text-300">{age(r.at)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-text-200">{nameOf(r.dev)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-text-200">{r.bundle || "—"}</td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="block text-text-100">{usdOf(r.mcapEth, usd)}</span>
                      <span className="text-[11px] text-text-300">{ethNum(r.mcapEth, 3)} ETH</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-[#ccff00]" style={{ width: `${Math.round((r.progress ?? 0) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-text-200">{ethNum(r.spentEth, 4)}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-text-200">{ethNum(r.heldValueEth, 4)}</td>
                    <td className={cx("px-4 py-2.5 text-right font-mono", tone(r.netEth))}>
                      {signed(r.netEth, 4)}
                      <span className="block text-[11px] text-text-300">{usdOf(r.netEth, usd)}</span>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-text-300">
                      {launches.error ? failureMessage(launches.error) : launches.loading && !launches.data ? "Reading your launches…" : "No Robinhood launch yet."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </BxCard>

        <div className="grid gap-4 xl:grid-cols-2">
          <BxCard title="Wallets" icon={<Wallet className="h-4 w-4 text-text-300" />} right={<Link href="/rh/portfolio" className="text-xs text-text-300 hover:text-text-100">Portfolio →</Link>} bodyClassName="px-5 pb-4">
            <div className="flex flex-col gap-1">
              {(s?.wallets ?? [])
                .slice()
                .sort((a, b) => weiNum(b.balanceWei) - weiNum(a.balanceWei))
                .slice(0, 8)
                .map((w) => (
                  <div key={w.address} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-text-200">
                      {w.label}
                      {w.main ? <span className="ml-1 text-[10px] text-[#ccff00]">main</span> : null}
                    </span>
                    <span className="font-mono text-text-100">{ethNum(weiNum(w.balanceWei), 5)} ETH</span>
                  </div>
                ))}
              {!s ? <p className="text-xs text-text-300">{status.error ? failureMessage(status.error) : "Loading…"}</p> : null}
            </div>
          </BxCard>
          <BxCard title="Activity" bodyClassName="px-5 pb-4">
            <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto">
              {(activity.data?.items ?? []).map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-[11px]">
                  <span className={cx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", a.ok ? "bg-increase" : "bg-decrease")} />
                  <span className="min-w-0 flex-1 text-text-200">{a.message}</span>
                  <span className="shrink-0 text-text-300">{age(a.at)}</span>
                </div>
              ))}
              {!activity.data?.items.length ? <p className="text-xs text-text-300">Nothing yet.</p> : null}
            </div>
          </BxCard>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, cls, icon }: { label: string; value: string; sub?: string; cls?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line-100 bg-bg-50 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-text-300">
        {icon}
        {label}
      </div>
      <div className={cx("mt-1 font-mono text-lg font-semibold", cls ?? "text-text-100")}>{value}</div>
      {sub ? <div className="text-[11px] text-text-300">{sub}</div> : null}
    </div>
  );
}
