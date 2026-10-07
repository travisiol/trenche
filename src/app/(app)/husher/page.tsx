"use client";
/** Husher: every mixer order made from DONCHAIN (both modes), newest first — who sent → who received, amounts, route,
 *  status and the on-chain transactions. Orders still moving are re-read from Husher while the page is open. */
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Shuffle } from "lucide-react";
import { HusherMixer } from "@/components/portfolio/HusherMixer";
import { useGet } from "@/lib/api";
import { useBalances, useWallets } from "@/lib/store";
import { dateTime, short } from "@/lib/format";
import { BxButton, cx } from "@/components/bx/ui";
import { TxLink } from "@/components/bx/Job";
import { formatHusherSol, parseHusherSol, providerLabel, type HusherOrder, type HusherState } from "@/lib/husher";

type Kind = "done" | "progress" | "failed" | "review";
function kindOf(o: HusherOrder): Kind {
  if (/complete/i.test(o.status)) return "done";
  if (/fail|refund|reject/i.test(o.status)) return "failed";
  if (o.status === "Creation needs review" || !o.remoteId) return "review";
  return "progress";
}
const KIND_STYLE: Record<Kind, string> = {
  done: "border-green-100/30 bg-green-100/10 text-green-100",
  progress: "border-accent/30 bg-accent/10 text-accent",
  failed: "border-decrease/30 bg-decrease/10 text-decrease",
  review: "border-yellow-100/30 bg-yellow-100/10 text-yellow-100",
};
const lam = (v: string | null | undefined) => { try { return parseHusherSol(String(v ?? "")); } catch { return BigInt(0); } };
const fmt = (l: bigint) => (l > BigInt(0) ? formatHusherSol(l) : "0");
/** what reached the wallets: Husher's per-wallet amounts once delivered, the quote's estimate before */
function receivedOf(o: HusherOrder): { sol: string; estimate: boolean } {
  if (kindOf(o) === "done" && o.recipients.length) return { sol: fmt(o.recipients.reduce((a, r) => a + lam(r.receiveSol), BigInt(0))), estimate: false };
  return { sol: o.quote?.receiveSol ?? "0", estimate: true };
}

