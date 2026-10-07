"use client";
/** Mixer · Developer Wallets — Block X's Mixer route as a right-side drawer (design/blockx/portfolio-mixer.html):
 *  1. Service (Husher | SplitNOW), then two tabs: From = the wallets that send (amount each, Max) and To = the
 *     wallets that receive (Total to mix = From total, Split equal, one allocation each), Fetch Quote.
 *  2. Quote total · Providers N available · Provider & delay per wallet (best provider preselected, Delay all).
 *  3. Deposit address (QR / Address only) · "Send X SOL to start the mixer" · Pay from wallet · Status · Done.
 *  Only Husher is wired. Funds move only when the user deposits by hand or confirms Pay from wallet. */
import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/portfolio/Drawers";
import { BxJob } from "@/components/bx/Job";
import { cx } from "@/components/bx/ui";
import { failureMessage, post, useGet } from "@/lib/api";
import { refreshVaultDependents, useSettings, useVault } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import type { WalletInfo } from "@/lib/types";
import { HUSHER_KEEP_LAM, HUSHER_MAX_DELAY_MIN, HUSHER_MAX_SOURCES, HUSHER_PROVIDERS, formatHusherSol, husherAllocation, parseHusherSol, providerLabel, splitHusherSol, type HusherOrder, type HusherPlan, type HusherQuote, type HusherState } from "@/lib/husher";

const fieldBase = "border border-line-100 bg-bg-50 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent disabled:opacity-50";
const field = `w-full ${fieldBase}`;
const smallBtn = "shrink-0 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45";
const primary = "h-9 w-full rounded border border-accent/40 bg-accent/15 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50";
const solid = "h-10 w-full rounded bg-accent text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50";
const card = "rounded-[10px] border border-line-100";
const external = "inline underline text-accent";
/** SOL kept for the deposit transaction fee when listing wallets that can pay. */
const PAY_FEE_LAM = BigInt(10_000);
const FINAL = ["Complete", "Failed", "Refunded"];

function lamOf(v: string | null | undefined): bigint {
  try { return parseHusherSol(String(v ?? "")); } catch { return BigInt(0); }
}

function ProviderMark({ provider }: { provider: string }) {
  const p = HUSHER_PROVIDERS[provider];
  return <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold text-black" style={{ background: p?.color ?? "#888" }}>{(p?.label ?? provider).slice(0, 1)}</span>;
}

function useQr(text: string | null) {
  const [qr, setQr] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: 164, color: { dark: "#000000", light: "#ffffff" } }).then((url) => alive && setQr({ text, url }));
    return () => { alive = false; };
  }, [text]);
  return qr && qr.text === text ? qr.url : null;
}

