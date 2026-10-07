"use client";
import { useState } from "react";
import Link from "next/link";
import { Copy, History, RefreshCw } from "lucide-react";
import { BxButton, BxInput, BxModal } from "@/components/bx/ui";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useVault } from "@/lib/store";
import { short } from "@/lib/format";
import { toast } from "@/components/ui";
import type { WalletInfo } from "@/lib/types";
import { husherAllocation, splitHusherSol, type HusherOrder, type HusherPlan, type HusherQuote, type HusherState } from "@/lib/husher";

export function HusherMixer({ wallets, selected = [], onClose }: { wallets: WalletInfo[]; selected?: string[]; onClose: () => void }) {
  const live = wallets.filter((w) => !w.archived);
  const [chosen, setChosen] = useState<string[]>(() => selected.length ? live.filter((w) => selected.includes(w.address)).map((w) => w.address) : live.map((w) => w.address));
  const [total, setTotal] = useState("0.1");
  const [allocations, setAllocations] = useState<Record<string, string>>(() => {
    const addresses = selected.length ? live.filter((w) => selected.includes(w.address)).map((w) => w.address) : live.map((w) => w.address);
    try { return Object.fromEntries(addresses.map((a, i) => [a, splitHusherSol("0.1", addresses.length)[i]])); } catch { return {}; }
  });
  const [quote, setQuote] = useState<HusherQuote | null>(null);
  const [order, setOrder] = useState<HusherOrder | null>(null);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState<"quote" | "create" | "key" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [consent, setConsent] = useState(false);
  const settings = useSettings(); const vault = useVault();
  const state = useGet<HusherState>("/api/husher", 15000);
  const limits = useGet<{ minimumSol: number | null }>(state.data?.configured ? "/api/husher/quote" : null, 60000);
  const finished = order && ["Complete", "Failed", "Refunded"].includes(order.status);
  const tracked = useGet<HusherOrder>(order?.remoteId ? `/api/husher/orders/${encodeURIComponent(order.id)}` : null, finished ? 0 : 8000);
  const current = tracked.data?.id === order?.id ? tracked.data : order;
  const mainnet = settings.data?.cluster === "mainnet";
  const plan: HusherPlan = { totalSol: total, recipients: chosen.map((address) => ({ address, label: live.find((w) => w.address === address)?.label || short(address), sol: allocations[address] || "" })) };
  let problem: string | null = null;
  try { husherAllocation(plan); } catch (e) { problem = failureMessage(e); }
  const change = () => { setQuote(null); setConsent(false); setError(null); };
  function split(addresses = chosen) {
    try {
      const amounts = splitHusherSol(total, addresses.length);
      setAllocations(Object.fromEntries(addresses.map((a, i) => [a, amounts[i]]))); change();
    } catch (e) { setError(failureMessage(e)); }
  }
  async function fetchQuote() {
    setBusy("quote"); setError(null); setQuote(null); setConsent(false);
    try { setQuote(await post<HusherQuote>("/api/husher/quote", plan)); }
    catch (e) { setError(failureMessage(e)); }
    finally { setBusy(null); }
  }
  async function create() {
    if (!quote) return;
    setBusy("create"); setError(null);
    try { setOrder(await post<HusherOrder>("/api/husher", { quoteId: quote.id, consent })); state.refresh(); }
    catch (e) { setError(failureMessage(e)); }
    finally { setBusy(null); }
  }
  async function saveKey() {
    setBusy("key"); setError(null);
    try { await post("/api/husher/config", { key: apiKey }); setApiKey(""); state.refresh(); toast("Husher API key saved on the server", "ok"); }
    catch (e) { setError(failureMessage(e)); }
    finally { setBusy(null); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast("Copied", "ok"); }
    catch { toast("Select the value and copy it manually.", "info"); }
  }
  const external = "inline underline text-accent";
  return (
    <BxModal open onClose={() => { if (!busy) onClose(); }} title="Mixer · Developer Wallets" width={550} headerRight={<BxButton size="sm" variant="ghost" disabled={!!busy} onClick={() => { setHistory(!history); setOrder(null); }}><History className="h-3.5 w-3.5" /> {history ? "New order" : "History"}</BxButton>}>
      <div className="space-y-4">
        {error || state.error ? <p role="alert" className="rounded border border-decrease/30 bg-decrease/10 p-3 text-xs text-decrease">{error || failureMessage(state.error)}</p> : null}
        {current ? (
          <>
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-text-100">Order {current.orderId || current.id.slice(0, 8)}</p><p className="mt-1 text-xs text-accent">{current.status}</p></div><BxButton size="sm" disabled={tracked.loading || !current.remoteId} onClick={() => tracked.refresh()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</BxButton></div>
            {current.error || tracked.error ? <p role="alert" className="text-xs leading-relaxed text-decrease">{current.error || failureMessage(tracked.error)}</p> : null}
            {current.depositAddress && current.depositSol && !current.error && !tracked.error && !["Complete", "Failed", "Refunded", "Funds Confirmed"].includes(current.status) && !current.hashIn ? <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
              <p className="text-[13px] font-medium text-text-100">Deposit exactly {current.depositSol} SOL · Solana mainnet</p>
              <p className="text-xs text-text-300">Send to the Husher deposit address below. This order has not been funded by DONCHAIN.</p>
              <p className="select-all break-all rounded border border-line-100 bg-input-100 p-3 font-mono text-xs text-text-100">{current.depositAddress}</p>
              <div className="flex flex-wrap gap-2"><BxButton size="sm" onClick={() => copy(current.depositAddress!)}><Copy className="h-3.5 w-3.5" /> Copy address</BxButton><BxButton size="sm" onClick={() => copy(current.depositSol!)}>Copy amount</BxButton></div>
            </div> : !current.remoteId ? <p className="text-xs leading-relaxed text-text-300">The creation outcome needs review. No deposit instruction is available and DONCHAIN has sent no funds. Check your order history on Husher before starting another order.</p> : null}
            <div className="grid grid-cols-2 gap-2 text-xs text-text-300"><span>Deposit total</span><span className="text-right text-text-100">{current.plan.totalSol} SOL</span><span>Quoted output (estimate)</span><span className="text-right text-text-100">{current.quote.receiveSol} SOL</span><span>Exchange fee</span><span className="text-right text-text-100">{current.feeSol !== null ? `${current.feeSol} SOL` : "—"}</span><span>Network fee</span><span className="text-right text-text-100">{current.networkFeeSol !== null ? `${current.networkFeeSol} SOL` : "—"}</span></div>
            <div className="max-h-48 space-y-2 overflow-y-auto">{current.recipients.map((r) => <div key={r.address} className="rounded border border-line-100 p-3 text-xs"><div className="flex justify-between gap-2"><span className="text-text-100">{short(r.address)}</span><span className="text-text-200">{r.status} · {r.receiveSol} SOL</span></div>{r.hashOut ? <a href={`https://solscan.io/tx/${encodeURIComponent(r.hashOut)}`} target="_blank" rel="noopener noreferrer" className={external}>Withdrawal transaction</a> : null}</div>)}</div>
            {current.hashIn ? <a href={`https://solscan.io/tx/${encodeURIComponent(current.hashIn)}`} target="_blank" rel="noopener noreferrer" className={`${external} text-xs`}>Deposit transaction</a> : null}
            {current.trackingUrl ? <a href={current.trackingUrl} target="_blank" rel="noopener noreferrer" className={`${external} ml-3 text-xs`}>Husher tracking page</a> : null}
            <BxButton className="w-full" onClick={() => { setOrder(null); setHistory(true); state.refresh(); }}>Back to history</BxButton>
          </>
        ) : history ? (
          <>
            <p className="text-xs text-text-300">Orders are saved locally and can be reopened after a restart.</p>
            {state.data?.orders.length ? <div className="max-h-96 space-y-2 overflow-y-auto">{state.data.orders.map((o) => <button key={o.id} className="flex w-full items-center justify-between gap-3 rounded border border-line-100 p-3 text-left hover:border-accent/40" onClick={() => setOrder(o)}><div><p className="text-sm text-text-100">{o.plan.totalSol} SOL · {o.plan.recipients.length} wallets</p><p className="mt-1 text-xs text-text-300">{new Date(o.at).toLocaleString()} · {o.orderId || o.id.slice(0, 8)}</p></div><span className="text-xs text-accent">{o.status}</span></button>)}</div> : <p className="text-sm text-text-300">No Husher orders yet.</p>}
          </>
        ) : (
          <>
            <div><p className="mb-1.5 text-xs text-text-300">Service</p><div className="rounded border border-line-100 bg-accent/10 py-2 text-center text-sm font-medium text-accent">Husher · SOL → SOL</div></div>
            {state.data && !state.data.configured ? <div className="space-y-2 rounded border border-line-100 p-3"><label htmlFor="husher-api-key" className="text-xs text-text-200">Husher API key</label><BxInput id="husher-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="Paste your key" disabled={!!busy} /><BxButton onClick={saveKey} disabled={!apiKey || !!busy || !vault.data?.unlocked}>Save key</BxButton><p className="text-xs text-text-300">Unlock your vault to configure the key. It is stored on the local server and never returned to the browser.</p></div> : null}
            {!mainnet ? <p className="text-xs text-yellow-100">Husher uses real SOL. Switch to mainnet in <Link href="/settings" className={external}>Settings</Link>.</p> : null}
            <fieldset disabled={!!busy} className="space-y-4 disabled:opacity-60">
              <div><label htmlFor="husher-total" className="mb-1.5 block text-xs text-text-300">Total to exchange (SOL)</label><div className="flex gap-2"><BxInput id="husher-total" inputMode="decimal" value={total} onChange={(e) => { setTotal(e.target.value); change(); }} /><BxButton onClick={() => split()}>Split equal</BxButton></div><p className="mt-1.5 text-[11px] text-text-300">{limits.data?.minimumSol ? `Current withdrawal minimum: ${limits.data.minimumSol} SOL per destination. The quote checks each allocation.` : "Limits and fees are checked by the live Husher quote."}</p></div>
              <div className="rounded-lg border border-line-100"><div className="flex items-center justify-between border-b border-line-50 px-3 py-2 text-xs text-text-300"><span>Destinations ({chosen.length}/{live.length})</span><div className="flex gap-3"><button type="button" className="text-accent" onClick={() => { const all = live.map((w) => w.address); setChosen(all); split(all); }}>All</button><button type="button" className="text-accent" onClick={() => { setChosen([]); setAllocations({}); change(); }}>Clear</button></div></div><div className="max-h-64 space-y-1 overflow-y-auto p-2">{live.map((w) => <div key={w.address} className="flex items-center gap-3 rounded px-1 py-2"><label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"><input type="checkbox" checked={chosen.includes(w.address)} onChange={(e) => { setChosen((prev) => e.target.checked ? [...prev, w.address] : prev.filter((a) => a !== w.address)); change(); }} className="accent-accent" /><span className="min-w-0"><span className="block truncate text-sm font-medium text-text-100">{w.label || short(w.address)}</span><span className="block text-[11px] text-text-300">{short(w.address)}</span></span></label><BxInput aria-label={`Allocation for ${w.label || w.address}`} inputMode="decimal" className="w-32 text-right font-mono text-xs" value={allocations[w.address] || ""} disabled={!chosen.includes(w.address)} onChange={(e) => { setAllocations((p) => ({ ...p, [w.address]: e.target.value })); change(); }} /></div>)}</div></div>
            </fieldset>
            {problem ? <p className="text-xs text-text-300">{problem}</p> : null}
            <BxButton variant="primary" className="w-full" disabled={!!busy || !!problem || !mainnet || !state.data?.configured} onClick={fetchQuote}>{busy === "quote" ? "Fetching quote…" : "Fetch Quote"}</BxButton>
            {quote ? <div className="space-y-3 rounded-lg border border-accent/25 bg-accent/5 p-3"><div className="flex justify-between text-sm"><span className="text-text-200">Estimated total received</span><span className="font-semibold text-text-100">{quote.receiveSol} SOL</span></div><div className="max-h-32 space-y-1 overflow-y-auto">{quote.rates.map((r) => <p key={r.address} className="flex justify-between text-xs text-text-300"><span>{short(r.address)}</span><span>{r.receiveSol} SOL</span></p>)}</div><p className="text-[11px] leading-relaxed text-text-300">Floating estimate after Husher fees. Review within 60 seconds; the final amount may change during execution. Creating the order generates deposit instructions and sends no funds.</p><label className="flex items-start gap-2 text-xs leading-relaxed text-text-200"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={!!busy} className="mt-0.5 accent-accent" /><span>I agree to Husher&apos;s <a className={external} href="https://www.husher.io/terms-of-service" target="_blank" rel="noopener noreferrer">Terms</a>, <a className={external} href="https://www.husher.io/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and <a className={external} href="https://www.husher.io/anti-money-policy" target="_blank" rel="noopener noreferrer">AML Policy</a>, and authorize sharing the selected destination addresses with Husher to create this order.</span></label><BxButton variant="primary" className="w-full" disabled={!consent || !!busy || !mainnet} onClick={create}>{busy === "create" ? "Creating order…" : "Create Husher order"}</BxButton></div> : null}
            <p className="text-[11px] leading-relaxed text-text-300">Exchange execution is provided by Husher. Transactions may be delayed or subject to checks. This service does not guarantee that wallet addresses become unlinkable.</p>
          </>
        )}
      </div>
    </BxModal>
  );
}
