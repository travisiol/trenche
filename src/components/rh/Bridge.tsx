"use client";
/** Robinhood mode › Bridge: Solana → Robinhood (SOL from vault wallets arrives as ETH) and back, via Relay, one way, direct. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { failureMessage, post } from "@/lib/api";
import { useBalances, useWallets } from "@/lib/store";
import { age, short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxCard, BxInput, BxLabel, BxSeg, BxSelect, cx } from "@/components/bx/ui";
import { TxLink } from "@/components/bx/Job";
import { EvmTx, eth, ethNum, type RhBridge, type RhStatus, type RhWallet } from "./common";

type Quote = { inLamports: string; outWei: string; minOutWei: string; outUsd: number | null; inUsd: number | null; feeLamports: string; impactPct: number | null; seconds: number };

function walletLabel(w: RhWallet) {
  return `${w.label || short(w.address)} — ${eth(w.balanceWei, 5)} ETH`;
}

const BRIDGE_KEEP = 0.001;
/** what a Max / 100 % leg also leaves for its own deposit fee (the server resolves Max exactly) */
const SOL_FEE_KEEP = 0.0002;
const GAS_KEEP = 0.00002;

type BatchSource = { address: string; label: string; bal: number; group?: string | null };
type BatchMode = "amount" | "pct" | "max";
type LegState = { quote?: { inAmt: number; outAmt: number; minOut: number; outUsd: number | null; impactPct: number | null; seconds: number; seen: string }; error?: string };
type LegOut<T> = { from: string; ok: boolean; result: T | null; error: string | null };

/** Several source wallets → one destination, in one click. Each leg is a normal one-way direct bridge; they run 4 at a
 *  time on the server and one failed leg does not stop the others. */
