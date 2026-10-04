"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Button, Capsule, Empty, Input, Panel, Progress, Spinner, Stat, TokenImage, cx } from "@/components/ui";
import { DevRoom } from "@/components/dev/DevRoom";
import { TaskRowCompact } from "@/components/dev/TaskRowCompact";
import { useGet } from "@/lib/api";
import { useSolPrice } from "@/lib/store";
import { age, isMint, short, signedSol, sol, usd } from "@/lib/format";
import type { DashboardResponse } from "@/lib/ui-types";

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
  const d = dash.data;
  const solUsd = d?.solPrice ?? price.data?.usd ?? null;
  const launches = d?.recentLaunches ?? [];
  const selected = mint ?? launches[0]?.mint ?? null;
  const go = (m: string) => router.replace(`/dashboard?mint=${m}`);

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 min-h-0">
      {/* top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Panel bodyClassName="p-4">
          <Stat label="Total balance" value={d?.totalSol !== null && d?.totalSol !== undefined ? `${sol(d.totalSol)} SOL` : "—"} sub={d?.totalSol && solUsd ? usd(Number(d.totalSol) * solUsd, 0) : undefined} />
        </Panel>
        {(["24h", "7d", "30d", "all"] as const).map((k) => {
          const w = d?.pnl[k];
          const v = w ? Number(w.realisedSol) : null;
          return (
            <Panel key={k} bodyClassName="p-4">
              <Stat label={`PnL ${k}`} value={v === null ? "—" : `${signedSol(v)} SOL`} sub={w ? `${w.trades} trades` : undefined} tone={v !== null && v > 0 ? "up" : v !== null && v < 0 ? "down" : undefined} />
            </Panel>
          );
        })}
        <Panel bodyClassName="p-4">
          <Stat label="Active tasks" value={d ? d.activeTasks.length : "—"} sub={d ? `${launches.length} launches` : undefined} />
        </Panel>
      </div>
      {dash.error ? <ApiError error={dash.error} retry={dash.refresh} compact /> : null}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4 min-h-0">
        {/* launches */}
        <div className="flex flex-col gap-4 min-h-0">
          <Panel title="My launches" icon={<Icon3D name="launch" size={22} />} actions={<span className="mono text-[11px] text-text-3">{launches.length}</span>} bodyClassName="p-2 flex flex-col gap-1.5 overflow-y-auto max-h-[60vh]">
            <form
              className="flex gap-1.5 mb-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (isMint(open)) {
                  go(open.trim());
                  setOpen("");
                }
              }}
            >
              <Input value={open} onChange={(e) => setOpen(e.target.value)} placeholder="Open a mint…" mono className="text-xs h-8" />
              <Button size="sm" type="submit" disabled={!isMint(open)}>
                Open
              </Button>
            </form>
            {dash.loading && !d ? (
              <div className="flex items-center gap-2 text-xs text-text-3 p-3">
                <Spinner size={14} /> Loading…
              </div>
            ) : !launches.length ? (
              <Empty
                icon={<Icon3D name="launch" size={44} />}
                title="No launch yet"
                action={
                  <Link href="/launch">
                    <Button size="sm" variant="primary">
                      Launch a token
                    </Button>
                  </Link>
                }
              >
                Tokens created from this app appear here with their live market cap. Paste any mint above to open its dev room.
              </Empty>
            ) : (
              launches.map((l) => (
                <button key={l.mint} onClick={() => go(l.mint)} className={cx("card text-left p-2.5 flex items-center gap-2.5", selected === l.mint ? "!border-accent bg-accent-soft" : "")}>
                  <TokenImage src={l.image} alt={l.symbol} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold">{l.symbol}</span>
                      <span className="text-text-3 truncate">{l.name}</span>
                      <span className="ml-auto text-[10px] text-text-3 mono">{age(l.at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Capsule k="MC">{l.marketCapUsd !== null ? usd(l.marketCapUsd) : l.marketCapSol !== null ? `${sol(l.marketCapSol)} SOL` : "—"}</Capsule>
                      {l.complete ? <Capsule tone="up">Migrated</Capsule> : l.progress !== null ? <Capsule>{l.progress.toFixed(0)} %</Capsule> : null}
                      {!l.createConfirmed ? <Capsule tone={l.createError ? "down" : "warn"}>{l.createError ? "failed" : "pending"}</Capsule> : null}
                      <span className="mono text-[10px] text-text-3 ml-auto">
                        {l.buysConfirmed}/{l.buysTotal} buys
                      </span>
                    </div>
                    {l.progress !== null && !l.complete ? <Progress value={l.progress} className="mt-1.5" /> : null}
                  </div>
                </button>
              ))
            )}
          </Panel>

          {d?.activeTasks.length ? (
            <Panel title="Active tasks" icon={<Icon3D name="volume" size={22} />} bodyClassName="p-2 flex flex-col gap-1.5">
              {d.activeTasks.map((t) => (
                <TaskRowCompact key={`${t.launchId}-${t.task.id}`} launchId={t.launchId} t={t.task} symbol={t.symbol} />
              ))}
            </Panel>
          ) : null}
        </div>

        {/* dev room */}
        <Panel glow title="Dev room" icon={<Icon3D name="dashboard" size={22} />} actions={selected ? <span className="mono text-[11px] text-text-3">{short(selected, 6, 6)}</span> : null} bodyClassName="p-4 min-h-0 overflow-y-auto">
          {selected ? (
            <DevRoom key={selected} mint={selected} activeTasks={d?.activeTasks} />
          ) : (
            <Empty icon={<Icon3D name="dashboard" size={52} />} title="Pick a token">
              Select one of your launches or paste a mint to see the curve, every wallet&apos;s position, creator fees, the volume bot and auto-dump.
            </Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
