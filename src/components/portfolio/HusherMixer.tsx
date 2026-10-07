"use client";
/** Mixer · Developer Wallets — Block X right-side drawer (design/blockx/portfolio-mixer.html): Service (Husher |
 *  SplitNOW), Total to mix + Split equal, Destinations with one allocation per wallet, Deposit total, Fetch Quote.
 *  Only Husher is wired; DONCHAIN creates the order and shows deposit instructions, it never sends the funds. */
import { useState } from "react";
import Link from "next/link";
import { Copy, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/portfolio/Drawers";
import { cx } from "@/components/bx/ui";
import { failureMessage, post, useGet } from "@/lib/api";
import { useSettings, useVault } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import type { WalletInfo } from "@/lib/types";
import { formatHusherSol, husherAllocation, parseHusherSol, splitHusherSol, type HusherOrder, type HusherPlan, type HusherQuote, type HusherState } from "@/lib/husher";

const fieldBase = "border border-line-100 bg-bg-50 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent disabled:opacity-50";
const field = `w-full ${fieldBase}`;
const smallBtn = "shrink-0 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45";
const primary = "h-9 w-full rounded border border-accent/40 bg-accent/15 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50";
const external = "inline underline text-accent";

function lamOf(v: string): bigint {
  try { return parseHusherSol(v); } catch { return BigInt(0); }
}

export function HusherMixer({ wallets, balances = null, selected = [], onClose }: { wallets: WalletInfo[]; balances?: Record<string, string | null> | null; selected?: string[]; onClose: () => void }) {
  const live = wallets.filter((w) => !w.archived);
  const [service, setService] = useState<"husher" | "splitnow">("husher");
  const [chosen, setChosen] = useState<string[]>(() => selected.length ? live.filter((w) => selected.includes(w.address)).map((w) => w.address) : live.map((w) => w.address));
  const [total, setTotal] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
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
  const depositLam = chosen.reduce((a, addr) => a + lamOf(allocations[addr] || ""), BigInt(0));
  let problem: string | null = null;
  if (total.trim()) { try { husherAllocation(plan); } catch (e) { problem = failureMessage(e); } }
  const change = () => { setQuote(null); setConsent(false); setError(null); };
  function split(addresses = chosen) {
    if (!addresses.length) return;
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
  const close = () => { if (!busy) onClose(); };
  const min = limits.data?.minimumSol;
  return (
    <Drawer title="Mixer · Developer Wallets" onClose={close} right={<button type="button" disabled={!!busy} className="text-xs text-accent hover:underline disabled:opacity-50" onClick={() => { setHistory(!history); setOrder(null); }}>{history || current ? "New order" : "History"}</button>}>
      <div className="flex flex-col gap-3 p-4">
        {error || state.error ? <p role="alert" className="rounded border border-decrease/30 bg-decrease/10 p-3 text-xs text-decrease">{error || failureMessage(state.error)}</p> : null}
        {current ? (
          <>
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-text-100">Order {current.orderId || current.id.slice(0, 8)}</p><p className="mt-1 text-xs text-accent">{current.status}</p></div><button type="button" className={cx(smallBtn, "flex h-8 items-center gap-1.5")} disabled={tracked.loading || !current.remoteId} onClick={() => tracked.refresh()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button></div>
            {current.error || tracked.error ? <p role="alert" className="text-xs leading-relaxed text-decrease">{current.error || failureMessage(tracked.error)}</p> : null}
            {current.depositAddress && current.depositSol && !current.error && !tracked.error && !["Complete", "Failed", "Refunded", "Funds Confirmed"].includes(current.status) && !current.hashIn ? <div className="space-y-3 rounded-[10px] border border-accent/30 bg-accent/5 p-3">
              <p className="text-[13px] font-medium text-text-100">Deposit exactly {current.depositSol} SOL · Solana mainnet</p>
              <p className="text-xs text-text-300">Send to the Husher deposit address below. This order has not been funded by DONCHAIN.</p>
              <p className="select-all break-all border border-line-100 bg-bg-50 p-3 font-mono text-xs text-text-100">{current.depositAddress}</p>
              <div className="flex flex-wrap gap-2"><button type="button" className={cx(smallBtn, "flex h-8 items-center gap-1.5")} onClick={() => copy(current.depositAddress!)}><Copy className="h-3.5 w-3.5" /> Copy address</button><button type="button" className={cx(smallBtn, "h-8")} onClick={() => copy(current.depositSol!)}>Copy amount</button></div>
            </div> : !current.remoteId ? <p className="text-xs leading-relaxed text-text-300">The creation outcome needs review. No deposit instruction is available and DONCHAIN has sent no funds. Check your order history on Husher before starting another order.</p> : null}
            <div className="grid grid-cols-2 gap-2 text-xs text-text-300"><span>Deposit total</span><span className="text-right text-text-100">{current.plan.totalSol} SOL</span><span>Quoted output (estimate)</span><span className="text-right text-text-100">{current.quote.receiveSol} SOL</span><span>Exchange fee</span><span className="text-right text-text-100">{current.feeSol !== null ? `${current.feeSol} SOL` : "—"}</span><span>Network fee</span><span className="text-right text-text-100">{current.networkFeeSol !== null ? `${current.networkFeeSol} SOL` : "—"}</span></div>
            <div className="rounded-[10px] border border-line-100">{current.recipients.map((r) => <div key={r.address} className="border-b border-line-50 px-3 py-2 text-xs last:border-b-0"><div className="flex justify-between gap-2"><span className="text-text-100">{short(r.address)}</span><span className="text-text-200">{r.status} · {r.receiveSol} SOL</span></div>{r.hashOut ? <a href={`https://solscan.io/tx/${encodeURIComponent(r.hashOut)}`} target="_blank" rel="noopener noreferrer" className={external}>Withdrawal transaction</a> : null}</div>)}</div>
            <div className="flex gap-3 text-xs">
              {current.hashIn ? <a href={`https://solscan.io/tx/${encodeURIComponent(current.hashIn)}`} target="_blank" rel="noopener noreferrer" className={external}>Deposit transaction</a> : null}
              {current.trackingUrl ? <a href={current.trackingUrl} target="_blank" rel="noopener noreferrer" className={external}>Husher tracking page</a> : null}
            </div>
            <button type="button" className={primary} onClick={() => { setOrder(null); setHistory(true); state.refresh(); }}>Back to history</button>
          </>
        ) : history ? (
          <>
            <p className="text-xs text-text-300">Orders are saved locally and can be reopened after a restart.</p>
            {state.data?.orders.length ? <div className="rounded-[10px] border border-line-100">{state.data.orders.map((o) => <button key={o.id} type="button" className="flex w-full items-center justify-between gap-3 border-b border-line-50 px-3 py-2.5 text-left last:border-b-0 hover:bg-white/[0.03]" onClick={() => setOrder(o)}><div><p className="text-sm text-text-100">{o.plan.totalSol} SOL · {o.plan.recipients.length} wallets</p><p className="mt-0.5 text-[11px] text-text-300">{new Date(o.at).toLocaleString()} · {o.orderId || o.id.slice(0, 8)}</p></div><span className="text-xs text-accent">{o.status}</span></button>)}</div> : <p className="px-1 py-4 text-sm text-text-300">No mixer orders yet.</p>}
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs text-text-300">Service</label>
              <div className="grid grid-cols-2 gap-1 rounded border border-line-100 bg-bg-50 p-0.5">
                {(["husher", "splitnow"] as const).map((s) => <button key={s} type="button" onClick={() => { setService(s); change(); }} className={cx("h-7 rounded text-xs font-medium transition-colors", service === s ? "bg-accent/15 text-accent" : "text-text-300 hover:text-text-100")}>{s === "husher" ? "Husher" : "SplitNOW"}</button>)}
              </div>
            </div>
            {service === "splitnow" ? <p className="text-xs leading-relaxed text-text-300">SplitNOW is not connected to DONCHAIN. Use Husher for SOL → SOL splits across your wallets.</p> : null}
            {service === "husher" && state.data && !state.data.configured ? <div className="space-y-2 rounded-[10px] border border-line-100 p-3"><label htmlFor="husher-api-key" className="block text-xs text-text-300">Husher API key</label><div className="flex gap-2"><input id="husher-api-key" type="password" className={field} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="Paste your key" disabled={!!busy} /><button type="button" className={smallBtn} onClick={saveKey} disabled={!apiKey || !!busy || !vault.data?.unlocked}>Save key</button></div><p className="text-[11px] text-text-300">Unlock your vault to save the key. It stays on the local server and is never returned to the browser.</p></div> : null}
            {!mainnet ? <p className="text-xs text-yellow-100">The mixer uses real SOL. Switch to mainnet in <Link href="/settings" className={external}>Settings</Link>.</p> : null}
            <div>
              <label htmlFor="husher-total" className="mb-1 block text-xs text-text-300">Total to mix (SOL)</label>
              <div className="flex gap-2">
                <input id="husher-total" className={field} placeholder="0.05" inputMode="decimal" value={total} disabled={!!busy} onChange={(e) => { setTotal(e.target.value); change(); }} />
                <button type="button" className={smallBtn} disabled={!!busy || !total.trim() || !chosen.length} onClick={() => split()}>Split equal</button>
              </div>
              <p className="mt-1 text-[11px] text-text-300">{min ? `Min ${min} SOL per wallet` : "Min checked by the quote"} · sol · splits across selected wallets</p>
            </div>
            <div className="rounded-[10px] border border-line-100">
              <div className="flex items-center justify-between border-b border-line-50 px-3 py-2">
                <span className="text-xs text-text-300">Destinations ({chosen.length}/{live.length})</span>
                {chosen.length ? <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setChosen([]); setAllocations({}); change(); }}>Clear</button> : <button type="button" className="text-xs text-accent hover:underline" onClick={() => { const all = live.map((w) => w.address); setChosen(all); if (total.trim()) split(all); else change(); }}>All</button>}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {live.length ? live.map((w) => {
                  const on = chosen.includes(w.address);
                  return (
                    <div key={w.address} className="flex items-center gap-3 px-3 py-2">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => { setChosen((prev) => e.target.checked ? [...prev, w.address] : prev.filter((a) => a !== w.address)); change(); }} className="h-4 w-4 shrink-0 accent-accent" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-text-100">{w.label || short(w.address)}</span>
                          <span className="block truncate text-[11px] text-text-300">{short(w.address)} · {sol(balances?.[w.address] ?? w.sol)} SOL</span>
                        </span>
                      </label>
                      <input aria-label={`Allocation for ${w.label || w.address}`} inputMode="decimal" placeholder="0" className={cx(fieldBase, "w-[120px] shrink-0 text-right font-mono text-xs")} value={allocations[w.address] || ""} disabled={!on || !!busy} onChange={(e) => { setAllocations((p) => ({ ...p, [w.address]: e.target.value })); change(); }} />
                    </div>
                  );
                }) : <p className="px-3 py-4 text-sm text-text-300">No wallets in this section.</p>}
              </div>
              <div className="flex items-center justify-between border-t border-line-50 px-3 py-2 text-xs">
                <span className="text-text-300">Deposit total</span>
                <span className="font-medium text-text-100">{depositLam > BigInt(0) ? formatHusherSol(depositLam) : "0"} SOL</span>
              </div>
            </div>
            {problem ? <p className="text-[11px] leading-relaxed text-text-300">{problem}</p> : null}
            <button type="button" className={primary} disabled={service !== "husher" || !!busy || !total.trim() || !!problem || !mainnet || !state.data?.configured} onClick={fetchQuote}>{busy === "quote" ? "Fetching quote…" : "Fetch Quote"}</button>
            {quote ? <div className="space-y-3 rounded-[10px] border border-accent/25 bg-accent/5 p-3"><div className="flex justify-between text-sm"><span className="text-text-200">Estimated total received</span><span className="font-medium text-text-100">{quote.receiveSol} SOL</span></div><div className="max-h-32 space-y-1 overflow-y-auto">{quote.rates.map((r) => <p key={r.address} className="flex justify-between text-xs text-text-300"><span>{short(r.address)}</span><span>{r.receiveSol} SOL</span></p>)}</div><p className="text-[11px] leading-relaxed text-text-300">Floating estimate after Husher fees. Review within 60 seconds; the final amount may change during execution. Creating the order generates deposit instructions and sends no funds.</p><label className="flex items-start gap-2 text-xs leading-relaxed text-text-200"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={!!busy} className="mt-0.5 accent-accent" /><span>I agree to Husher&apos;s <a className={external} href="https://www.husher.io/terms-of-service" target="_blank" rel="noopener noreferrer">Terms</a>, <a className={external} href="https://www.husher.io/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and <a className={external} href="https://www.husher.io/anti-money-policy" target="_blank" rel="noopener noreferrer">AML Policy</a>, and authorize sharing the selected destination addresses with Husher to create this order.</span></label><button type="button" className={primary} disabled={!consent || !!busy || !mainnet} onClick={create}>{busy === "create" ? "Creating order…" : "Create order"}</button></div> : null}
            <p className="text-[11px] leading-relaxed text-text-300">Exchange execution is provided by Husher. Transactions may be delayed or subject to checks. This does not guarantee that wallet addresses become unlinkable.</p>
          </>
        )}
      </div>
    </Drawer>
  );
}