function BatchBridge({
  title,
  inUnit,
  outUnit,
  sources,
  groups,
  destLabel,
  dests,
  defaultDest,
  keep,
  quotePath,
  execPath,
  readQuote,
  footer,
  onDone,
}: {
  title: string;
  inUnit: "SOL" | "ETH";
  outUnit: "SOL" | "ETH";
  sources: BatchSource[];
  groups?: { id: string; name: string }[];
  destLabel: string;
  dests: { address: string; label: string }[];
  defaultDest: string;
  keep: number;
  quotePath: string;
  execPath: string;
  readQuote: (q: never) => NonNullable<LegState["quote"]>;
  footer: string;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [group, setGroup] = useState<string>("all");
  const [mode, setMode] = useState<BatchMode>("amount");
  const [value, setValue] = useState("");
  const [toPick, setToPick] = useState("");
  /** the last quotes, with the inputs they were made for: a quote of other inputs is never sent */
  const [quoted, setQuoted] = useState<{ key: string; legs: Record<string, LegState> }>({ key: "", legs: {} });
  const [quoting, setQuoting] = useState(false);
  /** the last send's failures, shown under each wallet until the next send */
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const to = toPick || defaultDest;
  const fmtIn = (n: number) => (inUnit === "SOL" ? sol(n) : ethNum(n, 6));
  const fmtOut = (n: number) => (outUnit === "SOL" ? sol(n) : ethNum(n, 6));
  const dp = inUnit === "SOL" ? 1e6 : 1e8;
  const reserve = keep + (inUnit === "SOL" ? SOL_FEE_KEEP : 0);

  const visible = useMemo(() => sources.filter((w) => group === "all" || (w.group ?? "none") === group), [sources, group]);
  const v = Number(value.replace(",", "."));
  /** what one wallet sends: a decimal string, "max", or null when it cannot send it */
  const legAmount = (w: BatchSource): string | null => {
    if (mode === "max") return w.bal > reserve ? "max" : null;
    if (!(v > 0)) return null;
    const amt = mode === "pct" ? Math.floor(Math.min(w.bal * (Math.min(v, 100) / 100), w.bal - reserve) * dp) / dp : v;
    return amt > 0 && amt + keep <= w.bal + 1e-12 ? String(amt) : null;
  };
  const chosen = sources.filter((w) => picked.includes(w.address));
  const sendable = chosen.map((w) => ({ w, amount: legAmount(w) })).filter((l): l is { w: BatchSource; amount: string } => l.amount !== null);
  const key = JSON.stringify([to, sendable.map((l) => [l.w.address, l.amount])]);

  const legs = quoted.key === key ? quoted.legs : {};

  useEffect(() => {
    if (!to || !sendable.length) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const res = await post<LegOut<never>[]>(quotePath, { to, legs: sendable.map((l) => ({ from: l.w.address, amount: l.amount })) });
        if (my !== seq.current) return;
        const next: Record<string, LegState> = {};
        for (const r of res) next[r.from] = r.ok && r.result ? { quote: readQuote(r.result) } : { error: r.error ?? "No quote." };
        setQuoted({ key, legs: next });
      } catch (e) {
        if (my === seq.current) setQuoted({ key, legs: Object.fromEntries(sendable.map((l) => [l.w.address, { error: failureMessage(e) }])) });
      } finally {
        if (my === seq.current) setQuoting(false);
      }
    }, 600);
    return () => clearTimeout(t);
    // the key holds every input of the quote
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ready = sendable.filter((l) => legs[l.w.address]?.quote);
  const totalIn = ready.reduce((t, l) => t + legs[l.w.address].quote!.inAmt, 0);
  const totalOut = ready.reduce((t, l) => t + legs[l.w.address].quote!.outAmt, 0);
  const totalUsd = ready.every((l) => legs[l.w.address].quote!.outUsd !== null) ? ready.reduce((t, l) => t + legs[l.w.address].quote!.outUsd!, 0) : null;
  const avgImpact = totalIn > 0 && ready.every((l) => legs[l.w.address].quote!.impactPct !== null) ? ready.reduce((t, l) => t + Math.abs(legs[l.w.address].quote!.impactPct!) * legs[l.w.address].quote!.inAmt, 0) / totalIn : null;
  const slowest = ready.reduce((m, l) => Math.max(m, legs[l.w.address].quote!.seconds), 0);
  const toggle = (a: string) => setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));
  const allVisible = visible.length > 0 && visible.every((w) => picked.includes(w.address));

  const run = async () => {
    if (!ready.length) return;
    setBusy(true);
    setSendErrors({});
    try {
      const res = await post<LegOut<unknown>[]>(execPath, {
        to,
        legs: ready.map((l) => ({ from: l.w.address, amount: l.amount, seen: legs[l.w.address].quote!.seen })),
      });
      const ok = res.filter((r) => r.ok);
      const failed = res.filter((r) => !r.ok);
      setSendErrors(Object.fromEntries(failed.map((r) => [r.from, r.error ?? "Failed."])));
      // the sent wallets leave the selection; the failed ones stay ticked with their error
      setPicked((p) => p.filter((a) => !ok.some((r) => r.from === a)));
      if (ok.length) toast(`${ok.length} deposit${ok.length > 1 ? "s" : ""} confirmed — ${outUnit} arriving on ${short(to)}${failed.length ? ` · ${failed.length} failed (see the list)` : ""}.`, failed.length ? "err" : "ok");
      else toast(`Nothing was sent: ${failed[0]?.error ?? "every leg failed"}`, "err");
      onDone();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BxCard title={title} icon={<ArrowRightLeft className="h-4 w-4 text-text-300" />} right={<span className="text-[11px] text-text-300">via Relay</span>} bodyClassName="px-5 pb-5">
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <BxLabel className="mb-0">
              From · {picked.length} selected
            </BxLabel>
            <div className="flex items-center gap-2">
              {groups && groups.length ? (
                <BxSelect className="h-7 w-auto py-0 text-xs" value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="all">All groups</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                  <option value="none">No group</option>
                </BxSelect>
              ) : null}
              <button
                type="button"
                onClick={() => setPicked((p) => (allVisible ? p.filter((a) => !visible.some((w) => w.address === a)) : [...new Set([...p, ...visible.filter((w) => w.bal > reserve).map((w) => w.address)])]))}
                className="rounded px-1.5 py-0.5 text-[11px] text-text-300 hover:bg-white/[0.04] hover:text-text-100"
              >
                {allVisible ? "Unselect all" : "Select all funded"}
              </button>
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto rounded-md border border-line-100 bg-bg-100">
            {!visible.length ? <p className="px-3 py-3 text-xs text-text-300">No wallet here.</p> : null}
            {visible.map((w) => {
              const on = picked.includes(w.address);
              const amount = legAmount(w);
              const st = legs[w.address];
              return (
                <label key={w.address} className={cx("flex cursor-pointer items-center gap-3 border-b border-line-50 px-3 py-2 text-xs last:border-b-0 hover:bg-white/[0.02]", on && "bg-accent/[0.05]")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(w.address)} className="h-3.5 w-3.5 accent-[var(--color-accent,#3b82f6)]" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-text-100">{w.label}</span>
                    <span className="font-mono text-[10px] text-text-300">{short(w.address, 4, 4)}</span>
                    {sendErrors[w.address] ? (
                      <span className="truncate text-[10px] text-decrease" title={sendErrors[w.address]}>
                        Not sent: {sendErrors[w.address]}
                      </span>
                    ) : null}
                  </span>
                  <span className="w-24 text-right font-mono text-text-200">
                    {fmtIn(w.bal)} {inUnit}
                  </span>
                  <span className="w-40 text-right font-mono">
                    {!on ? (
                      <span className="text-text-300">—</span>
                    ) : amount === null ? (
                      <span className="text-decrease">{mode === "max" || v > 0 ? "balance too low" : "set an amount"}</span>
                    ) : st?.quote ? (
                      <span className="text-text-100">
                        {fmtIn(st.quote.inAmt)} → {fmtOut(st.quote.outAmt)} {outUnit}
                      </span>
                    ) : st?.error ? (
                      <span className="block truncate text-decrease" title={st.error}>
                        {st.error}
                      </span>
                    ) : (
                      <span className="text-text-300">{quoting ? "quoting…" : "—"}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div>
          <BxLabel>{destLabel}</BxLabel>
          <BxSelect value={to} onChange={(e) => setToPick(e.target.value)}>
            {!dests.length ? <option value="">No wallet</option> : null}
            {dests.map((d) => (
              <option key={d.address} value={d.address}>
                {d.label}
              </option>
            ))}
          </BxSelect>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <BxLabel className="mb-0">Amount per wallet</BxLabel>
            <BxSeg
              value={mode}
              onChange={setMode}
              options={[
                { value: "amount", label: inUnit },
                { value: "pct", label: "%" },
                { value: "max", label: "Max" },
              ]}
            />
          </div>
          {mode === "max" ? (
            <p className="rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs text-text-200">
              Each wallet sends everything it holds, minus {inUnit === "SOL" ? `${BRIDGE_KEEP + SOL_FEE_KEEP} SOL (rent + fee)` : "the gas"}.
            </p>
          ) : (
            <BxInput inputMode="decimal" placeholder={mode === "pct" ? "50" : inUnit === "SOL" ? "0.1" : "0.001"} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </div>
        <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs">
          <Row k="Wallets" v={`${ready.length} ready${chosen.length > ready.length ? ` · ${chosen.length - ready.length} skipped` : ""}`} />
          <Row k="You send" v={ready.length ? `${fmtIn(totalIn)} ${inUnit}` : "—"} />
          <Row k="You receive" v={ready.length ? `${fmtOut(totalOut)} ${outUnit}${totalUsd !== null ? ` · ${usd(totalUsd, 2)}` : ""}` : quoting ? "quoting…" : "—"} strong />
          <Row k="Cost" v={ready.length ? `${avgImpact !== null ? `${avgImpact.toFixed(2)} %` : "—"} · ~${slowest}s` : "—"} />
        </div>
        <BxButton variant="primary" disabled={!ready.length || busy || quoting || !to} onClick={run}>
          {busy ? `Depositing ${ready.length} wallet${ready.length > 1 ? "s" : ""}…` : ready.length ? `Bridge ${ready.length} wallet${ready.length === 1 ? "" : "s"} · ${inUnit} → ${outUnit}` : `Bridge ${inUnit} → ${outUnit}`}
        </BxButton>
        <p className="text-[11px] leading-snug text-text-300">{footer}</p>
      </div>
    </BxCard>
  );
}

export function BridgeCard({ status, onDone }: { status: RhStatus; onDone: () => void }) {
  const wallets = useWallets();
  const balances = useBalances();
  const sources = useMemo(
    () =>
      (wallets.data?.wallets ?? [])
        .filter((w) => !w.archived)
        .map((w) => ({ address: w.address, label: w.label || short(w.address), group: w.group, bal: Number(balances.data?.[w.address] ?? w.sol ?? 0) })),
    [wallets.data, balances.data],
  );
  return (
    <BatchBridge
      title="Bridge from Solana"
      inUnit="SOL"
      outUnit="ETH"
      sources={sources}
      groups={wallets.data?.groups}
      destLabel="To (Robinhood wallet)"
      dests={status.wallets.map((w) => ({ address: w.address, label: `${walletLabel(w)}${w.main ? " · main" : ""}` }))}
      defaultDest={status.wallets.find((w) => w.main)?.address || status.address}
      keep={BRIDGE_KEEP}
      quotePath="/api/robinhood/bridge/batch/quote"
      execPath="/api/robinhood/bridge/batch"
      readQuote={(q: Quote) => ({ inAmt: Number(q.inLamports) / 1e9, outAmt: Number(q.outWei) / 1e18, minOut: Number(q.minOutWei) / 1e18, outUsd: q.outUsd, impactPct: q.impactPct, seconds: q.seconds, seen: q.outWei })}
      footer="One way, direct: each vault wallet deposits to Relay, Relay pays the ETH to the chosen Robinhood wallet. A failed fill is refunded in SOL by Relay to the wallet that sent it."
      onDone={() => {
        onDone();
        balances.refresh();
      }}
    />
  );
}

type BackQuote = { inWei: string; outLamports: string; minOutLamports: string; outUsd: number | null; impactPct: number | null; seconds: number };

/** Robinhood → Solana: ETH from several Robinhood wallets arrives as SOL on one vault wallet */
export function BridgeBackCard({ status, onDone }: { status: RhStatus; onDone: () => void }) {
  const wallets = useWallets();
  const balances = useBalances();
  const live = useMemo(() => (wallets.data?.wallets ?? []).filter((w) => !w.archived), [wallets.data]);
  return (
    <BatchBridge
      title="Bridge to Solana"
      inUnit="ETH"
      outUnit="SOL"
      sources={status.wallets.map((w) => ({ address: w.address, label: `${w.label || short(w.address)}${w.main ? " · main" : ""}`, bal: w.balanceWei ? Number(w.balanceWei) / 1e18 : 0 }))}
      destLabel="To (Solana vault wallet)"
      dests={live.map((w) => ({ address: w.address, label: `${w.label || short(w.address)} — ${sol(balances.data?.[w.address] ?? w.sol)} SOL` }))}
      defaultDest={wallets.data?.active || live[0]?.address || ""}
      keep={GAS_KEEP}
      quotePath="/api/robinhood/bridge-back/batch/quote"
      execPath="/api/robinhood/bridge-back/batch"
      readQuote={(q: BackQuote) => ({ inAmt: Number(q.inWei) / 1e18, outAmt: Number(q.outLamports) / 1e9, minOut: Number(q.minOutLamports) / 1e9, outUsd: q.outUsd, impactPct: q.impactPct, seconds: q.seconds, seen: q.outLamports })}
      footer="One way, direct: each Robinhood wallet deposits to Relay, Relay pays the SOL to the chosen vault wallet. A failed fill is refunded in ETH by Relay to the wallet that sent it."
      onDone={() => {
        onDone();
        balances.refresh();
      }}
    />
  );
}


export function BridgeHistory({ status }: { status: RhStatus }) {
  if (!status.bridges.length) return null;
  return (
    <BxCard title="History" bodyClassName="px-5 pb-5">
      <div className="flex flex-col gap-1.5">
        {status.bridges.slice(0, 15).map((b) => {
          const back = b.dir === "rh2sol";
          return (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line-100 bg-bg-100 px-3 py-2 text-xs">
              <span className="flex items-center gap-2">
                <StatusPill s={b.status} />
                {back ? (
                  <>
                    <span className="font-mono text-text-100">{eth(b.inWei ?? "0", 6)} ETH</span>
                    <span className="text-text-300">→</span>
                    <span className="font-mono text-text-100">{sol(Number(b.outLamports ?? "0") / 1e9)} SOL</span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-text-100">{sol(Number(b.inLamports) / 1e9)} SOL</span>
                    <span className="text-text-300">→</span>
                    <span className="font-mono text-text-100">{eth(b.outWei, 5)} ETH</span>
                  </>
                )}
                <span className="text-text-300">to {short(b.to, 4, 4)}</span>
              </span>
              <span className="flex items-center gap-2">
                {back ? (
                  <>
                    {b.evmTx ? <EvmTx hash={b.evmTx} /> : null}
                    {b.destTxs[0] ? <TxLink sig={b.destTxs[0]} /> : null}
                  </>
                ) : (
                  <>
                    {b.solSignature ? <TxLink sig={b.solSignature} /> : null}
                    {b.destTxs[0] ? <EvmTx hash={b.destTxs[0]} /> : null}
                  </>
                )}
                <span className="text-text-300">{age(b.at)}</span>
              </span>
              {b.error ? <span className="w-full text-[11px] text-decrease">{b.error}</span> : null}
            </div>
          );
        })}
      </div>
    </BxCard>
  );
}

function StatusPill({ s }: { s: RhBridge["status"] }) {
  const map: Record<RhBridge["status"], [string, string]> = {
    sending: ["Sending", "bg-white/[0.06] text-text-200"],
    deposited: ["Deposited", "bg-accent/15 text-accent"],
    pending: ["Filling", "bg-accent/15 text-accent"],
    success: ["Arrived", "bg-increase/15 text-increase"],
    failure: ["Failed", "bg-decrease/15 text-decrease"],
    refunded: ["Refunded", "bg-white/[0.06] text-text-200"],
  };
  const [label, cls] = map[s];
  return <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{label}</span>;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-300">{k}</span>
      <span className={cx("font-mono tabular-nums", strong ? "text-text-100" : "text-text-200")}>{v}</span>
    </div>
  );
}

