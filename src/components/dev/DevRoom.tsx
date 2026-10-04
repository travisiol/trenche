"use client";
/**
 * Dev room — the token console for one mint (Dashboard, also embedded as "Positions" on /trade).
 * Everything polls every 2 s: curve state, positions of every vault wallet, creator fees,
 * volume bot and auto-dump status. Signing actions require the vault to be unlocked.
 */
import Link from "next/link";
import { useState } from "react";
import type { AutoDumpStatus, CreatorFeesResponse, DashboardResponse, JobCreated, PositionsResponse, TokenInfo, VolumeStatus, WalletInfo } from "@/lib/types";
import { failureMessage, post, useGet, claimFees, type ClaimResult } from "@/lib/api";
import { groupPositions } from "@/lib/positions";
import { useSettings, useVault, useWallets } from "@/lib/store";
import { age, pct, pumpfunUrl, short, signedSol, sol, solscanAccount, usd } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { Icon } from "../icons";
import { ApiError, Button, Capsule, Copy, CostLine, Dot, Field, InlineError, Input, KV, Loading, Modal, Note, Progress, Section, Select, Spinner, TokenImage, Toggle, cx, toast } from "../ui";
import { JobProgress } from "../JobProgress";
import { Activity } from "../portfolio/Holdings";
import { TaskRowCompact } from "./TaskRowCompact";

