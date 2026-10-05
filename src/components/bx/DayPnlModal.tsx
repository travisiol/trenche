"use client";
/** One day of the PnL calendar, coin by coin (GET /api/pnl/day): trades, launch costs, creator fees earned that day,
 *  net — the rows add up to the calendar's figure (+ the costs that belong to no coin). "Share this day" opens the
 *  Share PnL card for that day (own photo / video background). */
import Link from "next/link";
import { useState } from "react";
import { Share2 } from "lucide-react";
import type { DayBreakdown } from "@/lib/types";
import { failureMessage, useGet } from "@/lib/api";
import { BxButton, BxModal, cx } from "./ui";
import { SharePnlModal } from "./SharePnl";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DayPnlModal({ date, onClose, solUsd, unit }: { date: string; onClose: () => void; solUsd: number | null; unit: "USD" | "SOL" }) {
  const res = useGet<DayBreakdown>(`/api/pnl/day?date=${date}`, 15000);
  const [share, setShare] = useState(false);
  const d = res.data;
  const [y, m, dd] = date.split("-").map(Number);
  const money = (sol: number, signed = true) => {
    const sign = signed ? (sol > 0.0000005 ? "+" : sol < -0.0000005 ? "−" : "") : "";
    if (unit === "USD" && solUsd) return `${sign}$${Math.abs(sol * solUsd).toFixed(2)}`;
    return `${sign}${Math.abs(sol).toFixed(4)} SOL`;
  };
  const tone = (n: number) => (n > 0.0000005 ? "text-increase" : n < -0.0000005 ? "text-decrease" : "text-text-200");
  const total = d ? Number(d.totalSol) : 0;
  return (
    <>
      <BxModal
        open
        onClose={onClose}
        title={`PnL · ${MONTHS[m - 1]} ${dd}, ${y} (UTC)`}
        width={720}
        headerRight={
          <BxButton onClick={() => setShare(true)} disabled={!d} title="Share card of this day — your own photo or video as background">
            <Share2 className="h-4 w-4" /> Share this day
          </BxButton>
        }
      >
        <div className="flex flex-col gap-3 p-4">
          {!d ? (
            <p className="py-6 text-center text-[13px] text-text-300">{res.error ? failureMessage(res.error) : "Reading the day…"}</p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] text-text-300">Net of the day</p>
                  <p className={cx("text-2xl font-semibold tabular-nums", tone(total))}>{money(total)}</p>
                </div>
                <p className="text-right text-[12px] text-text-300">
                  {d.coins.length} coin{d.coins.length !== 1 ? "s" : ""} · {d.coins.filter((c) => Number(c.netSol) > 0).length} up · {d.coins.filter((c) => Number(c.netSol) < 0).length} down
                </p>
              </div>
              <div className="overflow-x-auto rounded-md border border-line-100">
                <table className="w-full min-w-[560px] text-[13px] tabular-nums">
                  <thead className="bg-surface-muted text-[11px] uppercase text-text-300">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Coin</th>
                      <th className="px-3 py-2 text-right font-medium" title="Sold − bought that day, pump.fun trade fees inside">Trades</th>
                      <th className="px-3 py-2 text-right font-medium" title="Creation rent, priority fees, tips, token accounts">Costs</th>
                      <th className="px-3 py-2 text-right font-medium" title="Creator fees this coin produced that day (claimed or not)">Creator fees</th>
                      <th className="px-3 py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.coins.map((c) => (
                      <tr key={c.mint} className="border-t border-line-50 hover:bg-white/[0.03]">
                        <td className="px-3 py-2">
                          <Link href={`/launch?open=${c.mint}`} className="font-medium text-text-100 hover:text-accent" title={c.mint} onClick={onClose}>
                            {c.symbol ? `$${c.symbol}` : `${c.mint.slice(0, 4)}…${c.mint.slice(-4)}`}
                          </Link>
                          <span className="ml-2 font-mono text-[11px] text-text-300">{c.mint.slice(0, 4)}…{c.mint.slice(-4)}</span>
                          {c.trades ? <span className="ml-2 text-[11px] text-text-300">{c.trades} trade{c.trades !== 1 ? "s" : ""}</span> : null}
                        </td>
                        <td className={cx("px-3 py-2 text-right", tone(Number(c.tradingSol)))}>{money(Number(c.tradingSol))}</td>
                        <td className="px-3 py-2 text-right text-decrease">{Number(c.costsSol) ? money(-Number(c.costsSol)) : "—"}</td>
                        <td className="px-3 py-2 text-right text-increase">{Number(c.creatorFeesSol) ? money(Number(c.creatorFeesSol)) : "—"}</td>
                        <td className={cx("px-3 py-2 text-right font-semibold", tone(Number(c.netSol)))}>{money(Number(c.netSol))}</td>
                      </tr>
                    ))}
                    {!d.coins.length ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-text-300">
                          No coin traded or launched this day.
                        </td>
                      </tr>
                    ) : null}
                    {Number(d.otherSol) ? (
                      <tr className="border-t border-line-50 text-text-300">
                        <td className="px-3 py-2" colSpan={4} title="Transfers between your wallets, claim transaction fees">
                          Other costs (transfers, claim fees)
                        </td>
                        <td className={cx("px-3 py-2 text-right", tone(Number(d.otherSol)))}>{money(Number(d.otherSol))}</td>
                      </tr>
                    ) : null}
                    <tr className="border-t border-line-100 bg-surface-muted">
                      <td className="px-3 py-2 font-medium text-text-100" colSpan={4}>
                        Total — the calendar&apos;s figure
                      </td>
                      <td className={cx("px-3 py-2 text-right font-semibold", tone(total))}>{money(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] leading-relaxed text-text-300">
                Read from the chain. Creator fees count on the day each trade paid them, whether you claimed them yet or not.{unit === "USD" ? " USD at the current SOL price." : ""}
                {d.complete ? "" : " Still reading transactions — figures can still move."}
              </p>
            </>
          )}
        </div>
      </BxModal>
      {share ? <SharePnlModal open onClose={() => setShare(false)} day={date} /> : null}
    </>
  );
}
