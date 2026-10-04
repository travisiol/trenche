"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { Icon } from "@/components/icons";
import { ApiError, Button, Capsule, Card, Empty, Input, KV, Loading, Page, PageHeader, Progress, Segmented, StatCard, TokenImage, cx } from "@/components/ui";
import { DevRoom } from "@/components/dev/DevRoom";
import { TaskRowCompact } from "@/components/dev/TaskRowCompact";
import { useGet } from "@/lib/api";
import { useSolPrice } from "@/lib/store";
import { age, isMint, signedSol, sol, usd } from "@/lib/format";
import type { DashboardResponse } from "@/lib/types";

type Period = "24h" | "7d" | "30d" | "all";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const params = useSearchParams();
  const router = useRouter();
  const mint = params.get("mint");
  const dash = useGet<DashboardResponse>("/api/dashboard", 5000);
  const price = useSolPrice();
  const [open, setOpen] = useState("");
  const [period, setPeriod] = useState<Period>("24h");
  const d = dash.data;
  const solUsd = d?.solPrice ?? price.data?.usd ?? null;
  const launches = d?.recentLaunches ?? [];
  const selected = mint ?? launches[0]?.mint ?? null;
  const go = (m: string) => router.replace(`/dashboard?mint=${m}`);
  const win = d?.pnl[period];
  const winSol = win ? Number(win.realisedSol) : null;
  const total = d?.totalSol !== null && d?.totalSol !== undefined ? Number(d.totalSol) : null;

  return (
    <Page>
      <PageHeader
        icon={<Icon3D name="dashboard" size={40} glow />}
        title="Dashboard"
        description="Your balances, realised PnL and the dev room of every token you launched from here."
        actions={
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (isMint(open)) {
                  go(open.trim());
                  setOpen("");
                }
              }}
            >
              <Input value={open} onChange={(e) => setOpen(e.target.value)} placeholder="Open any mint address…" mono className="w-64 text-[13px]" aria-label="Mint address" />
              <Button type="submit" disabled={!isMint(open)} icon="arrowRight">
                Open
              </Button>
            </form>
            <Link href="/launch">
              <Button variant="primary" icon="rocket">
                Launch a token
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total balance" value={total !== null ? `${sol(total)} SOL` : "—"} sub={total !== null && solUsd ? `${usd(total * solUsd, 2)} at ${usd(solUsd, 2)} per SOL` : "Sum of every active wallet"} />
        <StatCard
          label="Realised PnL"
          value={winSol === null ? "—" : `${signedSol(winSol)} SOL`}
          tone={winSol !== null && winSol > 0 ? "up" : winSol !== null && winSol < 0 ? "down" : undefined}
          sub={win ? `${win.trades} trades · bought ${sol(win.buysSol)} · sold ${sol(win.sellsSol)} SOL` : "Sells minus buys, from this app's journal"}
          right={<Segmented size="xs" value={period} onChange={setPeriod} options={(["24h", "7d", "30d", "all"] as Period[]).map((p) => ({ value: p, label: p }))} />}
        />
        <StatCard label="Active tasks" value={d ? d.activeTasks.length : "—"} sub="Buy, volume and sniper tasks still running" />
        <StatCard label="Launches" value={d ? launches.length : "—"} sub="Tokens created from this app" />
      </div>
      {dash.error ? <ApiError error={dash.error} retry={dash.refresh} compact /> : null}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 min-h-0">
        <div className="flex flex-col gap-4 min-h-0">
          <Card title="My launches" description="Tokens created from this app, with their live market cap." icon={<Icon3D name="launch" size={24} />} flush bodyClassName="p-3 gap-2 overflow-y-auto max-h-[60vh]">
            {dash.loading && !d ? (
              <Loading />
            ) : !launches.length ? (
              <Empty
                icon={<Icon3D name="launch" size={48} />}
                title="No launch yet"
                compact
                action={
                  <Link href="/launch">
                    <Button size="sm" variant="primary" icon="rocket">
                      Launch a token
                    </Button>
                  </Link>
                }
              >
                Your tokens will appear here. To work on a token launched elsewhere, paste its mint above.
              </Empty>
            ) : (
              launches.map((l) => (
                <button key={l.mint} onClick={() => go(l.mint)} className={cx("card text-left p-3 flex items-center gap-3", selected === l.mint ? "!border-accent bg-accent-soft" : "")}>
                  <TokenImage src={l.image} alt={l.symbol} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{l.symbol}</span>
                      <span className="text-text-3 truncate">{l.name}</span>
                      <span className="ml-auto hint mono shrink-0">{age(l.at)}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5">
                      <KV label="Market cap" value={l.marketCapUsd !== null ? usd(l.marketCapUsd) : l.marketCapSol !== null ? `${sol(l.marketCapSol)} SOL` : "—"} />
                      <KV label="Bonded" value={l.complete ? "Migrated" : l.progress !== null ? `${l.progress.toFixed(0)} %` : "—"} tone={l.complete ? "up" : undefined} />
                      <KV label="Buys" value={`${l.buysConfirmed}/${l.buysTotal}`} />
                      {!l.createConfirmed ? <Capsule tone={l.createError ? "down" : "warn"}>{l.createError ? "Create failed" : "Create pending"}</Capsule> : null}
                    </div>
                    {l.progress !== null && !l.complete ? <Progress value={l.progress} className="mt-2" /> : null}
                  </div>
                </button>
              ))
            )}
          </Card>

          {d?.activeTasks.length ? (
            <Card title="Active tasks" description="Running across all your launches. Pause or stop them here." icon={<Icon3D name="volume" size={24} />} flush bodyClassName="p-3 gap-2">
              {d.activeTasks.map((t) => (
                <TaskRowCompact key={`${t.launchId}-${t.task.id}`} launchId={t.launchId} t={t.task} symbol={t.symbol} />
              ))}
            </Card>
          ) : null}
        </div>

        <Card
          glow
          title="Dev room"
          description="Everything about one token: your positions, sells, creator fees, the volume bot and auto-dump."
          icon={<Icon3D name="dashboard" size={24} />}
          actions={
            selected ? (
              <Link href={`/trade/${selected}`} className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
                <Icon name="chart" size={15} /> Trade page
              </Link>
            ) : null
          }
          bodyClassName="min-h-0 overflow-y-auto"
        >
          {selected ? (
            <DevRoom key={selected} mint={selected} activeTasks={d?.activeTasks} />
          ) : (
            <Empty icon={<Icon3D name="dashboard" size={56} />} title="Pick a token">
              Select one of your launches on the left, or paste a mint address at the top, to see its curve, every wallet&apos;s position, creator fees, the volume bot and auto-dump.
            </Empty>
          )}
        </Card>
      </div>
    </Page>
  );
}
