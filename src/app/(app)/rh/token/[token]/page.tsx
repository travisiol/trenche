"use client";
/** Robinhood mode › a Pons V2 token: chart and trades from the curve's events, your wallets on it (dev, bundle, others)
 *  with buy / sell per wallet or for a selection, Sell All, PnL. Refreshed every 1.5 s. */
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Gift, Zap } from "lucide-react";
import { failureMessage, post, useGet } from "@/lib/api";
import { age, short } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxInput, cx } from "@/components/bx/ui";
import { Copyable, EXPLORER, EvmTx, PONS_PAGE, TokenAvatar, eth, ethNum, signed, tokens, tone, usdOf, type RhHolder, type RhTokenView, type RhTradeResult } from "@/components/rh/common";
import { RhChart } from "@/components/rh/RhChart";
import { pushRhRecent } from "@/components/rh/recent";

export default function RhTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const view = useGet<RhTokenView>(`/api/robinhood/token/${token}`, 1500);
  const v = view.data;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [buyAmt, setBuyAmt] = useState("0.005");
  const [rowAmt, setRowAmt] = useState<Record<string, string>>({});
  const [onlyMine, setOnlyMine] = useState(false);
  useEffect(() => {
    if (v) pushRhRecent({ token: v.token, symbol: v.symbol, image: v.image });
    // once per token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.token]);
  const usd = v?.ethUsd ?? null;
  const mine = useMemo(() => new Set((v?.holders ?? []).map((h) => h.address.toLowerCase())), [v?.holders]);
  const labelOf = (a: string) => v?.holders.find((h) => h.address.toLowerCase() === a.toLowerCase())?.label ?? null;
  const holders = (v?.holders ?? []).filter((h) => h.dev || h.bundle || BigInt(h.tokensWei) > BigInt(0) || BigInt(h.boughtWei) > BigInt(0));
  const others = (v?.holders ?? []).filter((h) => !holders.includes(h));
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? [...holders, ...others] : holders;
  const held = rows.filter((h) => BigInt(h.tokensWei) > BigInt(0));
  const selList = [...sel];

  const trade = async (key: string, body: Record<string, unknown>, what: string) => {
    setBusy(key);
    try {
      const r = await post<{ results: RhTradeResult[] }>("/api/robinhood/trade", { token, ...body });
      const ok = r.results.filter((x) => x.ok);
      const bad = r.results.filter((x) => !x.ok);
      if (ok.length) toast(`${what}: ${ok.length}/${r.results.length} wallet${r.results.length > 1 ? "s" : ""}${bad.length ? ` · ${bad.map((b) => `${labelOf(b.wallet) ?? short(b.wallet)}: ${b.error}`).join(" · ")}` : ""}`, bad.length ? "err" : "ok");
      else toast(`${what} failed: ${bad.map((b) => `${labelOf(b.wallet) ?? short(b.wallet)}: ${b.error}`).join(" · ")}`, "err");
      view.refresh();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  const sellAll = () => {
    const list = held.map((h) => h.address);
    if (!list.length) return toast("None of your wallets holds this token.", "info");
    if (!confirm(`Sell 100 % from ${list.length} wallet${list.length > 1 ? "s" : ""}?`)) return;
    void trade("sellall", { side: "sell", wallets: list, percent: 100 }, "Sell All");
  };

  if (view.error && !v)
    return (
      <div className="p-6">
        <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-sm text-decrease">{failureMessage(view.error)}</p>
        <Link href="/rh/dashboard" className="mt-3 inline-block text-sm text-accent">
          ← Dashboard
        </Link>
      </div>
    );
  if (!v) return <div className="p-6 text-sm text-text-300">Reading the token on Robinhood Chain…</div>;

  const st = v.state;
  const tradesShown = (onlyMine ? v.trades.filter((t) => mine.has(t.wallet.toLowerCase())) : v.trades).slice(-200).reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:overflow-hidden">
      {/* ------------------------------------------------ header */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenAvatar src={v.image} symbol={v.symbol} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold text-text-100">{v.name}</span>
              <span className="text-sm text-text-300">${v.symbol}</span>
              {st.graduated ? <span className="rounded bg-increase/15 px-1.5 text-[10px] text-increase">graduated</span> : null}
              {v.ours ? <span className="rounded bg-[#ccff00]/15 px-1.5 text-[10px] text-[#ccff00]">your launch</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <Copyable text={v.token} label={short(v.token, 6, 4)} />
              <a href={PONS_PAGE(v.token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-text-300 hover:text-text-100">
                Pons <ExternalLink className="h-3 w-3" />
              </a>
              <a href={`${EXPLORER}/token/${v.token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-text-300 hover:text-text-100">
                Explorer <ExternalLink className="h-3 w-3" />
              </a>
              <Link href={`/rh/launch?vamp=${v.token}`} className="inline-flex items-center gap-0.5 text-[11px] text-text-300 hover:text-[#ccff00]" title="Launch a copy of this token">
                <Zap className="h-3 w-3" /> Vamp
              </Link>
            </div>
          </div>
        </div>
        <Stat k="Market cap" v={usdOf(st.mcapEth, usd)} sub={`${ethNum(st.mcapEth, 3)} ETH`} />
        <Stat k="Price" v={st.priceEth !== null ? `${st.priceEth.toExponential(3)} ETH` : "—"} />
        <div className="flex w-40 flex-col gap-1">
          <span className="text-[11px] text-text-300">Curve {st.progress !== null ? `${(st.progress * 100).toFixed(1)} %` : "—"}</span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-[#ccff00]" style={{ width: `${Math.round((st.progress ?? 0) * 100)}%` }} />
          </div>
          <span className="text-[10px] text-text-300">
            {eth(st.realQuote, 3)} / {eth(st.threshold, 2)} ETH
          </span>
        </div>
        <Stat k="Trades" v={String(v.tradeCount)} />
        <div className="ml-auto flex items-center gap-4">
          <Stat k="Invested" v={`${eth(v.pnl.spentWei, 5)} ETH`} />
          <Stat k="Holding" v={`${ethNum(v.pnl.heldValueEth, 5)} ETH`} sub={usdOf(v.pnl.heldValueEth, usd)} />
          <Stat k={`PnL${v.ours ? " (− Pons fee)" : ""}`} v={`${signed(v.pnl.netEth, 5)} ETH`} sub={usdOf(v.pnl.netEth, usd)} cls={tone(v.pnl.netEth)} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 max-xl:flex-col">
        {/* ------------------------------------------------ chart + trades */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <RhChart trades={v.trades} ethUsd={usd} mine={mine} className="h-[400px] shrink-0 border-b border-line-100 xl:h-[52%]" />
          <div className="flex min-h-[260px] flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-line-50 px-3 py-1.5 text-xs">
              <span className="font-medium text-text-100">Trades</span>
              <label className="flex items-center gap-1.5 text-text-300">
                <input type="checkbox" className="pi-checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only mine
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="sticky top-0 bg-bg-100 text-[11px] text-text-300">
                  <tr className="border-b border-line-50">
                    <th className="px-3 py-1.5 text-left font-normal">Age</th>
                    <th className="px-2 py-1.5 text-left font-normal">Type</th>
                    <th className="px-2 py-1.5 text-right font-normal">ETH</th>
                    <th className="px-2 py-1.5 text-right font-normal">Tokens</th>
                    <th className="px-2 py-1.5 text-right font-normal">MC</th>
                    <th className="px-2 py-1.5 text-left font-normal">Wallet</th>
                    <th className="px-3 py-1.5 text-right font-normal">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {tradesShown.map((t) => {
                    const own = labelOf(t.wallet);
                    const mc = Number(t.tokens) > 0 ? (Number(t.eth) / Number(t.tokens)) * 1e9 : null;
                    return (
                      <tr key={`${t.tx}-${t.li}`} className={cx("border-b border-line-50", own && "bg-[#ccff00]/[0.03]")}>
                        <td className="px-3 py-1 text-text-300">{age(t.ts)}</td>
                        <td className={cx("px-2 py-1 font-medium", t.side === "buy" ? "text-increase" : "text-decrease")}>{t.side === "buy" ? "Buy" : "Sell"}</td>
                        <td className="px-2 py-1 text-right font-mono text-text-100">{eth(t.eth, 5)}</td>
                        <td className="px-2 py-1 text-right font-mono text-text-200">{tokens(t.tokens)}</td>
                        <td className="px-2 py-1 text-right text-text-200">{usdOf(mc, usd)}</td>
                        <td className="px-2 py-1">{own ? <span className="text-[#ccff00]">{own}</span> : <span className="font-mono text-text-300">{short(t.wallet, 4, 4)}</span>}</td>
                        <td className="px-3 py-1 text-right">{t.li >= 0 ? <EvmTx hash={t.tx} /> : <span className="text-[10px] text-text-300">dev buy</span>}</td>
                      </tr>
                    );
                  })}
                  {!tradesShown.length ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-text-300">
                        No trade yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ wallets */}
        <aside className="flex min-h-0 shrink-0 flex-col border-line-100 max-xl:border-t xl:w-[520px] xl:border-l">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-50 px-3 py-2">
            <span className="text-sm font-medium text-text-100">Your wallets</span>
            <span className="text-xs text-text-300">{held.length} holding</span>
            <span className="flex-1" />
            <BxButton size="sm" variant="danger" disabled={!!busy || !held.length || st.graduated} onClick={sellAll}>
              {busy === "sellall" ? "Selling…" : "Sell All"}
            </BxButton>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-line-50 px-3 py-2 text-xs">
            <span className="text-text-300">{selList.length} selected</span>
            <BxInput className="h-7 w-20 text-xs" inputMode="decimal" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} />
            <BxButton size="sm" variant="primary" disabled={!!busy || !selList.length || !(Number(buyAmt.replace(",", ".")) > 0) || st.graduated} onClick={() => void trade("buysel", { side: "buy", wallets: selList, eth: buyAmt.replace(",", ".") }, "Buy")}>
              Buy each
            </BxButton>
            {[25, 50, 100].map((p) => (
              <BxButton key={p} size="sm" disabled={!!busy || !selList.length || st.graduated} onClick={() => void trade(`sellsel${p}`, { side: "sell", wallets: selList, percent: p }, `Sell ${p} %`)}>
                Sell {p}%
              </BxButton>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-100 text-[11px] text-text-300">
                <tr className="border-b border-line-50">
                  <th className="w-8 px-3 py-1.5 text-left font-normal">
                    <input type="checkbox" className="pi-checkbox" checked={rows.length > 0 && rows.every((h) => sel.has(h.address))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((h) => h.address)) : new Set())} aria-label="Select all" />
                  </th>
                  <th className="px-1 py-1.5 text-left font-normal">Wallet</th>
                  <th className="px-1 py-1.5 text-right font-normal">ETH</th>
                  <th className="px-1 py-1.5 text-right font-normal">Holding</th>
                  <th className="px-1 py-1.5 text-right font-normal">PnL</th>
                  <th className="px-2 py-1.5 text-right font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <HolderRow
                    key={h.address}
                    h={h}
                    usd={usd}
                    checked={sel.has(h.address)}
                    onCheck={(c) => setSel((s) => { const n = new Set(s); if (c) n.add(h.address); else n.delete(h.address); return n; })}
                    amount={rowAmt[h.address] ?? "0.005"}
                    onAmount={(a) => setRowAmt((m) => ({ ...m, [h.address]: a }))}
                    busy={!!busy}
                    disabled={st.graduated}
                    onBuy={(a) => void trade(`buy-${h.address}`, { side: "buy", wallets: [h.address], eth: a }, `Buy (${h.label})`)}
                    onSell={(p) => void trade(`sell-${h.address}-${p}`, { side: "sell", wallets: [h.address], percent: p }, `Sell ${p} % (${h.label})`)}
                  />
                ))}
              </tbody>
            </table>
            {others.length ? (
              <button type="button" onClick={() => setShowAll((x) => !x)} className="w-full px-3 py-2 text-left text-[11px] text-text-300 hover:text-text-100">
                {showAll ? "Hide wallets without this token" : `Show ${others.length} other wallet${others.length > 1 ? "s" : ""} (to buy from them)`}
              </button>
            ) : null}
            {v.launch?.bundle.length ? (
              <div className="border-t border-line-50 px-3 py-2">
                <p className="mb-1 text-[11px] font-medium text-text-200">Launch bundle</p>
                {v.launch.bundle.map((b) => (
                  <div key={b.address} className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                    <span className="text-text-200">{labelOf(b.address) ?? short(b.address)}</span>
                    <span className={cx(b.status === "landed" ? "text-increase" : b.status === "sent" ? "text-text-200" : "text-decrease")} title={b.error ?? undefined}>
                      {eth(b.ethWei, 4)} ETH · {b.status}
                      {b.sentMs !== null ? ` +${b.sentMs} ms` : ""}
                      {b.error ? ` — ${b.error}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {v.launch?.dev ? <DevFees dev={v.launch.dev} label={labelOf(v.launch.dev)} /> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ k, v, sub, cls }: { k: string; v: string; sub?: string; cls?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-text-300">{k}</span>
      <span className={cx("font-mono text-sm", cls ?? "text-text-100")}>{v}</span>
      {sub ? <span className="text-[10px] text-text-300">{sub}</span> : null}
    </div>
  );
}

function HolderRow({ h, usd, checked, onCheck, amount, onAmount, busy, disabled, onBuy, onSell }: { h: RhHolder; usd: number | null; checked: boolean; onCheck: (c: boolean) => void; amount: string; onAmount: (a: string) => void; busy: boolean; disabled: boolean; onBuy: (a: string) => void; onSell: (p: number) => void }) {
  const has = BigInt(h.tokensWei) > BigInt(0);
  return (
    <tr className={cx("border-b border-line-50 align-top", checked && "bg-accent-muted/40")}>
      <td className="px-3 py-1.5">
        <input type="checkbox" className="pi-checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${h.label}`} />
      </td>
      <td className="px-1 py-1.5">
        <div className="flex items-center gap-1">
          <span className="truncate text-text-100">{h.label}</span>
          {h.dev ? <span className="rounded bg-[#ccff00]/15 px-1 text-[9px] text-[#ccff00]">DEV</span> : null}
          {h.bundle ? <span className="rounded bg-accent/15 px-1 text-[9px] text-accent">BUNDLE</span> : null}
        </div>
        <span className="font-mono text-[10px] text-text-300">{short(h.address, 4, 4)}</span>
      </td>
      <td className="px-1 py-1.5 text-right font-mono text-text-200">{eth(h.ethWei, 4)}</td>
      <td className="px-1 py-1.5 text-right">
        <span className="block font-mono text-text-100">{tokens(h.tokensWei)}</span>
        <span className="text-[10px] text-text-300">{has ? usdOf(h.valueEth, usd) : "—"}</span>
      </td>
      <td className={cx("px-1 py-1.5 text-right font-mono", tone(h.pnlEth))}>
        {h.pnlEth !== null ? signed(h.pnlEth, 4) : "—"}
        {h.pnlEth !== null ? <span className="block text-[10px] text-text-300">{usdOf(h.pnlEth, usd)}</span> : null}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <input value={amount} onChange={(e) => onAmount(e.target.value)} inputMode="decimal" className="h-6 w-14 rounded border border-line-100 bg-input-100 px-1 text-right text-[11px] text-text-100 outline-none focus:border-accent" />
            <button type="button" disabled={busy || disabled || !(Number(amount.replace(",", ".")) > 0)} onClick={() => onBuy(amount.replace(",", "."))} className="h-6 rounded bg-increase/15 px-1.5 text-[11px] text-increase hover:bg-increase/25 disabled:opacity-40">
              Buy
            </button>
          </div>
          {has ? (
            <div className="flex items-center gap-1">
              {[25, 50, 100].map((p) => (
                <button key={p} type="button" disabled={busy || disabled} onClick={() => onSell(p)} className="h-6 rounded bg-decrease/15 px-1.5 text-[11px] text-decrease hover:bg-decrease/25 disabled:opacity-40">
                  {p}%
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DevFees({ dev, label }: { dev: string; label: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line-50 px-3 py-2 text-[11px] text-text-300">
      <span>Creator fees go to {label ?? short(dev)} (Pons escrow, all its tokens).</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await post<{ amountWei: string }>("/api/robinhood/claim", { wallet: dev });
            toast(`Claimed ${eth(r.amountWei, 6)} ETH`, "ok");
          } catch (e) {
            toast(failureMessage(e), "err");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-line-100 px-2 py-1 text-text-200 hover:text-text-100 disabled:opacity-40"
      >
        <Gift className="h-3 w-3" /> {busy ? "Claiming…" : "Claim"}
      </button>
    </div>
  );
}

