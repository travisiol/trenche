"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { Icon } from "@/components/icons";
import { ApiError, Button, Card, Empty, Input, Loading, Page, PageHeader, StepItem, StepList, TokenImage, toast } from "@/components/ui";
import { failureMessage, useGet, claimFees } from "@/lib/api";
import { useVault } from "@/lib/store";
import { dateTime, isMint, short, sol, solscanTx } from "@/lib/format";
import type { ActivityResponse, CreatorFeesResponse, LaunchesResponse } from "@/lib/types";

const EXTRA_KEY = "trench.rewards.extra";
function readExtra(): string[] {
  try {
    return JSON.parse(localStorage.getItem(EXTRA_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function RewardsPage() {
  const launches = useGet<LaunchesResponse>("/api/dev/launches", 10000);
  const claims = useGet<ActivityResponse>("/api/activity?limit=500", 10000);
  const vault = useVault();
  const [extra, setExtra] = useState<string[]>(() => (typeof window === "undefined" ? [] : readExtra()));
  const [paste, setPaste] = useState("");
  const canSign = vault.data?.unlocked ?? false;
  const mints = Array.from(new Set([...(launches.data?.launches ?? []).map((l) => l.mint), ...extra]));
  const history = (claims.data?.items ?? []).filter((a) => /claim/i.test(a.kind));

  return (
    <Page>
      <PageHeader
        icon={<Icon3D name="rewards" size={40} glow />}
        title="Rewards"
        description="pump.fun pays the creator of a token a share of every trade. Claim it here for the tokens you launched."
        actions={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isMint(paste)) return;
              const next = Array.from(new Set([...extra, paste.trim()]));
              setExtra(next);
              localStorage.setItem(EXTRA_KEY, JSON.stringify(next));
              setPaste("");
            }}
          >
            <Input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Track another mint address…" mono className="w-72 text-[13px]" aria-label="Mint to track" />
            <Button type="submit" disabled={!isMint(paste)} icon="plus">
              Track
            </Button>
          </form>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4 items-start">
        <Card glow title="Creator fees" description="One row per token. Claim sends the accumulated SOL to the creator wallet." icon={<Icon3D name="rewards" size={24} />} bodyClassName="gap-3">
          {launches.error ? <ApiError error={launches.error} retry={launches.refresh} compact /> : null}
          {launches.loading && !launches.data && !mints.length ? (
            <Loading>Loading your launches…</Loading>
          ) : !mints.length ? (
            <Empty icon={<Icon3D name="rewards" size={56} />} title="No token to claim from">
              Every token launched from this app shows its pump.fun creator fees here. Paste any mint whose creator is one of your wallets to track it too.
            </Empty>
          ) : (
            mints.map((m) => (
              <FeeRow
                key={m}
                mint={m}
                canSign={canSign}
                launch={launches.data?.launches.find((l) => l.mint === m) ?? null}
                onRemove={
                  extra.includes(m)
                    ? () => {
                        const next = extra.filter((x) => x !== m);
                        setExtra(next);
                        localStorage.setItem(EXTRA_KEY, JSON.stringify(next));
                      }
                    : undefined
                }
              />
            ))
          )}
        </Card>

        <Card title="Claim history" description="Every claim sent from this app, with its signature." flush>
          {claims.error ? (
            <div className="p-3">
              <ApiError error={claims.error} retry={claims.refresh} compact />
            </div>
          ) : !history.length ? (
            <Empty title="No claim yet" compact>
              Claims appear here as soon as you send one.
            </Empty>
          ) : (
            <StepList className="px-4">
              {history.map((a) => (
                <StepItem
                  key={a.id}
                  ok={a.ok}
                  right={
                    <>
                      {a.signature ? (
                        <a href={solscanTx(a.signature)} target="_blank" rel="noreferrer" className="mono text-accent hover:underline">
                          {short(a.signature)} ↗
                        </a>
                      ) : null}
                      <span className="mono text-text-3">{dateTime(a.at)}</span>
                    </>
                  }
                >
                  {a.message}
                </StepItem>
              ))}
            </StepList>
          )}
        </Card>
      </div>
    </Page>
  );
}

function FeeRow({ mint, canSign, launch, onRemove }: { mint: string; canSign: boolean; launch: LaunchesResponse["launches"][number] | null; onRemove?: () => void }) {
  const fees = useGet<CreatorFeesResponse>(`/api/dev/fees/${mint}`, 10000);
  const [busy, setBusy] = useState(false);
  const claimable = Number(fees.data?.claimableSol ?? 0);
  const notMine = !!fees.data && !fees.data.isMine;
  return (
    <div className="card p-4 flex flex-wrap items-center gap-4">
      <TokenImage src={launch?.image ?? null} alt={launch?.symbol ?? "?"} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/dashboard?mint=${mint}`} className="font-semibold hover:text-accent">
            {launch?.symbol ?? short(mint)}
          </Link>
          <span className="text-text-3 truncate">{launch?.name}</span>
        </div>
        <div className="mono text-[13px] text-text-3">
          {short(mint, 6, 6)}
          {fees.data?.creator ? ` · creator ${short(fees.data.creator)}` : ""}
        </div>
        {notMine ? <div className="text-[13px] text-warn mt-1">The creator wallet is not in your vault — read-only.</div> : null}
        {fees.error ? <div className="text-[13px] text-warn mt-1">{failureMessage(fees.error)}</div> : null}
      </div>
      <div className="text-right">
        <div className="label">Claimable</div>
        <div className="mono text-lg font-semibold">{fees.data ? `${sol(fees.data.claimableSol)} SOL` : "—"}</div>
        <div className="hint">{fees.data?.ammPendingSol ? `AMM pending ${sol(fees.data.ammPendingSol)} SOL` : fees.data?.cashbackSol ? `Cashback ${sol(fees.data.cashbackSol)} SOL` : fees.data && Number(fees.data.claimedSol) > 0 ? `Claimed ${sol(fees.data.claimedSol)} SOL so far` : ""}</div>
      </div>
      <Button
        variant="primary"
        busy={busy}
        disabled={!canSign || !(claimable > 0) || notMine}
        title={notMine ? "The creator wallet is not in your vault" : !canSign ? "Unlock the vault first" : !(claimable > 0) ? "Nothing to claim yet" : undefined}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await claimFees({ mint });
            toast(r.error ?? `Claimed ${r.totalSol} SOL`, r.error ? "err" : "ok");
            fees.refresh();
          } catch (e) {
            toast(failureMessage(e), "err");
          } finally {
            setBusy(false);
          }
        }}
      >
        Claim
      </Button>
      {onRemove ? (
        <button className="w-9 h-9 rounded-md text-text-3 hover:text-down hover:bg-white/5 flex items-center justify-center" onClick={onRemove} title="Stop tracking this mint" aria-label="Stop tracking">
          <Icon name="x" size={15} />
        </button>
      ) : null}
    </div>
  );
}
