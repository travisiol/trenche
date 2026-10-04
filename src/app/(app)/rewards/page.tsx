"use client";
/** Block X /rewards: tabs Fees (Referrals omitted), launchpad chips (Pump.fun only), "Choose a launchpad" card, then fee rows + Claim. */
import Link from "next/link";
import { useState } from "react";
import { Gift, Plus, X } from "lucide-react";
import type { ActivityResponse, AutoClaimStatus, CreatorFeesResponse, LaunchesResponse, TokenInfo } from "@/lib/types";
import { claimFees, failureMessage, post, useGet } from "@/lib/api";
import { useVault } from "@/lib/store";
import { dateTime, isMint, short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxInput, PadAvatar, cx } from "@/components/bx/ui";
import { TxLink } from "@/components/bx/Job";

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
  const [pad, setPad] = useState<"pumpfun" | null>(null);
  const [extra, setExtra] = useState<string[]>(() => (typeof window === "undefined" ? [] : readExtra()));
  const [paste, setPaste] = useState("");
  const canSign = vault.data?.unlocked ?? false;
  const mints = Array.from(new Set([...(launches.data?.launches ?? []).map((l) => l.mint), ...extra]));
  // manual claims are journaled as "fees", the auto-claim watcher as "claim"
  const history = (claims.data?.items ?? []).filter((a) => /^(claim|fees)$/i.test(a.kind));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 xl:px-8">
        <div className="flex items-center gap-6">
          <button type="button" className="text-xl font-semibold text-text-100">
            Fees
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPad(pad ? null : "pumpfun")} className={cx("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors", pad === "pumpfun" ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200 hover:border-line-200 hover:text-text-100")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
            <img src="/launchpads/pumpfun.svg" alt="" className="h-4 w-4" />
            Pump.fun
          </button>
        </div>

        {!pad ? (
          <div className="flex justify-center py-10">
            <div className="flex w-full max-w-[320px] flex-col items-center gap-3 rounded-lg border border-line-100 bg-bg-50 px-6 py-8 text-center shadow-lg">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line-100 bg-bg-100">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                  <img src="/launchpads/pumpfun.svg" alt="" className="h-4 w-4" />
                </span>
              </div>
              <p className="text-sm font-semibold text-text-100">Choose a launchpad</p>
              <p className="text-xs leading-relaxed text-text-300">Select one above to scan your managed wallets and view available rewards</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="overflow-hidden rounded-lg border border-line-100 bg-bg-50">
              <div className="flex h-[52px] items-center justify-between gap-2 px-5">
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-accent" />
                  <h2 className="text-[16px] font-medium tracking-[-0.02em] text-text-100">Pump.fun creator fees</h2>
                </div>
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!isMint(paste)) return;
                    const next = Array.from(new Set([...extra, paste.trim()]));
                    setExtra(next);
                    localStorage.setItem(EXTRA_KEY, JSON.stringify(next));
                    setPaste("");
                  }}
                >
                  <BxInput value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Track a mint address…" className="h-8 w-64 font-mono text-xs" />
                  <BxButton type="submit" size="sm" disabled={!isMint(paste)}>
                    <Plus className="h-3.5 w-3.5" /> Track
                  </BxButton>
                </form>
              </div>
              <div className="flex flex-col gap-2 px-3 pb-3">
                {launches.error ? <p className="px-2 py-4 text-xs text-decrease">{failureMessage(launches.error)}</p> : null}
                {launches.loading && !launches.data && !mints.length ? (
                  <p className="px-2 py-6 text-center text-xs text-text-300">Scanning your launches…</p>
                ) : !mints.length ? (
                  <p className="px-2 py-6 text-center text-xs text-text-300">No token to claim from yet. Every token launched from DONCHAIN shows its creator fees here; paste any mint whose creator is one of your wallets to track it too.</p>
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
              </div>
            </section>
            <section className="overflow-hidden rounded-lg border border-line-100 bg-bg-50">
              <div className="flex h-[52px] items-center px-5">
                <h2 className="text-[16px] font-medium tracking-[-0.02em] text-text-100">Claim history</h2>
              </div>
              {!history.length ? (
                <p className="px-5 pb-6 text-xs text-text-300">No claim yet.</p>
              ) : (
                <ul className="px-3 pb-3">
                  {history.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 border-b border-line-50 py-2 text-xs last:border-0">
                      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", a.ok ? "bg-green-100" : "bg-decrease")} />
                      <span className="min-w-0 flex-1 truncate text-text-200">{a.message}</span>
                      {a.signature ? <TxLink sig={a.signature} /> : null}
                      <span className="font-mono text-[11px] text-text-300">{dateTime(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function FeeRow({ mint, canSign, launch, onRemove }: { mint: string; canSign: boolean; launch: LaunchesResponse["launches"][number] | null; onRemove?: () => void }) {
  const fees = useGet<CreatorFeesResponse>(`/api/dev/fees/${mint}`, 10000);
  // a tracked mint (not launched here) takes its image / symbol / name from the token metadata
  const meta = useGet<TokenInfo>(launch ? null : `/api/token/${mint}`, 0);
  const image = launch?.image ?? meta.data?.image ?? null;
  const symbol = launch?.symbol ?? meta.data?.symbol ?? null;
  const name = launch?.name ?? meta.data?.name ?? null;
  const [busy, setBusy] = useState(false);
  const [lastErr, setLastErr] = useState<string | null>(null);
  const claimable = Number(fees.data?.claimableSol ?? 0);
  const notMine = !!fees.data && !fees.data.isMine;
  // the auto-claim watcher of this mint (server memory, no RPC): "auto-claim on/off", click to toggle
  const ac = useGet<AutoClaimStatus>(`/api/dev/autoclaim?mint=${mint}`, 10000);
  const [acBusy, setAcBusy] = useState(false);
  const toggleAuto = async () => {
    if (!ac.data) return;
    setAcBusy(true);
    try {
      await post(`/api/dev/autoclaim?mint=${mint}`, { action: ac.data.enabled ? "disarm" : ac.data.resumable ? "resume" : "arm" });
      ac.refresh();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setAcBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-100 bg-bg-100 px-3 py-2.5">
      <PadAvatar src={image} alt={symbol ?? "?"} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/trade/${mint}`} className="font-medium text-text-100 hover:text-accent">
            {symbol ?? short(mint)}
          </Link>
          <span className="truncate text-text-300">{name}</span>
        </div>
        <div className="font-mono text-[11px] text-text-300">
          {short(mint, 6, 6)}
          {fees.data?.creator ? ` · creator ${short(fees.data.creator)}` : ""}
        </div>
        {notMine ? <div className="text-[11px] text-yellow-100">Creator wallet not in your vault — read-only.</div> : null}
        {fees.error ? <div className="text-[11px] text-decrease">{failureMessage(fees.error)}</div> : null}
        {lastErr ? (
          <div className="text-[11px] text-decrease" title={lastErr}>
            Last claim: {lastErr}
          </div>
        ) : null}
        {ac.data?.enabled && ac.data.error ? (
          <div className="truncate text-[11px] text-yellow-100" title={ac.data.error}>
            Auto-claim: {ac.data.error}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={toggleAuto}
        disabled={acBusy || !ac.data || (notMine && !ac.data?.enabled) || (!canSign && !ac.data?.enabled)}
        className={cx("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", ac.data?.enabled ? "border-green-100/40 bg-green-100/10 text-green-100" : ac.data?.resumable ? "border-yellow-100/40 bg-yellow-100/10 text-yellow-100" : "border-line-100 bg-bg-50 text-text-300 hover:text-text-100")}
        title={ac.data?.enabled ? `Auto-claim on: the creator vault is read every ${ac.data.intervalSec}s and claimed to the dev wallet once ≥ ${ac.data.minSol} SOL — click to disarm` : ac.data?.resumable ? "Auto-claim paused by a server restart — click to resume" : notMine ? "The creator wallet is not in your vault" : !canSign ? "Unlock the vault first" : "Auto-claim off — click to arm (fees → dev wallet by themselves)"}
      >
        <span className={cx("h-1.5 w-1.5 rounded-full", ac.data?.enabled ? "bg-green-100" : ac.data?.resumable ? "bg-yellow-100" : "bg-text-300")} />
        auto-claim {!ac.data ? "…" : ac.data.enabled ? "on" : ac.data.resumable ? "paused" : "off"}
        {ac.data && Number(ac.data.claimedSol) > 0 ? <span className="font-mono text-text-300">· {sol(ac.data.claimedSol)} claimed</span> : null}
      </button>
      <div className="flex h-10 items-center gap-2.5 rounded-lg border border-line-100 bg-bg-50 px-3">
        <span className="text-base font-medium tabular-nums text-text-100">{fees.data ? sol(fees.data.claimableSol) : "—"}</span>
        <span className="text-[12px] font-medium text-text-200">SOL pending</span>
      </div>
      <BxButton
        variant="primary"
        size="sm"
        disabled={busy || !canSign || !(claimable > 0) || notMine}
        title={notMine ? "The creator wallet is not in your vault" : !canSign ? "Unlock the vault first" : !(claimable > 0) ? "Nothing to claim yet" : undefined}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await claimFees({ mint });
            setLastErr(r.error);
            toast(r.error ?? `Claimed ${r.totalSol} SOL → dev wallet`, r.error ? "err" : "ok");
            fees.refresh();
          } catch (e) {
            setLastErr(failureMessage(e));
            toast(failureMessage(e), "err");
          } finally {
            setBusy(false);
          }
        }}
      >
        Claim
      </BxButton>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="flex h-7 w-7 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-decrease" title="Stop tracking" aria-label="Stop tracking">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
