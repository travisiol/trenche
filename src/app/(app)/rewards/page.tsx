"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Button, Empty, Input, Panel, Spinner, Stat, TokenImage, toast } from "@/components/ui";
import { failureMessage, post, useGet } from "@/lib/api";
import { useVault } from "@/lib/store";
import { dateTime, isMint, short, sol, solscanTx } from "@/lib/format";
import type { ActivityResponse, CreatorFeesResponse, FeesClaimResponse, LaunchesResponse } from "@/lib/ui-types";

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
    <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 p-4 min-h-0">
      <Panel
        glow
        title="Creator fees"
        icon={<Icon3D name="rewards" size={22} />}
        actions={
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isMint(paste)) return;
              const next = Array.from(new Set([...extra, paste.trim()]));
              setExtra(next);
              localStorage.setItem(EXTRA_KEY, JSON.stringify(next));
              setPaste("");
            }}
          >
            <Input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Track any mint…" mono className="h-8 text-xs w-56" />
            <Button size="sm" type="submit" disabled={!isMint(paste)}>
              Add
            </Button>
          </form>
        }
        bodyClassName="p-3 flex flex-col gap-2"
      >
        {launches.error ? <ApiError error={launches.error} retry={launches.refresh} compact /> : null}
        {launches.loading && !launches.data && !mints.length ? (
          <div className="flex items-center gap-2 text-xs text-text-3 p-3">
            <Spinner size={14} /> Loading your launches…
          </div>
        ) : !mints.length ? (
          <Empty icon={<Icon3D name="rewards" size={48} />} title="No token to claim from">
            Every token launched from this app shows its pump.fun creator fees here. Paste any mint whose creator is one of your wallets to track it too.
          </Empty>
        ) : (
          mints.map((m) => (
            <FeeRow
              key={m}
              mint={m}
              canSign={canSign}
              launch={launches.data?.launches.find((l) => l.mint === m) ?? null}
              onRemove={extra.includes(m) ? () => {
                const next = extra.filter((x) => x !== m);
                setExtra(next);
                localStorage.setItem(EXTRA_KEY, JSON.stringify(next));
              } : undefined}
            />
          ))
        )}
      </Panel>

      <Panel title="Claim history" bodyClassName="p-0">
        {claims.error ? (
          <div className="p-3">
            <ApiError error={claims.error} retry={claims.refresh} compact />
          </div>
        ) : !history.length ? (
          <Empty title="No claim yet">Claims are journaled with their signature.</Empty>
        ) : (
          <ul>
            {history.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-3 h-10 border-b border-line/60 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${a.ok ? "bg-up" : "bg-down"}`} />
                <span className="truncate text-text-2 flex-1">{a.message}</span>
                {a.signature ? (
                  <a href={solscanTx(a.signature)} target="_blank" rel="noreferrer" className="mono text-accent hover:underline">
                    {short(a.signature)}
                  </a>
                ) : null}
                <span className="mono text-text-3">{dateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function FeeRow({ mint, canSign, launch, onRemove }: { mint: string; canSign: boolean; launch: LaunchesResponse["launches"][number] | null; onRemove?: () => void }) {
  const fees = useGet<CreatorFeesResponse>(`/api/dev/fees/${mint}`, 10000);
  const [busy, setBusy] = useState(false);
  const claimable = Number(fees.data?.claimableSol ?? 0);
  return (
    <div className="card p-3 flex items-center gap-3">
      <TokenImage src={launch?.image ?? null} alt={launch?.symbol ?? "?"} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/dashboard?mint=${mint}`} className="font-semibold hover:text-accent">
            {launch?.symbol ?? short(mint)}
          </Link>
          <span className="text-text-3 truncate">{launch?.name}</span>
          {fees.data && !fees.data.isMine ? <span className="text-[10px] text-warn">creator not in vault</span> : null}
        </div>
        <div className="mono text-[10px] text-text-3">{short(mint, 6, 6)}{fees.data?.creator ? ` · creator ${short(fees.data.creator)}` : ""}</div>
        {fees.error ? <div className="text-[10px] text-warn mt-1">{failureMessage(fees.error)}</div> : null}
      </div>
      <Stat label="Claimable" value={fees.data ? `${sol(fees.data.claimableSol)} SOL` : "—"} sub={fees.data?.ammPendingSol ? `AMM ${sol(fees.data.ammPendingSol)}` : fees.data?.cashbackSol ? `cashback ${sol(fees.data.cashbackSol)}` : undefined} />
      <Button
        size="sm"
        variant="primary"
        busy={busy}
        disabled={!canSign || !(claimable > 0) || !fees.data?.isMine}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await post<FeesClaimResponse>("/api/dev/fees/claim", { mint });
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
        <Button size="xs" variant="ghost" className="text-text-3" onClick={onRemove} title="Stop tracking">
          ×
        </Button>
      ) : null}
    </div>
  );
}
