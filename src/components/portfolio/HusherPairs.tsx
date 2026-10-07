"use client";
/** Mixer · Pairs: "this wallet sends to that wallet", as many pairs as wanted (chains allowed: dev 1 → dev 2, dev 2 →
 *  dev 3 …). Each pair is its own Husher order with its own deposit address, funded only by its From wallet, so a
 *  From wallet's SOL reaches only its To wallet. Pairs run one after the other: create the order, then send the
 *  deposit from the From wallet in one transaction (the same two calls as the split mode). */
import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { cx } from "@/components/bx/ui";
import { failureMessage, post, useGet } from "@/lib/api";
import { refreshVaultDependents } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import type { WalletInfo } from "@/lib/types";
import { HUSHER_KEEP_LAM, HUSHER_MAX_DELAY_MIN, formatHusherSol, providerLabel, type HusherOrder, type HusherQuote } from "@/lib/husher";
import { MinutesInput, ProviderSelect, browserMeta, card, external, fieldBase, lamOf, primary, smallBtn, solid } from "@/components/portfolio/HusherUi";

type Pair = { id: number; from: string; to: string; sol: string };
type Run = { state: "waiting" | "creating" | "sending" | "sent" | "failed"; order?: HusherOrder; error?: string };
/** quotes are fetched a few pairs at a time: each pair asks every provider */
const QUOTE_BATCH = 3;

/** Live status of one created pair (polls its order). */
function PairStatus({ order, onOpen }: { order: HusherOrder; onOpen: (o: HusherOrder) => void }) {
  const done = ["Complete", "completed", "Failed", "Refunded"].includes(order.status);
  const live = useGet<HusherOrder>(order.remoteId ? `/api/husher/orders/${encodeURIComponent(order.id)}` : null, done ? 0 : 8000);
  const o = live.data?.id === order.id ? live.data : order;
  const delivered = o.recipients.some((r) => !!r.hashOut || /complete/i.test(r.status)) || /complete/i.test(o.status);
  const received = delivered || !!o.hashIn || !["Awaiting Deposit", "Creating"].includes(o.status);
  const label = /fail|refund/i.test(o.status) ? o.status : delivered ? `Delivered · ${o.recipients[0]?.receiveSol ?? "?"} SOL` : received ? "Received by Husher · sending…" : "Deposit sent · waiting for Husher";
  return <button type="button" onClick={() => onOpen(o)} className={cx("text-right text-[11px] hover:underline", delivered ? "text-green-100" : /fail|refund/i.test(o.status) ? "text-decrease" : "text-accent")}>{label}</button>;
}