export function TokenHeader({ mint, token, error, retry }: { mint: string; token: TokenInfo | null; error: unknown; retry: () => void }) {
  if (error && !token) return <ApiError error={error} retry={retry} compact />;
  if (!token)
    return (
      <div className="flex items-center gap-2 text-sm text-text-3">
        <Spinner size={14} /> Reading {short(mint)}…
      </div>
    );
  const c = token.curve;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <TokenImage src={token.image} alt={token.symbol ?? "?"} size={56} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold">{token.symbol ?? short(mint)}</span>
            <span className="text-text-2 truncate">{token.name}</span>
            {token.complete ? <Capsule tone="up">Migrated</Capsule> : c ? <Capsule tone="accent">Bonding</Capsule> : <Capsule tone="warn">No curve</Capsule>}
          </div>
          <div className="flex items-center gap-4 text-[13px] mt-1 flex-wrap">
            <Copy text={mint}>{short(mint, 6, 6)}</Copy>
            <a href={pumpfunUrl(mint)} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              pump.fun <Icon name="external" size={12} />
            </a>
            <a href={token.links?.solscan ?? solscanAccount(mint)} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              solscan <Icon name="external" size={12} />
            </a>
            {token.creator ? (
              <span className="text-text-3">
                Creator <span className="mono text-text-2">{short(token.creator)}</span>
              </span>
            ) : null}
            {token.createdAt ? <span className="text-text-3">Created {age(token.createdAt)} ago</span> : null}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KV label="Market cap" value={c ? (c.marketCapUsd !== null ? usd(c.marketCapUsd) : `${sol(c.marketCapSol)} SOL`) : "—"} />
        <KV label="Market cap in SOL" value={c ? `${sol(c.marketCapSol)} SOL` : "—"} />
        <div className="min-w-0">
          <div className="label">Bonded</div>
          <div className="flex items-center gap-2 mt-1">
            <Progress value={c?.progress ?? 0} className="flex-1" />
            <span className="mono text-sm font-medium w-14 text-right">{c ? `${c.progress.toFixed(1)} %` : "—"}</span>
          </div>
        </div>
        <KV label="SOL in the curve" value={c ? `${sol(Number(c.realSolReserves) / 1e9)} SOL` : "—"} />
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
  const pos = groupPositions(positions.data).find((p) => p.mint === mint) ?? null;
  const rows = (pos?.wallets ?? []).filter((w) => Number(w.amount) > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dump, setDump] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const sel = rows.filter((r) => selected.has(r.address)).map((r) => r.address);
  const targets = sel.length ? sel : rows.map((r) => r.address);
  const targetValue = rows.filter((r) => targets.includes(r.address)).reduce((n, r) => n + Number(r.valueSol), 0);
  const totalPct = rows.reduce((n, r) => n + (r.supplyPct ?? 0), 0);
  const myTasks = (activeTasks ?? []).filter((t) => t.mint === mint);

  const sell = async (percent: number) => {
    if (!targets.length) return;
    setBusy(`sell${percent}`);
    try {
      const r = await post<JobCreated>("/api/trade/sell", { mint, wallets: targets, percent, slippageBps: settings.data?.slippageBps ?? 2000 });
      setJobId(r.jobId);
      toast(`Selling ${percent} % on ${targets.length} wallet${targets.length !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {!embedded ? <TokenHeader mint={mint} token={token.data} error={token.error} retry={token.refresh} /> : null}

      {/* positions */}
      <Section
        title="Positions"
        description={`Every vault wallet holding this token${rows.length ? ` — ${rows.length} wallet${rows.length !== 1 ? "s" : ""}, ${pct(totalPct, 2)} of supply, worth ${sol(pos?.valueSol)} SOL` : ""}. Tick rows to sell only those.`}
      >
        <div className="panel overflow-hidden">
          {positions.error ? (
            <div className="p-3">
              <ApiError error={positions.error} retry={positions.refresh} compact />
            </div>
          ) : positions.loading && !positions.data ? (
            <Loading>Reading the token accounts of every wallet…</Loading>
          ) : !rows.length ? (
            <p className="text-sm text-text-2 p-4">None of your wallets holds this token.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input type="checkbox" className="accent-accent w-4 h-4" aria-label="Select every wallet" checked={sel.length === rows.length && rows.length > 0} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.address)) : new Set())} />
                    </th>
                    <th>Wallet</th>
                    <th className="r">Tokens</th>
                    <th className="r">Supply</th>
                    <th className="r">Value</th>
                    <th className="r">Cost</th>
                    <th className="r">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pnl = Number(r.pnlSol);
                    const on = selected.has(r.address);
                    return (
                      <tr
                        key={r.address}
                        className={cx("cursor-pointer", on ? "bg-accent-soft" : "hover:bg-white/[0.02]")}
                        onClick={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(r.address)) n.delete(r.address);
                            else n.add(r.address);
                            return n;
                          })
                        }
                      >
                        <td>
                          <input type="checkbox" className="accent-accent w-4 h-4" checked={on} readOnly aria-label={`Select ${r.label || short(r.address)}`} />
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{r.label || short(r.address)}</span>
                            {r.isDev ? <Capsule tone="accent">dev</Capsule> : null}
                          </div>
                          <div className="mono text-[13px] text-text-3">{short(r.address, 6, 6)}</div>
                        </td>
                        <td className="r">{sol(r.amount, 0)}</td>
                        <td className="r text-text-2">{pct(r.supplyPct, 2)}</td>
                        <td className="r">{sol(r.valueSol)} SOL</td>
                        <td className="r text-text-3">{sol(r.costSol)} SOL</td>
                        <td className={cx("r", pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "")}>{signedSol(r.pnlSol)} SOL</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {/* sell */}
      <Section title="Sell" description={sel.length ? `Applies to the ${sel.length} selected wallet${sel.length !== 1 ? "s" : ""}.` : "Nothing selected: applies to every wallet above."}>
        <div className="flex flex-wrap items-center gap-2">
          {[25, 50, 100].map((n) => (
            <Button key={n} variant="danger" busy={busy === `sell${n}`} disabled={!canSign || !targets.length} onClick={() => sell(n)}>
              Sell {n} %
            </Button>
          ))}
          <Button variant="down" icon="zap" disabled={!canSign || !rows.length} onClick={() => setDump(true)} className="sm:ml-auto">
            Dump all
          </Button>
        </div>
        {targets.length ? (
          <CostLine
            rows={[
              { label: `Selling from ${targets.length} wallet${targets.length !== 1 ? "s" : ""}`, value: `≈ ${sol(targetValue)} SOL at 100 %` },
              { label: "Slippage", value: `${(settings.data?.slippageBps ?? 2000) / 100} %` },
            ]}
            note="Estimate from the current curve price; each sell is signed by its own wallet."
          />
        ) : null}
        {!canSign ? <Note tone="warn">Unlock the vault to sell.</Note> : null}
        {jobId ? <JobProgress jobId={jobId} /> : null}
      </Section>

      {myTasks.length ? (
        <Section title="Active tasks" description="Launch tasks still running on this token.">
          <div className="flex flex-col gap-2">
            {myTasks.map((t) => (
              <TaskRowCompact key={t.task.id} launchId={t.launchId} t={t.task} />
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CreatorFees mint={mint} canSign={canSign} />
        <VolumeBot mint={mint} canSign={canSign} wallets={(wallets.data?.wallets ?? []).filter((w) => !w.archived)} groups={wallets.data?.groups ?? []} />
        <AutoDump mint={mint} canSign={canSign} />
      </div>

      {!embedded ? (
        <Section
          title="Transactions"
          description="Every send, buy, sell and claim on this token from this app, with its signature."
          actions={
            <Link href={`/trade/${mint}`} className="text-sm text-accent hover:underline inline-flex items-center gap-1">
              Open the trade page <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          <div className="panel overflow-hidden">
            <Activity limit={40} mint={mint} />
          </div>
        </Section>
      ) : null}

      <DumpModal open={dump} onClose={() => setDump(false)} mint={mint} wallets={rows.map((r) => r.address)} symbol={token.data?.symbol ?? null} valueSol={rows.reduce((n, r) => n + Number(r.valueSol), 0)} onJob={setJobId} />
    </div>
  );
}

function DumpModal({ open, onClose, mint, wallets, symbol, valueSol, onJob }: { open: boolean; onClose: () => void; mint: string; wallets: string[]; symbol: string | null; valueSol: number; onJob: (id: string) => void }) {
  const [bundle, setBundle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const settings = useSettings();
  return (
    <Modal open={open} onClose={onClose} title="Dump all" description={`Sell 100 % of ${symbol ?? short(mint)} from ${wallets.length} wallet${wallets.length !== 1 ? "s" : ""} at once. This cannot be undone.`} width={440}>
      <Toggle checked={bundle} onChange={setBundle} label="Send as one Jito bundle (all sells land together, tip applies)" />
      <CostLine
        rows={[
          { label: "Current value", value: `≈ ${sol(valueSol)} SOL` },
          { label: "Slippage", value: `${(settings.data?.slippageBps ?? 2000) / 100} %` },
          ...(bundle ? [{ label: "Jito tip", value: `${settings.data?.tipSol ?? "—"} SOL` }] : []),
        ]}
        note="Estimate at the current curve price; the price moves as each wallet sells."
      />
      <InlineError>{err}</InlineError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="down"
          icon="zap"
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

function SubCard({ icon, title, description, status, children }: { icon: "rewards" | "volume" | "autodump"; title: string; description: string; status?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Icon3D name={icon} size={24} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="hint">{description}</p>
        </div>
        {status ? <span className="shrink-0 text-[13px]">{status}</span> : null}
      </div>
      {children}
    </section>
  );
}

function CreatorFees({ mint, canSign }: { mint: string; canSign: boolean }) {
  const fees = useGet<CreatorFeesResponse>(`/api/dev/fees/${mint}`, 5000);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ClaimResult | null>(null);
  const claimable = Number(fees.data?.claimableSol ?? 0);
  return (
    <SubCard icon="rewards" title="Creator fees" description="pump.fun pays the creator a share of every trade. Claim sends it to the creator wallet.">
      {fees.error ? <ApiError error={fees.error} retry={fees.refresh} compact /> : null}
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="label">Claimable</div>
          <div className="mono text-2xl font-semibold mt-0.5">{fees.data ? `${sol(fees.data.claimableSol)} SOL` : "—"}</div>
          <div className="hint">{fees.data?.cashbackSol ? `Cashback ${sol(fees.data.cashbackSol)} SOL` : fees.data?.ammPendingSol ? `AMM pending ${sol(fees.data.ammPendingSol)} SOL` : fees.data?.claimedSol && Number(fees.data.claimedSol) > 0 ? `Claimed so far ${sol(fees.data.claimedSol)} SOL` : "Accrues while people trade"}</div>
        </div>
        <Button
          variant="primary"
          busy={busy}
          disabled={!canSign || !(claimable > 0) || !fees.data?.isMine}
          title={fees.data && !fees.data.isMine ? "The creator wallet is not in your vault" : !canSign ? "Unlock the vault first" : undefined}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await claimFees({ mint });
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
      {fees.data && !fees.data.isMine ? <Note tone="warn">The creator wallet {fees.data.creator ? short(fees.data.creator) : ""} is not in your vault, so you cannot claim from here.</Note> : null}
      {res ? (
        <p className="hint">
          {res.confirmed}/{res.signatures.length} claim transaction{res.signatures.length !== 1 ? "s" : ""} confirmed{res.error ? ` · ${res.error}` : ""}
        </p>
      ) : null}
    </SubCard>
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
    <SubCard
      icon="volume"
      title="Volume bot"
      description="A group of wallets buys and sells in rounds to print volume. One round = one trade per wallet."
      status={
        <span className="inline-flex items-center gap-1.5">
          <Dot tone={running ? "up" : "muted"} pulse={running} />
          <span className={running ? "text-up" : "text-text-3"}>{running ? `Round ${status.data?.round}/${status.data?.rounds}` : "Stopped"}</span>
        </span>
      }
    >
      {status.error ? <ApiError error={status.error} retry={status.refresh} compact /> : null}
      {running ? (
        <>
          {status.data?.jobId ? <JobProgress jobId={status.data.jobId} compact /> : null}
          <Button variant="danger" icon="stop" busy={busy} onClick={() => call({ action: "stop", mint })}>
            Stop the bot
          </Button>
        </>
      ) : (
        <>
          <Field label="Wallet group">
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Choose a group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({wallets.filter((w) => w.group === g.id).length} wallets)
                </option>
              ))}
            </Select>
            {!groups.length ? <p className="hint mt-1">No group yet — create one in Portfolio.</p> : null}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min per trade">
              <Input type="number" step="0.01" value={minSol} onChange={(e) => setMin(e.target.value)} mono suffix="SOL" />
            </Field>
            <Field label="Max per trade">
              <Input type="number" step="0.01" value={maxSol} onChange={(e) => setMax(e.target.value)} mono suffix="SOL" />
            </Field>
            <Field label="Min delay">
              <Input type="number" value={minDelay} onChange={(e) => setMinD(e.target.value)} mono suffix="ms" />
            </Field>
            <Field label="Max delay">
              <Input type="number" value={maxDelay} onChange={(e) => setMaxD(e.target.value)} mono suffix="ms" />
            </Field>
          </div>
          <Field label="Rounds">
            <Input type="number" min={1} value={rounds} onChange={(e) => setRounds(e.target.value)} mono suffix="rounds" />
          </Field>
          <InlineError>{err}</InlineError>
          <Button variant="auto" icon="play" busy={busy} disabled={!canSign || !group || !groupSize} onClick={() => call({ action: "start", mint, group, minSol, maxSol, minDelayMs: Number(minDelay), maxDelayMs: Number(maxDelay), rounds: Number(rounds) })}>
            Start on {groupSize || 0} wallet{groupSize !== 1 ? "s" : ""}
          </Button>
        </>
      )}
    </SubCard>
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
    <SubCard
      icon="autodump"
      title="Auto-dump"
      description="Sells automatically when the market cap reaches a target, or after a delay — whichever comes first."
      status={
        <span className="inline-flex items-center gap-1.5">
          <Dot tone={armed ? "warn" : "muted"} pulse={armed} />
          <span className={armed ? "text-warn" : "text-text-3"}>{armed ? "Armed" : "Off"}</span>
        </span>
      }
    >
      {status.error ? <ApiError error={status.error} retry={status.refresh} compact /> : null}
      {armed && status.data ? (
        <>
          <div className="text-sm text-text-2">
            Sells {status.data.config?.percent} %{status.data.config?.mcUsd ? ` when the market cap reaches ${usd(status.data.config.mcUsd)}` : ""}
            {status.data.config?.afterSec ? `${status.data.config?.mcUsd ? ", or" : ""} after ${status.data.config.afterSec} s` : ""}.
            {status.data.lastMcUsd !== null ? <span className="text-text-3"> Market cap now {usd(status.data.lastMcUsd)}.</span> : null}
            {status.data.firedAt ? <span className="text-up"> Fired.</span> : null}
          </div>
          {status.data.jobId ? <JobProgress jobId={status.data.jobId} compact /> : null}
          <Button variant="danger" icon="stop" busy={busy} onClick={() => call({ action: "disarm", mint })}>
            Disarm
          </Button>
        </>
      ) : (
        <>
          <Field label="Sell">
            <Input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} mono suffix="% of each wallet" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="When market cap reaches">
              <Input type="number" min={0} value={mcUsd} onChange={(e) => setMc(e.target.value)} mono suffix="USD" placeholder="—" />
            </Field>
            <Field label="Or after">
              <Input type="number" min={0} value={afterSec} onChange={(e) => setAfter(e.target.value)} mono suffix="seconds" placeholder="—" />
            </Field>
          </div>
          <Toggle checked={bundle} onChange={setBundle} label="Send the sells as one Jito bundle" />
          <InlineError>{err}</InlineError>
          <Button variant="warn" icon="zap" busy={busy} disabled={!canSign || (!(Number(mcUsd) > 0) && !(Number(afterSec) > 0))} onClick={() => call({ action: "arm", mint, percent: Number(percent), mcUsd: Number(mcUsd) > 0 ? Number(mcUsd) : undefined, afterSec: Number(afterSec) > 0 ? Number(afterSec) : undefined, bundle })}>
            Arm auto-dump
          </Button>
          {!(Number(mcUsd) > 0) && !(Number(afterSec) > 0) ? <p className="hint">Set a market cap target or a delay to arm it.</p> : null}
        </>
      )}
    </SubCard>
  );
}