function QrImage({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side
  return <img src={src} alt="Deposit address QR code" width={164} height={164} className="rounded-lg bg-white p-1.5" />;
}

/** Block X's provider dropdown: logo · name · ~receive, list sorted best first. */
function ProviderSelect({ value, options, onChange, disabled }: { value: string; options: { provider: string; receiveSol: string }[]; onChange: (p: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.provider === value) ?? options[0];
  return (
    <div className="relative min-w-0 flex-1">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={cx(fieldBase, "flex h-9 w-full items-center gap-2 text-left")}>
        <ProviderMark provider={cur.provider} />
        <span className="min-w-0 flex-1 truncate">{providerLabel(cur.provider)} · ~{cur.receiveSol} SOL</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-300" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[1]" onMouseDown={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-[2] mt-1 overflow-hidden rounded border border-line-100 bg-bg-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            {options.map((o) => (
              <button key={o.provider} type="button" onClick={() => { onChange(o.provider); setOpen(false); }} className={cx("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-white/[0.04]", o.provider === cur.provider ? "bg-accent/10 text-accent" : "text-text-100")}>
                <ProviderMark provider={o.provider} />
                <span className="flex-1">{providerLabel(o.provider)}</span>
                <span className="text-xs text-text-300">~{o.receiveSol} SOL</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MinutesInput({ value, onChange, disabled, className }: { value: string; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  return (
    <div className={cx("relative shrink-0", className)}>
      <input inputMode="numeric" placeholder="0" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))} className={cx(fieldBase, "h-9 w-full pr-10 text-right font-mono")} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-300">min</span>
    </div>
  );
}

export function HusherMixer({ wallets, balances = null, selected = [], onClose }: { wallets: WalletInfo[]; balances?: Record<string, string | null> | null; selected?: string[]; onClose: () => void }) {
  const live = wallets.filter((w) => !w.archived);
  const [service, setService] = useState<"husher" | "splitnow">("husher");
  const [chosen, setChosen] = useState<string[]>(() => selected.length ? live.filter((w) => selected.includes(w.address)).map((w) => w.address) : live.map((w) => w.address));
  const [manualTotal, setTotal] = useState("");
  const [tab, setTab] = useState<"from" | "to">("from");
  const [fromSel, setFromSel] = useState<string[]>([]);
  const [fromAmt, setFromAmt] = useState<Record<string, string>>({});
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<HusherQuote | null>(null);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [delays, setDelays] = useState<Record<string, string>>({});
  const [delayAll, setDelayAll] = useState("");
  const [order, setOrder] = useState<HusherOrder | null>(null);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState<"quote" | "create" | "key" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [addressOnly, setAddressOnly] = useState(false);
  const [confirmPay, setConfirmPay] = useState<string | null>(null);
  const settings = useSettings(); const vault = useVault();
  const state = useGet<HusherState>("/api/husher", 15000);
  const limits = useGet<{ minimumSol: number | null }>(state.data?.configured ? "/api/husher/quote" : null, 60000);
  const finished = !!order && FINAL.includes(order.status);
  const tracked = useGet<HusherOrder>(order?.remoteId ? `/api/husher/orders/${encodeURIComponent(order.id)}` : null, finished ? 0 : 8000);
  const current = tracked.data?.id === order?.id ? tracked.data : order;
  const qr = useQr(current?.depositAddress ?? null);
  const mainnet = settings.data?.cluster === "mainnet";
  const unlocked = !!vault.data?.unlocked;
  const balOf = (w: WalletInfo) => balances?.[w.address] ?? w.sol;
  const nameOfW = (w: WalletInfo) => w.label || short(w.address);
  const balLam = (w: WalletInfo) => lamOf(String(balOf(w) ?? ""));
  const sendLam = fromSel.reduce((a, addr) => a + lamOf(fromAmt[addr]), BigInt(0));
  /** with From wallets the total is theirs; without, it is typed (deposit by hand or from one wallet later) */
  const total = fromSel.length ? (sendLam > BigInt(0) ? formatHusherSol(sendLam) : "") : manualTotal;
  const dests = live.filter((w) => !fromSel.includes(w.address));
  let fromProblem: string | null = null;
  for (const a of fromSel) {
    const w = live.find((x) => x.address === a); if (!w) continue;
    const lam = lamOf(fromAmt[a]);
    if (lam <= BigInt(0)) { fromProblem = `${nameOfW(w)}: enter the SOL it sends.`; break; }
    if (lam > balLam(w)) { fromProblem = `${nameOfW(w)} holds only ${sol(balOf(w))} SOL.`; break; }
  }
  const plan: HusherPlan = { totalSol: total, recipients: chosen.map((address) => ({ address, label: live.find((w) => w.address === address)?.label || short(address), sol: allocations[address] || "" })) };
  const depositLam = chosen.reduce((a, addr) => a + lamOf(allocations[addr]), BigInt(0));
  let problem: string | null = null;
  if (total.trim()) { try { husherAllocation(plan); } catch (e) { problem = failureMessage(e); } }
  const change = () => { setQuote(null); setConsent(false); setError(null); };
  const nameOf = (addr: string) => live.find((w) => w.address === addr)?.label || short(addr);
  function split(addresses = chosen) {
    if (!addresses.length) return;
    try {
      const amounts = splitHusherSol(total, addresses.length);
      setAllocations(Object.fromEntries(addresses.map((a, i) => [a, amounts[i]]))); change();
    } catch (e) { setError(failureMessage(e)); }
  }
  async function fetchQuote() {
    setBusy("quote"); setError(null); setQuote(null); setConsent(false);
    try {
      const q = await post<HusherQuote>("/api/husher/quote", plan);
      setQuote(q);
      setProviders(Object.fromEntries(q.rates.map((r) => [r.address, r.options[0].provider])));
      setDelays(Object.fromEntries(q.rates.map((r) => [r.address, delayAll])));
    }
    catch (e) { setError(failureMessage(e)); }
    finally { setBusy(null); }
  }
  const delayOf = (addr: string) => Number(delays[addr] || "0");
  const badDelay = !!quote && quote.rates.some((r) => !(delayOf(r.address) <= HUSHER_MAX_DELAY_MIN));
  async function create() {
    if (!quote) return;
    setBusy("create"); setError(null);
    try {
      const picks = quote.rates.map((r) => ({ address: r.address, provider: providers[r.address] ?? r.options[0].provider, delayMin: delayOf(r.address) }));
      const sources = fromSel.map((address) => ({ address, sol: fromAmt[address] }));
      setOrder(await post<HusherOrder>("/api/husher", { quoteId: quote.id, consent, picks, sources })); state.refresh();
    }
    catch (e) { setError(failureMessage(e)); }
    finally { setBusy(null); }
  }
  function toggleFrom(addr: string, on: boolean) {
    setFromSel((prev) => on ? [...prev, addr] : prev.filter((a) => a !== addr));
    if (on) { setChosen((prev) => prev.filter((a) => a !== addr)); setAllocations((p) => { const n = { ...p }; delete n[addr]; return n; }); }
    change();
  }
  function maxFrom(w: WalletInfo) {
    const lam = balLam(w) - HUSHER_KEEP_LAM;
    setFromAmt((p) => ({ ...p, [w.address]: lam > BigInt(0) ? formatHusherSol(lam) : "" })); change();
  }
  async function pay(from: string | null) {
    if (!current) return;
    setBusy("pay"); setError(null);
    try { setOrder(await post<HusherOrder>(`/api/husher/orders/${encodeURIComponent(current.id)}/pay`, from ? { from } : {})); setConfirmPay(null); tracked.refresh(); refreshVaultDependents(); toast("Deposit sent", "ok"); }
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
  const awaiting = !!current && !!current.depositAddress && !!current.depositSol && !current.error && !tracked.error && current.status === "Awaiting Deposit" && !current.hashIn;
  const destinations = new Set(current?.plan.recipients.map((r) => r.address) ?? []);
  const needLam = lamOf(current?.depositSol) + PAY_FEE_LAM;
  const payers = live.filter((w) => !destinations.has(w.address) && lamOf(balOf(w)) >= needLam);
  const pickOf = (addr: string) => current?.picks?.find((p) => p.address === addr);
  return (
    <Drawer title="Mixer · Developer Wallets" onClose={close} right={<button type="button" disabled={!!busy} className="text-xs text-accent hover:underline disabled:opacity-50" onClick={() => { setHistory(!history || !!current); setOrder(null); }}>{history || current ? "New order" : "History"}</button>}>
      <div className="flex flex-col gap-3 p-4">
        {error || state.error ? <p role="alert" className="rounded border border-decrease/30 bg-decrease/10 p-3 text-xs text-decrease">{error || failureMessage(state.error)}</p> : null}
        {current ? (
          <>
            {current.error || tracked.error ? <p role="alert" className="rounded border border-decrease/30 bg-decrease/10 p-3 text-xs leading-relaxed text-decrease">{current.error || failureMessage(tracked.error)}</p> : null}
            {awaiting ? (
              <div className={cx(card, "p-4")}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-300">Deposit address</span>
                  <button type="button" className={cx(smallBtn, "h-7")} onClick={() => setAddressOnly(!addressOnly)}>{addressOnly ? "Show QR" : "Address only"}</button>
                </div>
                {!addressOnly ? <div className="my-4 flex justify-center">{qr ? <QrImage src={qr} /> : <div className="h-[164px] w-[164px] rounded-lg bg-white/5" />}</div> : null}
                <div className={cx("flex items-center gap-2", addressOnly && "mt-3")}>
                  <span className="min-w-0 flex-1 select-all break-all font-mono text-xs text-text-100">{current.depositAddress}</span>
                  <button type="button" aria-label="Copy deposit address" className="shrink-0 text-text-300 hover:text-accent" onClick={() => copy(current.depositAddress!)}><Copy className="h-4 w-4" /></button>
                </div>
                <p className="mt-3 text-sm text-text-200">Send <button type="button" className="font-semibold text-text-100 hover:text-accent" onClick={() => copy(current.depositSol!)}>{current.depositSol} SOL</button> to start the mixer.</p>
              </div>
            ) : null}
            {awaiting ? (
              <div className={card}>
                <div className="border-b border-line-50 px-3 py-2 text-[13px] font-medium text-text-100">Pay from wallet</div>
                {current.payment ? (
                  <div className="space-y-2 px-3 py-3 text-xs text-text-300"><p>Paying from {(current.payment.sources ?? [{ address: current.payment.from, sol: current.depositSol ?? "" }]).map((x) => nameOf(x.address)).join(", ")} · one transaction</p><BxJob jobId={current.payment.jobId} compact /></div>
                ) : !unlocked ? (
                  <p className="px-3 py-3 text-sm text-text-300">Unlock the vault to pay from your wallets.</p>
                ) : current.sources?.length ? (
                  <div>
                    {current.sources.map((x) => <div key={x.address} className="flex items-center justify-between gap-3 border-b border-line-50 px-3 py-2 text-sm"><span className="min-w-0"><span className="block truncate font-medium text-text-100">{nameOf(x.address)}</span><span className="block text-[11px] text-text-300">{short(x.address)}</span></span><span className="font-mono text-xs text-text-100">{x.sol} SOL</span></div>)}
                    <div className="flex items-center justify-end gap-1.5 px-3 py-2.5">
                      {confirmPay === "sources"
                        ? <><button type="button" className={cx(smallBtn, "h-8")} disabled={!!busy} onClick={() => setConfirmPay(null)}>Cancel</button><button type="button" className="h-8 rounded bg-accent px-3 text-xs font-medium text-white disabled:opacity-50" disabled={!!busy} onClick={() => pay(null)}>{busy === "pay" ? "Sending…" : `Confirm · send ${current.depositSol} SOL`}</button></>
                        : <button type="button" className={cx(smallBtn, "h-8")} disabled={!!busy} onClick={() => setConfirmPay("sources")}>Pay {current.depositSol} SOL from {current.sources.length} wallet{current.sources.length > 1 ? "s" : ""}</button>}
                    </div>
                  </div>
                ) : payers.length ? (
                  <div className="max-h-56 overflow-y-auto">
                    {payers.map((w) => (
                      <div key={w.address} className="flex items-center gap-3 border-b border-line-50 px-3 py-2 last:border-b-0">
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text-100">{w.label || short(w.address)}</span><span className="block text-[11px] text-text-300">{short(w.address)} · {sol(balOf(w))} SOL</span></span>
                        {confirmPay === w.address
                          ? <span className="flex gap-1.5"><button type="button" className={cx(smallBtn, "h-8")} disabled={!!busy} onClick={() => setConfirmPay(null)}>Cancel</button><button type="button" className="h-8 rounded bg-accent px-3 text-xs font-medium text-white disabled:opacity-50" disabled={!!busy} onClick={() => pay(w.address)}>{busy === "pay" ? "Sending…" : `Send ${current.depositSol} SOL`}</button></span>
                          : <button type="button" className={cx(smallBtn, "h-8")} disabled={!!busy} onClick={() => setConfirmPay(w.address)}>Pay</button>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-3 text-sm text-text-300">No wallets have enough SOL.</p>
                )}
              </div>
            ) : null}
            <div className={cx(card, "grid grid-cols-2 gap-y-2 px-3 py-3 text-sm")}>
              <span className="text-text-300">Status</span><span className="flex items-center justify-end gap-2 font-medium text-text-100">{current.status}{current.remoteId ? <button type="button" aria-label="Refresh status" disabled={tracked.loading} onClick={() => tracked.refresh()} className="text-text-300 hover:text-accent disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /></button> : null}</span>
              <span className="text-text-300">Service</span><span className="text-right font-medium text-text-100">Husher</span>
              <span className="text-text-300">Order</span><span className="text-right font-mono text-xs font-medium leading-5 text-text-100">#{current.orderId || current.id.slice(0, 8)}</span>
              <span className="text-text-300">Destinations</span><span className="text-right font-medium text-text-100">{current.plan.recipients.length} wallets</span>
              {current.feeSol !== null ? <><span className="text-text-300">Exchange fee</span><span className="text-right text-text-100">{current.feeSol} SOL</span></> : null}
            </div>
            {current.status === "Creation needs review" ? <p className="text-xs leading-relaxed text-text-300">The creation outcome needs review. No deposit instruction is available and no funds were sent. Check your order history on Husher before starting another order.</p> : null}
            {current.recipients.length ? (
              <div className={card}>
                {current.recipients.map((r) => {
                  const p = pickOf(r.address);
                  return (
                    <div key={r.address} className="border-b border-line-50 px-3 py-2 text-xs last:border-b-0">
                      <div className="flex justify-between gap-2"><span className="text-text-100">{nameOf(r.address)}</span><span className="text-text-200">{r.status} · {r.receiveSol} SOL</span></div>
                      <div className="mt-0.5 flex justify-between gap-2 text-[11px] text-text-300"><span>{p ? `${providerLabel(p.provider)} · ${p.delayMin ? `${p.delayMin} min delay` : "instant"}` : short(r.address)}</span>{r.hashOut ? <a href={`https://solscan.io/tx/${encodeURIComponent(r.hashOut)}`} target="_blank" rel="noopener noreferrer" className={external}>Withdrawal tx</a> : null}</div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="flex gap-3 text-xs">
              {current.hashIn ? <a href={`https://solscan.io/tx/${encodeURIComponent(current.hashIn)}`} target="_blank" rel="noopener noreferrer" className={external}>Deposit transaction</a> : null}
              {current.trackingUrl ? <a href={current.trackingUrl} target="_blank" rel="noopener noreferrer" className={external}>Husher tracking page</a> : null}
            </div>
            {current.status === "Rejected" ? <button type="button" className={primary} disabled={!!busy} onClick={() => { setOrder(null); setQuote(null); setConsent(false); setHistory(false); setError(null); }}>New quote</button> : null}
            <button type="button" className={solid} disabled={!!busy} onClick={onClose}>Done</button>
          </>
        ) : history ? (
          <>
            <p className="text-xs text-text-300">Orders are saved locally and can be reopened after a restart.</p>
            {state.data?.orders.length ? <div className={card}>{state.data.orders.map((o) => <button key={o.id} type="button" className="flex w-full items-center justify-between gap-3 border-b border-line-50 px-3 py-2.5 text-left last:border-b-0 hover:bg-white/[0.03]" onClick={() => { setOrder(o); setHistory(false); }}><div><p className="text-sm text-text-100">{o.plan.totalSol} SOL · {o.plan.recipients.length} wallets</p><p className="mt-0.5 text-[11px] text-text-300">{new Date(o.at).toLocaleString()} · #{o.orderId || o.id.slice(0, 8)}</p></div><span className="text-xs text-accent">{o.status}</span></button>)}</div> : <p className="px-1 py-4 text-sm text-text-300">No mixer orders yet.</p>}
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
            {service === "husher" && state.data && !state.data.configured ? <div className={cx(card, "space-y-2 p-3")}><label htmlFor="husher-api-key" className="block text-xs text-text-300">Husher API key</label><div className="flex gap-2"><input id="husher-api-key" type="password" className={field} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="Paste your key" disabled={!!busy} /><button type="button" className={smallBtn} onClick={saveKey} disabled={!apiKey || !!busy || !unlocked}>Save key</button></div><p className="text-[11px] text-text-300">Unlock your vault to save the key. It stays on the local server and is never returned to the browser.</p></div> : null}
            {!mainnet ? <p className="text-xs text-yellow-100">The mixer uses real SOL. Switch to mainnet in <Link href="/settings" className={external}>Settings</Link>.</p> : null}
            <div className="grid grid-cols-2 gap-1 rounded border border-line-100 bg-bg-50 p-0.5">
              {(["from", "to"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cx("h-8 rounded text-xs font-medium transition-colors", tab === t ? "bg-accent/15 text-accent" : "text-text-300 hover:text-text-100")}>{t === "from" ? `1 · From (${fromSel.length})` : `2 · To (${chosen.length})`}</button>)}
            </div>
            {tab === "from" ? (
              <>
                <div className={card}>
                  <div className="flex items-center justify-between border-b border-line-50 px-3 py-2">
                    <span className="text-xs text-text-300">Sending wallets ({fromSel.length}/{Math.min(HUSHER_MAX_SOURCES, live.length)})</span>
                    {fromSel.length ? <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setFromSel([]); change(); }}>Clear</button> : null}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {live.length ? live.map((w) => {
                      const on = fromSel.includes(w.address);
                      const full = !on && fromSel.length >= HUSHER_MAX_SOURCES;
                      return (
                        <div key={w.address} className="flex items-center gap-3 px-3 py-2">
                          <label className={cx("flex min-w-0 flex-1 items-center gap-2.5", full ? "opacity-50" : "cursor-pointer")}>
                            <input type="checkbox" checked={on} disabled={!!busy || full} onChange={(e) => toggleFrom(w.address, e.target.checked)} className="h-4 w-4 shrink-0 accent-accent" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-text-100">{nameOfW(w)}</span>
                              <span className="block truncate text-[11px] text-text-300">{short(w.address)} · {sol(balOf(w))} SOL</span>
                            </span>
                          </label>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <input aria-label={`Amount sent by ${nameOfW(w)}`} inputMode="decimal" placeholder="0" className={cx(fieldBase, "w-[96px] text-right font-mono text-xs")} value={fromAmt[w.address] || ""} disabled={!on || !!busy} onChange={(e) => { setFromAmt((p) => ({ ...p, [w.address]: e.target.value })); change(); }} />
                            <button type="button" className={cx(smallBtn, "h-[34px] px-2")} disabled={!on || !!busy} onClick={() => maxFrom(w)}>Max</button>
                          </div>
                        </div>
                      );
                    }) : <p className="px-3 py-4 text-sm text-text-300">No wallets in this section.</p>}
                  </div>
                  <div className="flex items-center justify-between border-t border-line-50 px-3 py-2 text-xs">
                    <span className="text-text-300">Sending total</span>
                    <span className="font-medium text-text-100">{sendLam > BigInt(0) ? formatHusherSol(sendLam) : "0"} SOL</span>
                  </div>
                </div>
                {fromProblem ? <p className="text-[11px] leading-relaxed text-decrease">{fromProblem}</p> : null}
                <p className="text-[11px] leading-relaxed text-text-300">The sending wallets pay the deposit together, in one transaction, once the order exists. Max keeps 0.001 SOL for the fee and rent. Pick none to deposit by hand.</p>
                <button type="button" className={primary} onClick={() => setTab("to")}>Next · Destinations</button>
              </>
            ) : (<>
            <div>
              <label htmlFor="husher-total" className="mb-1 block text-xs text-text-300">Total to mix (SOL)</label>
              <div className="flex gap-2">
                <input id="husher-total" className={cx(field, fromSel.length > 0 && "text-text-200")} placeholder="0.05" inputMode="decimal" value={total} readOnly={fromSel.length > 0} title={fromSel.length ? "Total of the From wallets" : undefined} disabled={!!busy} onChange={(e) => { if (!fromSel.length) { setTotal(e.target.value); change(); } }} />
                <button type="button" className={smallBtn} disabled={!!busy || !total.trim() || !chosen.length} onClick={() => split()}>Split equal</button>
              </div>
              <p className="mt-1 text-[11px] text-text-300">{min ? `Min ${min} SOL per wallet` : "Min checked by the quote"} · sol · splits across selected wallets{fromSel.length ? ` · from ${fromSel.length} wallet${fromSel.length > 1 ? "s" : ""}` : ""}</p>
            </div>
            <div className={card}>
              <div className="flex items-center justify-between border-b border-line-50 px-3 py-2">
                <span className="text-xs text-text-300">Destinations ({chosen.length}/{dests.length})</span>
                {chosen.length ? <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setChosen([]); setAllocations({}); change(); }}>Clear</button> : <button type="button" className="text-xs text-accent hover:underline" onClick={() => { const all = dests.map((w) => w.address); setChosen(all); if (total.trim()) split(all); else change(); }}>All</button>}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {dests.length ? dests.map((w) => {
                  const on = chosen.includes(w.address);
                  return (
                    <div key={w.address} className="flex items-center gap-3 px-3 py-2">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => { setChosen((prev) => e.target.checked ? [...prev, w.address] : prev.filter((a) => a !== w.address)); change(); }} className="h-4 w-4 shrink-0 accent-accent" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-text-100">{w.label || short(w.address)}</span>
                          <span className="block truncate text-[11px] text-text-300">{short(w.address)} · {sol(balOf(w))} SOL</span>
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
            <button type="button" className={primary} disabled={service !== "husher" || !!busy || !total.trim() || !!problem || !!fromProblem || !mainnet || !state.data?.configured} onClick={fetchQuote}>{busy === "quote" ? "Fetching quote…" : quote ? "Refresh Quote" : "Fetch Quote"}</button>
            {quote ? (
              <>
                <div className={cx(card, "grid grid-cols-2 gap-y-2 px-3 py-3 text-sm")}>
                  <span className="text-text-300">Quote total</span><span className="text-right font-semibold text-text-100">{quote.totalSol} SOL</span>
                  <span className="text-text-300">Providers</span><span className="text-right font-semibold text-text-100">{quote.providers.length} available</span>
                </div>
                <div className={card}>
                  <div className="flex items-center justify-between gap-3 border-b border-line-50 px-3 py-2">
                    <span className="text-xs text-text-300">Provider &amp; delay per wallet</span>
                    <span className="flex items-center gap-2 text-xs text-text-300">Delay all<MinutesInput className="w-[96px]" value={delayAll} disabled={!!busy} onChange={(v) => { setDelayAll(v); setDelays(Object.fromEntries(quote.rates.map((r) => [r.address, v]))); }} /></span>
                  </div>
                  <div>
                    {quote.rates.map((r) => {
                      const prov = providers[r.address] ?? r.options[0].provider;
                      const opt = r.options.find((o) => o.provider === prov) ?? r.options[0];
                      return (
                        <div key={r.address} className="border-b border-line-50 px-3 py-3 last:border-b-0">
                          <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium text-text-100">{nameOf(r.address)}</span><span className="text-sm font-medium text-accent">~{opt.receiveSol} SOL</span></div>
                          <div className="flex justify-between gap-2 text-[11px] text-text-300"><span>{short(r.address)} · in {r.sendSol} SOL</span><span>est. out</span></div>
                          <div className="mt-2 flex gap-2">
                            <ProviderSelect value={prov} options={r.options} disabled={!!busy} onChange={(p) => setProviders((m) => ({ ...m, [r.address]: p }))} />
                            <MinutesInput className="w-[110px]" value={delays[r.address] ?? ""} disabled={!!busy} onChange={(v) => setDelays((m) => ({ ...m, [r.address]: v }))} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {badDelay ? <p className="text-[11px] text-decrease">Delay is at most {HUSHER_MAX_DELAY_MIN} min (7 days).</p> : null}
                <label className="flex items-start gap-2 text-[11px] leading-relaxed text-text-300"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={!!busy} className="mt-0.5 accent-accent" /><span>I agree to Husher&apos;s <a className={external} href="https://www.husher.io/terms-of-service" target="_blank" rel="noopener noreferrer">Terms</a>, <a className={external} href="https://www.husher.io/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and <a className={external} href="https://www.husher.io/anti-money-policy" target="_blank" rel="noopener noreferrer">AML Policy</a>, and to share the selected destination addresses with Husher.</span></label>
                <button type="button" className={solid} disabled={!consent || !!busy || !mainnet || badDelay} onClick={create}>{busy === "create" ? <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Creating order…</span> : <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" /> Create order</span>}</button>
                <p className="text-[11px] leading-relaxed text-text-300">Estimates float until execution. Creating the order only gives a deposit address; nothing is sent until you deposit{fromSel.length ? " or confirm Pay" : ""}.</p>
              </>
            ) : null}
            </>)}
          </>
        )}
      </div>
    </Drawer>
  );
}