/** One order row; re-reads the order from Husher every 15 s while it is still moving. */
function OrderRow({ order, nameOf, open, onToggle }: { order: HusherOrder; nameOf: (a: string) => string; open: boolean; onToggle: () => void }) {
  const moving = kindOf(order) === "progress";
  const live = useGet<HusherOrder>(moving ? `/api/husher/orders/${encodeURIComponent(order.id)}` : null, 15000);
  const o = live.data?.id === order.id ? live.data : order;
  const kind = kindOf(o);
  const from = o.sources?.length ? o.sources.map((s) => s.address) : o.payment ? [o.payment.from] : [];
  const to = o.plan.recipients.map((r) => r.address);
  const rec = receivedOf(o);
  const picks = o.picks ?? [];
  const route = picks.length ? Array.from(new Set(picks.map((p) => providerLabel(p.provider)))).join(", ") : "Husher";
  const delayed = picks.some((p) => p.delayMin > 0);
  const names = (list: string[]) => (list.length > 2 ? `${nameOf(list[0])}, ${nameOf(list[1])} +${list.length - 2}` : list.map(nameOf).join(", "));
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-b border-line-50 text-[13px] hover:bg-white/[0.02]">
        <td className="py-3 pl-4 pr-2 text-text-300">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className="whitespace-nowrap px-2 py-3 text-text-200">{dateTime(o.at)}</td>
        <td className="whitespace-nowrap px-2 py-3 font-mono text-xs text-text-100">#{o.orderId || o.id.slice(0, 8)}</td>
        <td className="px-2 py-3">
          <span className="text-text-100">{from.length ? names(from) : <span className="text-text-300">Manual deposit</span>}</span>
          <span className="mx-1.5 text-text-300">→</span>
          <span className="text-text-100">{names(to)}</span>
        </td>
        <td className="whitespace-nowrap px-2 py-3 text-right font-mono text-text-100">{o.depositSol ?? o.plan.totalSol} SOL</td>
        <td className={cx("whitespace-nowrap px-2 py-3 text-right font-mono", rec.estimate ? "text-text-300" : "text-green-100")}>{rec.estimate ? "~" : ""}{rec.sol} SOL</td>
        <td className="whitespace-nowrap px-2 py-3 text-text-200">{route}{delayed ? <span className="text-text-300"> · delayed</span> : null}</td>
        <td className="px-2 py-3"><span className={cx("inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-medium", KIND_STYLE[kind])}>{o.status}</span></td>
        <td className="whitespace-nowrap py-3 pl-2 pr-4 text-right">{o.hashIn ? <TxLink sig={o.hashIn} /> : <span className="text-text-300">—</span>}</td>
      </tr>
      {open ? (
        <tr className="border-b border-line-50 bg-bg-50/60">
          <td />
          <td colSpan={8} className="px-2 pb-4 pt-2">
            <div className="grid gap-4 text-xs sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="font-medium text-text-100">Sent from</p>
                {o.sources?.length ? o.sources.map((s) => <p key={s.address} className="flex justify-between gap-3 text-text-300"><span>{nameOf(s.address)} · {short(s.address)}</span><span className="font-mono text-text-100">{s.sol} SOL</span></p>)
                  : o.payment ? <p className="text-text-300">{nameOf(o.payment.from)} · {short(o.payment.from)}</p> : <p className="text-text-300">Deposited by hand to {o.depositAddress ? short(o.depositAddress) : "—"}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-text-300">
                  <span>Deposit {o.hashIn ? <TxLink sig={o.hashIn} /> : "—"}</span>
                  {o.feeSol ? <span>Fee {o.feeSol} SOL</span> : null}
                  {o.trackingUrl ? <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline" onClick={(e) => e.stopPropagation()}>Husher tracking <ExternalLink className="h-3 w-3" /></a> : null}
                </div>
                {o.error ? <p className="pt-1 leading-relaxed text-decrease">{o.error}</p> : null}
              </div>
              <div className="space-y-1.5">
                <p className="font-medium text-text-100">Received by</p>
                {(o.recipients.length ? o.recipients : o.plan.recipients.map((r) => ({ address: r.address, status: "—", receiveSol: "", hashOut: null }))).map((r) => {
                  const p = picks.find((x) => x.address === r.address);
                  return (
                    <div key={r.address} className="flex items-center justify-between gap-3 text-text-300">
                      <span>{nameOf(r.address)} · {p ? `${providerLabel(p.provider)}${p.delayMin ? ` · ${p.delayMin} min` : ""}` : short(r.address)}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-text-200">{r.status}</span>
                        {r.receiveSol ? <span className="font-mono text-text-100">{r.receiveSol} SOL</span> : null}
                        {r.hashOut ? <TxLink sig={r.hashOut} /> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function HusherPage() {
  const wallets = useWallets();
  const balances = useBalances();
  const state = useGet<HusherState>("/api/husher", 15000);
  const [mixer, setMixer] = useState(false);
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = wallets.data?.wallets ?? [];
  const nameOf = (a: string) => { const w = list.find((x) => x.address === a); return w ? w.label || short(a) : short(a); };
  const orders = state.data?.orders ?? [];
  const shown = filter === "all" ? orders : orders.filter((o) => kindOf(o) === filter);
  const done = orders.filter((o) => kindOf(o) === "done");
  const sentLam = orders.filter((o) => !!o.hashIn || kindOf(o) === "done").reduce((a, o) => a + lam(o.depositSol ?? o.plan.totalSol), BigInt(0));
  const recvLam = done.reduce((a, o) => a + lam(receivedOf(o).sol), BigInt(0));
  const feeLam = orders.reduce((a, o) => a + lam(o.feeSol), BigInt(0));
  const counts: Record<"all" | Kind, number> = { all: orders.length, done: done.length, progress: orders.filter((o) => kindOf(o) === "progress").length, failed: orders.filter((o) => kindOf(o) === "failed").length, review: orders.filter((o) => kindOf(o) === "review").length };
  const FILTERS: { v: "all" | Kind; label: string }[] = [{ v: "all", label: "All" }, { v: "progress", label: "In progress" }, { v: "done", label: "Completed" }, { v: "failed", label: "Failed" }, { v: "review", label: "Needs review" }];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-text-100">Husher</h1>
            <p className="mt-0.5 text-xs text-text-300">Every mixer order sent through Husher from DONCHAIN.</p>
          </div>
          <BxButton variant="primary" onClick={() => setMixer(true)} disabled={!wallets.data}><Shuffle className="h-4 w-4" /> Open Mixer</BxButton>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { k: "Orders", v: String(orders.length), sub: `${counts.done} completed · ${counts.progress} in progress` },
            { k: "SOL sent", v: `${fmt(sentLam)} SOL`, sub: "deposits made to Husher" },
            { k: "SOL received", v: `${fmt(recvLam)} SOL`, sub: "delivered to your wallets" },
            { k: "Exchange fees", v: `${fmt(feeLam)} SOL`, sub: "as reported by Husher" },
          ].map((c) => (
            <div key={c.k} className="rounded-[10px] border border-line-100 bg-bg-50 px-4 py-3">
              <p className="text-xs text-text-300">{c.k}</p>
              <p className="mt-1 font-mono text-lg font-semibold text-text-100">{c.v}</p>
              <p className="mt-0.5 text-[11px] text-text-300">{c.sub}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button key={f.v} type="button" onClick={() => setFilter(f.v)} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors", filter === f.v ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200 hover:text-text-100")}>
              {f.label}<span className="text-text-300">{counts[f.v]}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-[10px] border border-line-100">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b border-line-100 text-left text-[11px] font-medium uppercase tracking-wide text-text-300">
                <th className="w-8 py-2.5 pl-4" />
                <th className="px-2 py-2.5 font-medium">Date</th>
                <th className="px-2 py-2.5 font-medium">Order</th>
                <th className="px-2 py-2.5 font-medium">From → To</th>
                <th className="px-2 py-2.5 text-right font-medium">Sent</th>
                <th className="px-2 py-2.5 text-right font-medium">Received</th>
                <th className="px-2 py-2.5 font-medium">Route</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="py-2.5 pl-2 pr-4 text-right font-medium">Deposit tx</th>
              </tr>
            </thead>
            <tbody>
              {state.loading && !state.data ? <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-text-300">Loading…</td></tr>
                : shown.length ? shown.map((o) => <OrderRow key={o.id} order={o} nameOf={nameOf} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} />)
                : <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-text-300">{orders.length ? "No orders in this filter." : "No Husher orders yet. Open the Mixer to make one."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {mixer ? <HusherMixer wallets={list} balances={balances.data ?? null} onClose={() => { setMixer(false); state.refresh(); }} /> : null}
    </div>
  );
}
