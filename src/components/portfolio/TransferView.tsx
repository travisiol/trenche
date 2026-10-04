"use client";
/** Block X "transfer view": the summary panel turns into two drop zones — Source Wallet / Target Wallet — fed by dragging
 *  wallet rows from the list (BEHAVIOUR.md §5.3, shot portfolio-consolidate-view.jpg). Reset · Switch · ✕ · Start.
 *  Consolidate = many → one (POST /api/fund/consolidate), Distribute = one → many (POST /api/fund/distribute),
 *  Transfer = sources[i] → targets[i % n] (POST /api/fund/transfer). */
import { useState } from "react";
import { ArrowDownToLine, RotateCcw, ArrowLeftRight, X } from "lucide-react";
import type { JobCreated, WalletInfo } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxSwitch, cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";

export type TransferKind = "consolidate" | "distribute" | "transfer";
export const DRAG_MIME = "application/x-donchain-wallet";
const LABEL: Record<TransferKind, string> = { consolidate: "Consolidate", distribute: "Distribute", transfer: "Transfer" };

export function TransferView({ kind, wallets, balances, onClose, onDone }: { kind: TransferKind; wallets: WalletInfo[]; balances: Record<string, string | null> | null; onClose: () => void; onDone?: () => void }) {
  const [sources, setSources] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [over, setOver] = useState<"source" | "target" | null>(null);
  const [amount, setAmount] = useState("");
  const [delay, setDelay] = useState("0");
  const [viaRelay, setViaRelay] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const balOf = (a: string) => Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0;
  const singleSource = kind === "distribute";
  const singleTarget = kind === "consolidate";
  const ready = sources.length > 0 && targets.length > 0 && !sources.some((s) => targets.includes(s));
  const totalSrc = sources.reduce((n, a) => n + balOf(a), 0);

  const addresses = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((a) => wallets.some((w) => w.address === a));
  };
  const drop = (zone: "source" | "target", e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const list = addresses(e);
    if (!list.length) return;
    if (zone === "source") {
      setTargets((t) => t.filter((a) => !list.includes(a)));
      setSources((s) => (singleSource ? [list[0]] : Array.from(new Set([...s, ...list]))));
    } else {
      setSources((s) => s.filter((a) => !list.includes(a)));
      setTargets((t) => (singleTarget ? [list[0]] : Array.from(new Set([...t, ...list]))));
    }
  };
  const start = async () => {
    setBusy(true);
    try {
      const delayMinutes = Number(delay) || 0;
      let r: JobCreated;
      if (kind === "consolidate") r = await post<JobCreated>("/api/fund/consolidate", { sources, to: targets[0], viaRelay: viaRelay || undefined, delayMinutes });
      else if (kind === "distribute") r = await post<JobCreated>("/api/fund/distribute", { sources, targets, totalSol: amount || undefined, viaRelay: viaRelay || undefined, delayMinutes });
      else r = await post<JobCreated>("/api/fund/transfer", { sources, targets, sol: amount || undefined, viaRelay: viaRelay || undefined, delayMinutes });
      setJobId(r.jobId);
      toast(`${LABEL[kind]} started`, "info");
      onDone?.();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const renderZone = ({ zone, title, list, setList, single }: { zone: "source" | "target"; title: string; list: string[]; setList: (v: string[]) => void; single: boolean }) => (
    <div className={cx("flex min-h-0 flex-1 flex-col", zone === "target" ? "border-t border-line-50" : "")}>
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <h3 className="text-sm font-medium text-text-100">{title}</h3>
        {zone === "source" ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { setSources([]); setTargets([]); setJobId(null); }} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-text-300 hover:bg-white/[0.04] hover:text-text-100">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
            <button type="button" onClick={() => { setSources(targets.slice(0, singleSource ? 1 : undefined)); setTargets(sources.slice(0, singleTarget ? 1 : undefined)); }} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-text-300 hover:bg-white/[0.04] hover:text-text-100" title="Swap source and target">
              <ArrowLeftRight className="h-3 w-3" /> Switch
            </button>
            <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-text-300 hover:bg-white/[0.04] hover:text-text-100" aria-label="Close transfer view" title="Close transfer view">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button type="button" disabled={!ready || busy} onClick={start} className="h-7 rounded bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "Starting…" : `Start ${LABEL[kind]}`}
          </button>
        )}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (over !== zone) setOver(zone);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => drop(zone, e)}
        className={cx("mx-4 mb-3 flex min-h-[120px] flex-1 flex-col rounded-md border border-dashed transition-colors", over === zone ? "border-accent bg-accent/5" : "border-line-100")}
      >
        {!list.length ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-300">
            <ArrowDownToLine className="h-5 w-5" />
            <span className="text-xs">Drag wallets here to {LABEL[kind]}</span>
            {single ? <span className="text-[10px]">one wallet</span> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {list.map((a) => {
              const w = wallets.find((x) => x.address === a);
              return (
                <div key={a} className="flex items-center gap-2 rounded border border-line-100 bg-bg-50 px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate text-text-100">{w?.label || short(a)}</span>
                  <span className="font-mono text-[11px] text-text-300">{short(a, 4, 4)}</span>
                  <span className="font-mono text-text-200">{sol(balOf(a))} SOL</span>
                  <button type="button" onClick={() => setList(list.filter((x) => x !== a))} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-decrease" aria-label="Remove">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderZone({ zone: "source", title: "Source Wallet", list: sources, setList: setSources, single: singleSource })}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-50 px-4 py-2 text-[11px] text-text-300">
        {kind !== "consolidate" ? (
          <label className="flex items-center gap-1.5">
            {kind === "distribute" ? "Total (SOL, blank = whole balance)" : "SOL per transfer (blank = whole balance)"}
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={sol(totalSrc)} className="h-7 w-24 rounded-md border border-line-100 bg-input-100 px-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent" />
          </label>
        ) : (
          <span>
            {sources.length} wallet{sources.length !== 1 ? "s" : ""} · {sol(totalSrc)} SOL sweep to the target
          </span>
        )}
        <label className="flex items-center gap-1.5">
          Delay (min)
          <input inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value.replace(/[^0-9]/g, ""))} className="h-7 w-14 rounded-md border border-line-100 bg-input-100 px-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent" />
        </label>
        <label className="ml-auto flex items-center gap-1.5" title="Funds go through a fresh relay wallet, keys never stored, two signatures">
          Relay hop <BxSwitch checked={viaRelay} onChange={setViaRelay} />
        </label>
      </div>
      {renderZone({ zone: "target", title: "Target Wallet", list: targets, setList: setTargets, single: singleTarget })}
      {jobId ? (
        <div className="border-t border-line-50 px-4 py-3">
          <BxJob jobId={jobId} compact />
        </div>
      ) : null}
    </div>
  );
}
