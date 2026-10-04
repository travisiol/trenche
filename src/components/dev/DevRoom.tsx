"use client";
/**
 * Dev room — the token console for one mint (Dashboard, also embedded as "Positions" on /trade).
 * Everything polls every 2 s: curve state, positions of every vault wallet, creator fees,
 * volume bot and auto-dump status. Signing actions require the vault to be unlocked.
 */
import Link from "next/link";
import { useState } from "react";
import type { AutoDumpStatus, CreatorFeesResponse, DashboardResponse, FeesClaimResponse, JobCreated, PositionsResponse, TokenInfo, VolumeStatus, WalletInfo } from "@/lib/ui-types";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useVault, useWallets } from "@/lib/store";
import { age, pct, pumpfunUrl, short, signedSol, sol, solscanAccount, usd } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { ApiError, Button, Capsule, Copy, Dot, Field, InlineError, Input, Modal, Progress, Select, Spinner, Stat, TokenImage, Toggle, cx, toast } from "../ui";
import { JobProgress } from "../JobProgress";
import { Activity } from "../portfolio/Holdings";
import { TaskRowCompact } from "./TaskRowCompact";

export function TokenHeader({ mint, token, error, retry }: { mint: string; token: TokenInfo | null; error: unknown; retry: () => void }) {
  if (error && !token) return <ApiError error={error} retry={retry} compact />;
  if (!token)
    return (
      <div className="flex items-center gap-2 text-xs text-text-3">
        <Spinner size={14} /> Reading {short(mint)}…
      </div>
    );
  const c = token.curve;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <TokenImage src={token.image} alt={token.symbol ?? "?"} size={48} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{token.symbol ?? short(mint)}</span>
          <span className="text-text-3 truncate">{token.name}</span>
          {token.complete ? <Capsule tone="up">Migrated</Capsule> : c ? <Capsule tone="accent">Bonding</Capsule> : <Capsule tone="warn">No curve</Capsule>}
        </div>
        <div className="flex items-center gap-3 text-[11px] mt-0.5">
          <Copy text={mint}>{short(mint, 6, 6)}</Copy>
          <a href={pumpfunUrl(mint)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            pump.fun
          </a>
          <a href={token.links?.solscan ?? solscanAccount(mint)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            solscan
          </a>
          {token.creator ? <span className="text-text-3">creator <span className="mono">{short(token.creator)}</span></span> : null}
          {token.createdAt ? <span className="text-text-3">{age(token.createdAt)} old</span> : null}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-6">
        <Stat label="Market cap" value={c ? (c.marketCapUsd !== null ? usd(c.marketCapUsd) : `${sol(c.marketCapSol)} SOL`) : "—"} sub={c && c.marketCapUsd !== null ? `${sol(c.marketCapSol)} SOL` : undefined} />
        <div className="min-w-[120px]">
          <div className="label">Bonded {c ? `${c.progress.toFixed(1)} %` : "—"}</div>
          <Progress value={c?.progress ?? 0} className="mt-2" />
        </div>
        <Stat label="Real reserves" value={c ? `${sol(Number(c.realSolReserves) / 1e9)} SOL` : "—"} />
      </div>
    </div>
  );
}

export function DevRoom({ mint, embedded, activeTasks }: { mint: string; embedded?: boolean; activeTasks?: DashboardResponse["activeTasks"] }) {
  const token = useGet<TokenInfo>(`/api/token/${mint}`, 2000);
  const positions = useGet<PositionsResponse>(`/api/positions?mints=${mint}`, 2000);
  const vault = useVault();
  const wallets = useWallets();
  const settings = useSettings();
  const canSign = vault.data?.unlocked ?? false;
  const pos = positions.data?.find((p) => p.mint === mint) ?? null;
  const rows = (pos?.wallets ?? []).filter((w) => Number(w.amount) > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dump, setDump] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const sel = rows.filter((r) => selected.has(r.address)).map((r) => r.address);
  const targets = sel.length ? sel : rows.map((r) => r.address);
  const totalPct = rows.reduce((n, r) => n + (r.supplyPct ?? 0), 0);
  const myTasks = (activeTasks ?? []).filter((t) => t.mint === mint);

  const sell = async (percent: number) => {
    if (!targets.length) return;
    setBusy(`sell${percent}`);
    try {
      const r = await post<JobCreated>("/api/trade/sell", { mint, wallets: targets, percent, slippageBps: settings.data?.slippageBps ?? 2000 });
      setJobId(r.jobId);
      toast(`Selling ${percent} % on ${targets.length} wallet(s)`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {!embedded ? <TokenHeader mint={mint} token={token.data} error={token.error} retry={token.refresh} /> : null}

      {/* positions */}
      <section className="panel flex flex-col">
        <header className="flex items-center gap-2 px-4 h-11 border-b border-line">
          <Icon3D name="portfolio" size={20} />
          <h3 className="text-[13px] font-semibold">My positions</h3>
          <span className="mono text-[11px] text-text-3">
            {rows.length} wallet{rows.length !== 1 ? "s" : ""} · {pct(totalPct, 2)} of supply · {sol(pos?.valueSol)} SOL
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] text-text-3 mr-1">{sel.length ? `${sel.length} selected` : "all wallets"}</span>
            {[25, 50, 100].map((n) => (
              <Button key={n} size="xs" variant="down" busy={busy === `sell${n}`} disabled={!canSign || !targets.length} onClick={() => sell(n)} className="!bg-down-soft !text-down border border-down/30 hover:!bg-down/25">
                Sell {n} %
              </Button>
            ))}
            <Button size="xs" variant="down" disabled={!canSign || !rows.length} onClick={() => setDump(true)}>
              Dump all
            </Button>
          </span>
        </header>
        <div className="p-0">
          {positions.error ? (
            <div className="p-3">
              <ApiError error={positions.error} retry={positions.refresh} compact />
            </div>
          ) : positions.loading && !positions.data ? (
            <div className="flex items-center gap-2 text-xs text-text-3 p-4">
              <Spinner size={14} /> Reading token accounts of every wallet…
            </div>
          ) : !rows.length ? (
            <p className="text-xs text-text-3 p-4">None of your wallets holds this token.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="label text-left">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" className="accent-accent" checked={sel.length === rows.length && rows.length > 0} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.address)) : new Set())} />
                  </th>
                  <th className="font-medium px-3 py-2">Wallet</th>
                  <th className="font-medium px-3 py-2 text-right">Tokens</th>
                  <th className="font-medium px-3 py-2 text-right">Supply</th>
                  <th className="font-medium px-3 py-2 text-right">Value</th>
                  <th className="font-medium px-3 py-2 text-right">Cost</th>
                  <th className="font-medium px-3 py-2 text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pnl = Number(r.pnlSol);
                  const on = selected.has(r.address);
                  return (
                    <tr
                      key={r.address}
                      className={cx("h-10 border-b border-line/60 cursor-pointer", on ? "bg-accent-soft" : "hover:bg-white/[0.02]")}
                      onClick={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(r.address)) n.delete(r.address);
                          else n.add(r.address);
                          return n;
                        })
                      }
                    >
                      <td className="px-3">
                        <input type="checkbox" className="accent-accent" checked={on} readOnly />
                      </td>
                      <td className="px-3">
                        <span className="font-medium">{r.label || short(r.address)}</span> {r.isDev ? <Capsule tone="accent" className="ml-1">dev</Capsule> : null}
                        <div className="mono text-[10px] text-text-3">{short(r.address, 6, 6)}</div>
                      </td>
                      <td className="px-3 text-right mono">{sol(r.amount, 0)}</td>
                      <td className="px-3 text-right mono text-text-2">{pct(r.supplyPct, 2)}</td>
                      <td className="px-3 text-right mono">{sol(r.valueSol)}</td>
                      <td className="px-3 text-right mono text-text-3">{sol(r.costSol)}</td>
                      <td className={cx("px-3 text-right mono", pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "")}>{signedSol(r.pnlSol)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {jobId ? (
            <div className="p-3 border-t border-line">
              <JobProgress jobId={jobId} compact />
            </div>
          ) : null}
        </div>
      </section>

      {myTasks.length ? (
        <section className="panel">
          <header className="flex items-center gap-2 px-4 h-11 border-b border-line">
            <Icon3D name="volume" size={20} />
            <h3 className="text-[13px] font-semibold">Active tasks</h3>
          </header>
          <div className="p-2 flex flex-col gap-1.5">
            {myTasks.map((t) => (
              <TaskRowCompact key={t.task.id} launchId={t.launchId} t={t.task} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CreatorFees mint={mint} canSign={canSign} />
        <VolumeBot mint={mint} canSign={canSign} wallets={(wallets.data?.wallets ?? []).filter((w) => !w.archived)} groups={wallets.data?.groups ?? []} />
        <AutoDump mint={mint} canSign={canSign} />
      </div>

      {!embedded ? (
        <section className="panel flex flex-col">
          <header className="flex items-center gap-2 px-4 h-11 border-b border-line">
            <h3 className="text-[13px] font-semibold">Transactions</h3>
            <Link href={`/trade/${mint}`} className="ml-auto text-[11px] text-accent hover:underline">
              Open trade page →
            </Link>
          </header>
          <Activity limit={40} mint={mint} />
        </section>
      ) : null}

      <DumpModal open={dump} onClose={() => setDump(false)} mint={mint} wallets={rows.map((r) => r.address)} symbol={token.data?.symbol ?? null} onJob={setJobId} />
    </div>
  );
}

function DumpModal({ open, onClose, mint, wallets, symbol, onJob }: { open: boolean; onClose: () => void; mint: string; wallets: string[]; symbol: string | null; onJob: (id: string) => void }) {
  const [bundle, setBundle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const settings = useSettings();
  return (
    <Modal open={open} onClose={onClose} title="Dump all" width={420}>
      <p className="text-xs text-text-2">
        Sell <b>100 %</b> of {symbol ?? short(mint)} from <b>{wallets.length}</b> wallet{wallets.length !== 1 ? "s" : ""} at once. This cannot be undone.
      </p>
      <Toggle checked={bundle} onChange={setBundle} label="Send as one Jito bundle (atomic, tip applies)" />
      <InlineError>{err}</InlineError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="down"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await post<JobCreated>("/api/dev/dump", { mint, wallets, percent: 100, bundle, slippageBps: settings.data?.slippageBps ?? 2000, tipSol: bundle ? settings.data?.tipSol : undefined });
              onJob(r.jobId);
              toast("Dump sent", "info");
              onClose();
            } catch (e) {
              setErr(failureMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Dump {wallets.length} wallet{wallets.length !== 1 ? "s" : ""}
        </Button>
      </div>
    </Modal>
  );
}

function CreatorFees({ mint, canSign }: { mint: string; canSign: boolean }) {
  const fees = useGet<CreatorFeesResponse>(`/api/dev/fees/${mint}`, 5000);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<FeesClaimResponse | null>(null);
  const claimable = Number(fees.data?.claimableSol ?? 0);
  return (
    <section className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon3D name="rewards" size={22} />
        <h3 className="text-[13px] font-semibold">Creator fees</h3>
        {fees.data && !fees.data.isMine ? <span className="ml-auto text-[10px] text-text-3">creator is not in the vault</span> : null}
      </div>
      {fees.error ? <ApiError error={fees.error} retry={fees.refresh} compact /> : null}
      <div className="flex items-end gap-4">
        <Stat big label="Claimable" value={fees.data ? `${sol(fees.data.claimableSol)} SOL` : "—"} sub={fees.data?.cashbackSol ? `cashback ${sol(fees.data.cashbackSol)}` : fees.data?.ammPendingSol ? `AMM pending ${sol(fees.data.ammPendingSol)}` : undefined} />
        <Button
          size="sm"
          variant="primary"
          className="ml-auto"
          busy={busy}
          disabled={!canSign || !(claimable > 0) || !fees.data?.isMine}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await post<FeesClaimResponse>("/api/dev/fees/claim", { mint });
              setRes(r);
              fees.refresh();
              toast(r.error ? r.error : `Claimed ${r.totalSol} SOL`, r.error ? "err" : "ok");
            } catch (e) {
              toast(failureMessage(e), "err");
            } finally {
              setBusy(false);
            }
          }}
        >
          Claim
        </Button>
      </div>
      {res ? (
        <div className="text-[11px] text-text-3">
          {res.confirmed}/{res.signatures.length} confirmed{res.error ? ` · ${res.error}` : ""}
        </div>
      ) : null}
    </section>
  );
}

function VolumeBot({ mint, canSign, wallets, groups }: { mint: string; canSign: boolean; wallets: WalletInfo[]; groups: { id: string; name: string }[] }) {
  const status = useGet<VolumeStatus>(`/api/dev/volume?mint=${mint}`, 2000);
  const [group, setGroup] = useState("");
  const [minSol, setMin] = useState("0.05");
  const [maxSol, setMax] = useState("0.15");
  const [minDelay, setMinD] = useState("500");
  const [maxDelay, setMaxD] = useState("2000");
  const [rounds, setRounds] = useState("20");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const running = status.data?.running ?? false;
  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await post<VolumeStatus>("/api/dev/volume", body);
      status.refresh();
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const groupSize = wallets.filter((w) => w.group === group).length;
  return (
    <section className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon3D name="volume" size={22} />
        <h3 className="text-[13px] font-semibold">Volume bot</h3>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-3">
          <Dot tone={running ? "up" : "muted"} pulse={running} /> {running ? `round ${status.data?.round}/${status.data?.rounds}` : "stopped"}
        </span>
      </div>
      {status.error ? <ApiError error={status.error} retry={status.refresh} compact /> : null}
      {running ? (
        <>
          {status.data?.jobId ? <JobProgress jobId={status.data.jobId} compact /> : null}
          <Button variant="danger" size="sm" busy={busy} onClick={() => call({ action: "stop", mint })}>
            Stop
          </Button>
        </>
      ) : (
        <>
          <Field label="Wallets">
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Choose a group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({wallets.filter((w) => w.group === g.id).length})
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.01" value={minSol} onChange={(e) => setMin(e.target.value)} mono suffix="min SOL" />
            <Input type="number" step="0.01" value={maxSol} onChange={(e) => setMax(e.target.value)} mono suffix="max SOL" />
            <Input type="number" value={minDelay} onChange={(e) => setMinD(e.target.value)} mono suffix="min ms" />
            <Input type="number" value={maxDelay} onChange={(e) => setMaxD(e.target.value)} mono suffix="max ms" />
          </div>
          <Input type="number" min={1} value={rounds} onChange={(e) => setRounds(e.target.value)} mono suffix="rounds" />
          <InlineError>{err}</InlineError>
          <Button variant="auto" size="sm" busy={busy} disabled={!canSign || !group || !groupSize} onClick={() => call({ action: "start", mint, group, minSol, maxSol, minDelayMs: Number(minDelay), maxDelayMs: Number(maxDelay), rounds: Number(rounds) })}>
            Start on {groupSize || 0} wallet{groupSize !== 1 ? "s" : ""}
          </Button>
        </>
      )}
    </section>
  );
}

function AutoDump({ mint, canSign }: { mint: string; canSign: boolean }) {
  const status = useGet<AutoDumpStatus>(`/api/dev/autodump?mint=${mint}`, 2000);
  const [percent, setPercent] = useState("100");
  const [mcUsd, setMc] = useState("");
  const [afterSec, setAfter] = useState("");
  const [bundle, setBundle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const armed = status.data?.armed ?? false;
  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await post<AutoDumpStatus>("/api/dev/autodump", body);
      status.refresh();
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon3D name="autodump" size={22} />
        <h3 className="text-[13px] font-semibold">Auto-dump</h3>
        <span className="ml-auto flex items-center gap-1.5 text-[11px]">
          <Dot tone={armed ? "warn" : "muted"} pulse={armed} /> <span className={armed ? "text-warn" : "text-text-3"}>{armed ? "armed" : "off"}</span>
        </span>
      </div>
      {status.error ? <ApiError error={status.error} retry={status.refresh} compact /> : null}
      {armed && status.data ? (
        <>
          <div className="text-xs text-text-2">
            Sell {status.data.config?.percent} %{status.data.config?.mcUsd ? ` when MC ≥ ${usd(status.data.config.mcUsd)}` : ""}
            {status.data.config?.afterSec ? ` after ${status.data.config.afterSec}s` : ""}
            {status.data.lastMcUsd !== null ? <span className="text-text-3"> · now {usd(status.data.lastMcUsd)}</span> : null}
            {status.data.firedAt ? <span className="text-up"> · fired</span> : null}
          </div>
          {status.data.jobId ? <JobProgress jobId={status.data.jobId} compact /> : null}
          <Button variant="danger" size="sm" busy={busy} onClick={() => call({ action: "disarm", mint })}>
            Disarm
          </Button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} mono suffix="%" />
            <Input type="number" min={0} value={mcUsd} onChange={(e) => setMc(e.target.value)} mono suffix="MC $" placeholder="—" />
            <Input type="number" min={0} value={afterSec} onChange={(e) => setAfter(e.target.value)} mono suffix="s" placeholder="—" />
          </div>
          <Toggle checked={bundle} onChange={setBundle} label="Jito bundle" />
          <InlineError>{err}</InlineError>
          <Button variant="warn" size="sm" busy={busy} disabled={!canSign || (!(Number(mcUsd) > 0) && !(Number(afterSec) > 0))} onClick={() => call({ action: "arm", mint, percent: Number(percent), mcUsd: Number(mcUsd) > 0 ? Number(mcUsd) : undefined, afterSec: Number(afterSec) > 0 ? Number(afterSec) : undefined, bundle })}>
            Arm
          </Button>
        </>
      )}
    </section>
  );
}
