"use client";
/** Order line of the trade rails: shown the instant the button is clicked (optimistic, before the POST answers),
 *  then live from the job stream — Sent n/N → Landed n/N (processed) → Done / Failed — with the last signature. */
import { useState } from "react";
import { useJobStream } from "@/lib/jobstream";
import { failureMessage, post } from "@/lib/api";
import { trackTradeJob } from "@/lib/pendingTrades";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { TxLink } from "@/components/bx/Job";

export type OrderLine = { key: string; label: string; jobId: string | null; error: string | null; at: number };

export function TradeJobLine({ line }: { line: OrderLine }) {
  const { job } = useJobStream(line.jobId);
  const steps = job?.steps ?? [];
  const sent = steps.filter((s) => s.phase === "sent").length;
  const landed = steps.filter((s) => s.phase === "landed" && s.ok).length;
  const settled = steps.filter((s) => s.phase === "send" || s.phase === "bundle");
  const ok = settled.filter((s) => s.ok).length;
  const total = job?.total || sent || 0;
  const lastSig = [...steps].reverse().find((s) => s.signature)?.signature ?? null;
  let word: string;
  let tone: "run" | "ok" | "err" = "run";
  if (line.error) {
    word = line.error;
    tone = "err";
  } else if (!job) word = "sending…";
  else if (job.status === "error") {
    word = job.error ?? "failed";
    tone = "err";
  } else if (job.done) {
    word = `done ${ok}/${total || settled.length}`;
    tone = ok > 0 ? "ok" : "err";
  } else if (landed) word = `landed ${landed}/${total}`;
  else if (sent) word = `sent ${sent}/${total}`;
  else word = "signing…";
  return (
    <div className="flex h-6 min-w-0 items-center gap-2 text-[11px]">
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", tone === "err" ? "bg-decrease" : tone === "ok" ? "bg-green-100" : landed ? "bg-green-100 animate-pulse" : "bg-accent animate-pulse")} />
      <span className="min-w-0 flex-1 truncate text-text-200">{line.label}</span>
      <span className={cx("max-w-[45%] shrink-0 truncate font-mono", tone === "err" ? "text-decrease" : "text-text-300")} title={word}>
        {word}
      </span>
      {lastSig ? <TxLink sig={lastSig} /> : null}
    </div>
  );
}

/** order lines + a submit that shows the line before the POST answers and tracks the job's trades */
export function useOrderLines(max = 3) {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const submit = async (path: "/api/trade/buy" | "/api/trade/sell" | "/api/dev/dump", body: Record<string, unknown>, meta: { mint: string; side: "buy" | "sell"; label: string }) => {
    const key = `${Date.now()}${Math.random()}`;
    setLines((l) => [{ key, label: meta.label, jobId: null, error: null, at: Date.now() }, ...l].slice(0, max));
    try {
      const r = await post<{ jobId: string }>(path, body);
      setLines((l) => l.map((x) => (x.key === key ? { ...x, jobId: r.jobId } : x)));
      trackTradeJob(r.jobId, meta);
      return r;
    } catch (e) {
      const msg = failureMessage(e);
      setLines((l) => l.map((x) => (x.key === key ? { ...x, error: msg } : x)));
      toast(msg, "err");
      return null;
    }
  };
  return { lines, submit };
}
