"use client";
/** Robinhood mode › Bridge: how ETH gets onto (and off) the Robinhood wallets — Relay, one way, direct. */
import { useEffect, useState } from "react";
import { failureMessage } from "@/lib/api";
import { BxSeg } from "@/components/bx/ui";
import { BridgeBackCard, BridgeCard, BridgeHistory } from "@/components/rh/Bridge";
import { useRhStatus } from "@/components/rh/common";

export default function RhBridgePage() {
  const status = useRhStatus(6000);
  const s = status.data;
  const refresh = status.refresh;
  const [dir, setDir] = useState<"sol2rh" | "rh2sol">("sol2rh");
  const inFlight = (s?.bridges ?? []).some((b) => b.status === "sending" || b.status === "deposited" || b.status === "pending");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => refresh(), 2000);
    return () => clearInterval(t);
  }, [inFlight, refresh]);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 xl:px-8">
        <div>
          <h1 className="text-xl font-semibold text-text-100">Bridge</h1>
          <p className="text-xs text-text-300">Fund your Robinhood wallets with SOL from the vault, or bring ETH back as SOL · via Relay</p>
        </div>
        {status.error && !s ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-sm text-decrease">{failureMessage(status.error)}</p> : null}
        {!s && !status.error ? <p className="py-4 text-sm text-text-300">Loading…</p> : null}
        {s ? (
          <div className="flex w-full max-w-[760px] flex-col gap-4">
            <BxSeg
              value={dir}
              onChange={setDir}
              options={[
                { value: "sol2rh", label: "Solana → Robinhood" },
                { value: "rh2sol", label: "Robinhood → Solana" },
              ]}
            />
            {dir === "sol2rh" ? <BridgeCard status={s} onDone={refresh} /> : <BridgeBackCard status={s} onDone={refresh} />}
            <BridgeHistory status={s} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