export function HusherPairs({ wallets, balances, minSol, ready, unlocked, onOpenOrder, onRunning, onOrdersChanged }: {
  wallets: WalletInfo[]; balances: Record<string, string | null> | null; minSol: number | null | undefined;
  /** mainnet + key configured */
  ready: boolean; unlocked: boolean;
  onOpenOrder: (o: HusherOrder) => void; onRunning: (running: boolean) => void; onOrdersChanged: () => void;
}) {
  const balOf = (addr: string) => { const w = wallets.find((x) => x.address === addr); return balances?.[addr] ?? w?.sol ?? null; };
  const nameOf = (addr: string) => { const w = wallets.find((x) => x.address === addr); return w ? w.label || short(w.address) : short(addr); };
  const [pairs, setPairs] = useState<Pair[]>(() => {
    const rich = [...wallets].sort((a, b) => Number(balOf(b.address) ?? 0) - Number(balOf(a.address) ?? 0));
    return rich[0] && wallets.length > 1 ? [{ id: 1, from: rich[0].address, to: wallets.find((w) => w.address !== rich[0].address)!.address, sol: "" }] : [{ id: 1, from: "", to: "", sol: "" }];
  });
  const [nextId, setNextId] = useState(2);
  const [quotes, setQuotes] = useState<Record<number, HusherQuote>>({});
  const [quoteErr, setQuoteErr] = useState<Record<number, string>>({});
  const [providers, setProviders] = useState<Record<number, string>>({});
  const [delays, setDelays] = useState<Record<number, string>>({});
  const [runs, setRuns] = useState<Record<number, Run>>({});
  const [phase, setPhase] = useState<"edit" | "quoting" | "quoted" | "running" | "done">("edit");
  const [consent, setConsent] = useState(false);

  const edit = (id: number, patch: Partial<Pair>) => { setPairs((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p))); setQuotes({}); setQuoteErr({}); setConsent(false); setPhase("edit"); };
  function addPair() {
    const usedFrom = new Set(pairs.map((p) => p.from)); const usedTo = new Set(pairs.map((p) => p.to));
    const last = pairs[pairs.length - 1];
    // chain by default: the last pair's receiver sends next, to the next wallet nobody receives into yet
    const from = last?.to && !usedFrom.has(last.to) ? last.to : [...wallets].sort((a, b) => Number(balOf(b.address) ?? 0) - Number(balOf(a.address) ?? 0)).find((w) => !usedFrom.has(w.address))?.address ?? "";
    const to = wallets.find((w) => w.address !== from && !usedTo.has(w.address) && !usedFrom.has(w.address))?.address ?? wallets.find((w) => w.address !== from && !usedTo.has(w.address))?.address ?? "";
    setPairs((ps) => [...ps, { id: nextId, from, to, sol: last?.sol ?? "" }]); setNextId(nextId + 1);
    setQuotes({}); setQuoteErr({}); setConsent(false); setPhase("edit");
  }
  const remove = (id: number) => { setPairs((ps) => ps.filter((p) => p.id !== id)); setQuotes({}); setQuoteErr({}); setPhase("edit"); };

  // validation
  const problems: Record<number, string> = {};
  const seenFrom = new Map<string, number>(); const seenTo = new Map<string, number>();
  pairs.forEach((p, i) => {
    if (!p.from || !p.to) problems[p.id] = "Pick both wallets.";
    else if (p.from === p.to) problems[p.id] = "A wallet cannot send to itself.";
    else if (seenFrom.has(p.from)) problems[p.id] = `${nameOf(p.from)} already sends in pair ${seenFrom.get(p.from)! + 1}.`;
    else if (seenTo.has(p.to)) problems[p.id] = `${nameOf(p.to)} already receives in pair ${seenTo.get(p.to)! + 1}.`;
    else if (lamOf(p.sol) <= BigInt(0)) problems[p.id] = "Enter the SOL to send.";
    else if (minSol && Number(p.sol) < minSol) problems[p.id] = `Husher's minimum is ${minSol} SOL per wallet.`;
    else if (lamOf(p.sol) > lamOf(String(balOf(p.from) ?? ""))) problems[p.id] = `${nameOf(p.from)} holds only ${sol(balOf(p.from))} SOL right now.`;
    if (p.from) seenFrom.set(p.from, i); if (p.to) seenTo.set(p.to, i);
  });
  const valid = pairs.length > 0 && Object.keys(problems).length === 0;
  const totalLam = pairs.reduce((a, p) => a + lamOf(p.sol), BigInt(0));
  const delayOf = (id: number) => Number(delays[id] || "0");
  const badDelay = pairs.some((p) => !(delayOf(p.id) <= HUSHER_MAX_DELAY_MIN));

  const planOf = (p: Pair) => ({ totalSol: p.sol.trim(), recipients: [{ address: p.to, label: nameOf(p.to), sol: p.sol.trim() }] });
  async function quoteAll() {
    setPhase("quoting"); setQuotes({}); setQuoteErr({}); setConsent(false);
    const qs: Record<number, HusherQuote> = {}; const errs: Record<number, string> = {};
    for (let i = 0; i < pairs.length; i += QUOTE_BATCH) {
      await Promise.all(pairs.slice(i, i + QUOTE_BATCH).map(async (p) => {
        try { qs[p.id] = await post<HusherQuote>("/api/husher/quote", planOf(p)); } catch (e) { errs[p.id] = failureMessage(e); }
      }));
    }
    setQuotes(qs); setQuoteErr(errs);
    setProviders(Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, q.rates[0].options[0].provider])));
    setPhase(Object.keys(errs).length ? "edit" : "quoted");
  }

  async function runAll() {
    setPhase("running"); onRunning(true);
    setRuns(Object.fromEntries(pairs.map((p) => [p.id, { state: "waiting" } as Run])));
    const set = (id: number, r: Run) => setRuns((m) => ({ ...m, [id]: r }));
    let sent = 0;
    for (const p of pairs) {
      set(p.id, { state: "creating" });
      try {
        let q = quotes[p.id];
        const create = (quote: HusherQuote) => {
          const provider = quote.rates[0].options.some((o) => o.provider === providers[p.id]) ? providers[p.id] : quote.rates[0].options[0].provider;
          return post<HusherOrder>("/api/husher", { quoteId: quote.id, consent: true, picks: [{ address: p.to, provider, delayMin: delayOf(p.id) }], sources: [{ address: p.from, sol: p.sol.trim() }], clientMeta: browserMeta() });
        };
        let order: HusherOrder;
        try { order = await create(q); }
        catch (e) {
          // earlier pairs took longer than the 60 s quote window: price this pair again, same provider when still offered
          if (!/expired/i.test(failureMessage(e))) throw e;
          q = await post<HusherQuote>("/api/husher/quote", planOf(p));
          order = await create(q);
        }
        if (!order.depositAddress || !order.depositSol || order.error || order.status !== "Awaiting Deposit") { set(p.id, { state: "failed", order, error: order.error ?? `Order is ${order.status}; nothing was sent.` }); continue; }
        set(p.id, { state: "sending", order });
        const paid = await post<HusherOrder>(`/api/husher/orders/${encodeURIComponent(order.id)}/pay`, {});
        set(p.id, { state: "sent", order: paid }); sent++;
      } catch (e) { set(p.id, { state: "failed", error: failureMessage(e) }); }
    }
    onRunning(false); onOrdersChanged(); refreshVaultDependents(); setPhase("done");
    toast(`${sent}/${pairs.length} pair${pairs.length > 1 ? "s" : ""} sent`, sent === pairs.length ? "ok" : "info");
  }

  const locked = phase === "quoting" || phase === "running" || phase === "done";
  const walletOptions = (exclude: string) => wallets.filter((w) => w.address !== exclude).map((w) => <option key={w.address} value={w.address}>{w.label || short(w.address)} · {sol(balOf(w.address))} SOL</option>);
  return (
    <>
      <div className={card}>
        <div className="flex items-center justify-between border-b border-line-50 px-3 py-2">
          <span className="text-xs text-text-300">Pairs ({pairs.length}) · each From sends only to its To</span>
          {!locked ? <button type="button" className="flex items-center gap-1 text-xs text-accent hover:underline" onClick={addPair}><Plus className="h-3.5 w-3.5" /> Add pair</button> : null}
        </div>
        {pairs.map((p, i) => {
          const q = quotes[p.id]; const run = runs[p.id];
          const prov = providers[p.id] ?? q?.rates[0].options[0].provider;
          const opt = q?.rates[0].options.find((o) => o.provider === prov) ?? q?.rates[0].options[0];
          return (
            <div key={p.id} className="border-b border-line-50 px-3 py-2.5 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-[11px] text-text-300">{i + 1}</span>
                <select aria-label={`Pair ${i + 1} sender`} disabled={locked} value={p.from} onChange={(e) => edit(p.id, { from: e.target.value })} className={cx(fieldBase, "h-9 min-w-0 flex-1 py-0 text-xs")}><option value="">From…</option>{walletOptions(p.to)}</select>
                <ArrowRight className="h-4 w-4 shrink-0 text-text-300" />
                <select aria-label={`Pair ${i + 1} receiver`} disabled={locked} value={p.to} onChange={(e) => edit(p.id, { to: e.target.value })} className={cx(fieldBase, "h-9 min-w-0 flex-1 py-0 text-xs")}><option value="">To…</option>{walletOptions(p.from)}</select>
                {!locked && pairs.length > 1 ? <button type="button" aria-label={`Remove pair ${i + 1}`} className="shrink-0 text-text-300 hover:text-decrease" onClick={() => remove(p.id)}><X className="h-4 w-4" /></button> : null}
              </div>
              <div className="mt-2 flex items-center gap-2 pl-6">
                <input aria-label={`Pair ${i + 1} amount`} inputMode="decimal" placeholder={minSol ? String(Math.max(0.05, minSol)) : "0.05"} disabled={locked} value={p.sol} onChange={(e) => edit(p.id, { sol: e.target.value })} className={cx(fieldBase, "h-9 w-[110px] text-right font-mono text-xs")} />
                <button type="button" className={cx(smallBtn, "h-9 px-2")} disabled={locked || !p.from} onClick={() => { const lam = lamOf(String(balOf(p.from) ?? "")) - HUSHER_KEEP_LAM; edit(p.id, { sol: lam > BigInt(0) ? formatHusherSol(lam) : "" }); }}>Max</button>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-text-300">{run ? null : opt ? <span className="text-accent">~{opt.receiveSol} SOL out</span> : "SOL"}</span>
                {run ? (
                  run.state === "sent" && run.order ? <PairStatus order={run.order} onOpen={onOpenOrder} />
                  : <span className={cx("text-right text-[11px]", run.state === "failed" ? "text-decrease" : "text-text-300")}>{run.state === "waiting" ? "Waiting" : run.state === "creating" ? "Creating order…" : run.state === "sending" ? "Sending deposit…" : run.order ? <button type="button" className="hover:underline" onClick={() => onOpenOrder(run.order!)}>Failed · open</button> : "Failed"}</span>
                ) : null}
              </div>
              {q && phase === "quoted" && opt ? (
                <div className="mt-2 flex gap-2 pl-6">
                  <ProviderSelect value={prov!} options={q.rates[0].options} onChange={(v) => setProviders((m) => ({ ...m, [p.id]: v }))} />
                  <MinutesInput className="w-[100px]" value={delays[p.id] ?? ""} onChange={(v) => setDelays((m) => ({ ...m, [p.id]: v }))} />
                </div>
              ) : null}
              {run?.state === "failed" && run.error ? <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-decrease">{run.error}</p> : null}
              {!run && (problems[p.id] || quoteErr[p.id]) && (p.sol || quoteErr[p.id]) ? <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-text-300">{quoteErr[p.id] ?? problems[p.id]}</p> : null}
            </div>
          );
        })}
        <div className="flex items-center justify-between border-t border-line-50 px-3 py-2 text-xs">
          <span className="text-text-300">Total sent · {pairs.length} order{pairs.length > 1 ? "s" : ""}</span>
          <span className="font-medium text-text-100">{totalLam > BigInt(0) ? formatHusherSol(totalLam) : "0"} SOL</span>
        </div>
      </div>
      {phase === "edit" || phase === "quoting" ? (
        <button type="button" className={primary} disabled={!valid || !ready || phase === "quoting"} onClick={quoteAll}>{phase === "quoting" ? "Fetching quotes…" : "Fetch Quotes"}</button>
      ) : null}
      {phase === "quoted" ? (
        <>
          {badDelay ? <p className="text-[11px] text-decrease">Delay is at most {HUSHER_MAX_DELAY_MIN} min (7 days).</p> : null}
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-text-300"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-accent" /><span>I agree to Husher&apos;s <a className={external} href="https://www.husher.io/terms-of-service" target="_blank" rel="noopener noreferrer">Terms</a>, <a className={external} href="https://www.husher.io/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and <a className={external} href="https://www.husher.io/anti-money-policy" target="_blank" rel="noopener noreferrer">AML Policy</a>, and to share the receiving addresses with Husher.</span></label>
          {!unlocked ? <p className="text-[11px] text-yellow-100">Unlock the vault so the From wallets can send.</p> : null}
          <button type="button" className={solid} disabled={!consent || !unlocked || badDelay || !ready} onClick={runAll}>Create {pairs.length} order{pairs.length > 1 ? "s" : ""} · send {formatHusherSol(totalLam)} SOL</button>
          <p className="text-[11px] leading-relaxed text-text-300">Pairs run one after the other: order, then the From wallet&apos;s deposit. Keep this panel open until every pair says sent. In a chain, a wallet sends what it holds when its turn comes, not what it is about to receive.</p>
        </>
      ) : null}
      {phase === "running" ? <p className="text-center text-xs text-text-300">Sending pair {Object.values(runs).filter((r) => r.state === "sent" || r.state === "failed").length + 1} of {pairs.length}… keep this panel open.</p> : null}
      {phase === "done" ? (
        <button type="button" className={primary} onClick={() => { setRuns({}); setQuotes({}); setConsent(false); setPhase("edit"); }}>New pairs</button>
      ) : null}
      <p className="text-[11px] leading-relaxed text-text-300">Every pair is a separate Husher order ({providerLabel("binance")} and others), so fees apply per pair. Received amounts are estimates until Husher pays out.</p>
    </>
  );
}

