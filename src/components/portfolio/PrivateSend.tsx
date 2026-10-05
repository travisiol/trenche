"use client";
/** Privacy funding › Private send: one vault wallet → a vault wallet or any address, amount or Max, relay hop ON,
 *  optional split into 2–5 random parts (Σ = amount exactly), each part after a random delay and through its own
 *  fresh relay wallet. POST /api/fund/transfer {from, to, partsSol | max, parts, delayMinSec, delayMaxSec, viaRelay}. */
import { useMemo, useState } from "react";
import { Shuffle } from "lucide-react";
import type { FundPrivateSendResponse, WalletInfo } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { refreshVaultDependents } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { MAX_PARTS, RELAY_FEE_LAM, RENT_MIN_LAM, TX_FEE_MARGIN_LAM, fmtDuration, lamToSol, seededRng, solToLam, splitLamports } from "@/lib/privacy";
import { toast } from "@/components/ui";
import { BxButton, BxInput, BxLabel, BxModal, BxSelect, cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";
import { DEFAULT_DELAY, DelayRangeField, PlanSummary, PlanTable, PrivacyRelaySwitch, delayText, readDelay, type DelayDraft } from "./PrivacyFields";

const ZERO = BigInt(0);
const RENT_MIN = BigInt(RENT_MIN_LAM);
const VARIATION = 40;
const solL = (l: bigint) => sol(Number(l) / 1e9, 6);
const lamOf = (v: string | number | null | undefined): bigint => (v === null || v === undefined ? ZERO : (solToLam(String(v)) ?? ZERO));

export function PrivateSendModal({ onClose, wallets, balances, selected, active }: { onClose: () => void; wallets: WalletInfo[]; balances: Record<string, string | null> | null; selected: string[]; active: string | null }) {
  const live = wallets.filter((w) => !w.archived);
  const balLam = (a: string) => lamOf(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol);
  const autoFrom = [...selected, ...(active ? [active] : []), ...live.map((w) => w.address)].find((a) => live.some((w) => w.address === a) && balLam(a) > ZERO) ?? live[0]?.address ?? "";
  const [fromPick, setFromPick] = useState<string | null>(null);
  const [toMode, setToMode] = useState<"wallet" | "address">("wallet");
  const [toWallet, setToWallet] = useState("");
  const [toAddr, setToAddr] = useState("");
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [parts, setParts] = useState(1);
  const [seed, setSeed] = useState(1);
  const [delay, setDelay] = useState<DelayDraft>(DEFAULT_DELAY);
  const [viaRelay, setViaRelay] = useState(true);
  const [result, setResult] = useState<FundPrivateSendResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const from = fromPick ?? autoFrom;
  const to = toMode === "wallet" ? toWallet : toAddr.trim();
  const toLabel = toMode === "wallet" ? live.find((w) => w.address === to)?.label || (to ? short(to) : "—") : to ? short(to) : "—";
  const bal = balLam(from);
  const d = readDelay(delay);
  const delayOn = parts > 1;
  const range = delayOn ? d : { ...d, minSec: 0, maxSec: 0, range: { minMs: 0, maxMs: 0 } };
  // Max: exact fees (no compute-unit price), the source ends at 0; otherwise the server reserves a fee margin per part
  const exactFees = BigInt(parts) * BigInt(5_000 + (viaRelay ? RELAY_FEE_LAM : 0));
  const marginFees = BigInt(parts) * BigInt(TX_FEE_MARGIN_LAM + (viaRelay ? RELAY_FEE_LAM : 0));
  const amountLam = max ? (bal > exactFees ? bal - exactFees : ZERO) : (solToLam(amount) ?? ZERO);
  const amounts = useMemo(() => splitLamports(amountLam, parts, parts > 1 ? VARIATION : 0, seededRng(seed)), [amountLam, parts, seed]);
  const needLam = max ? bal : amountLam + marginFees;
  const etaMs = ((range.range.minMs + range.range.maxMs) / 2) * (parts - 1) + parts * (viaRelay ? 4000 : 2000);
  const validTo = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to) && to !== from;
  const problem =
    (delayOn ? d.error : null) ??
    (amountLam > ZERO && viaRelay && amounts.some((a) => a < RENT_MIN) ? `Through a relay each part must be ≥ ${lamToSol(RENT_MIN)} SOL (rent minimum of a fresh account). Send more or use fewer parts.` : null) ??
    (!max && amountLam > ZERO && bal < needLam ? `Short by ${solL(needLam - bal)} SOL.` : null) ??
    (!max && amountLam > ZERO && bal - needLam < RENT_MIN ? `Would leave ~${solL(bal - needLam)} SOL on the source — under the ${lamToSol(RENT_MIN)} SOL rent minimum the network requires. Use Max to empty it, or send a little less.` : null);
  const canSend = !!from && validTo && amountLam > ZERO && !problem;
  const line = `Send ${max ? "≈" : ""}${amountLam > ZERO ? solL(amountLam) : "0"} SOL → ${toLabel}${parts > 1 ? ` · ${parts} parts · random ±${VARIATION} % · delays ${delayText(delay)}` : ""} · relay ${viaRelay ? "ON" : "OFF"} · fees ~${solL(max ? exactFees : marginFees)} SOL · ETA ~${fmtDuration(etaMs)}`;

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { from, to, viaRelay, parts, variationPct: parts > 1 ? VARIATION : 0, delayMinSec: range.minSec, delayMaxSec: range.maxSec, ...(max ? { max: true } : { partsSol: amounts.map(lamToSol) }) };
      const r = await post<FundPrivateSendResponse>("/api/fund/transfer", body);
      setResult(r);
      refreshVaultDependents();
      toast(`Private send started${parts > 1 ? ` · ${parts} parts` : ""}`, "info");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BxModal open onClose={onClose} title="Private send" width={500}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>From</BxLabel>
          <BxSelect value={from} onChange={(e) => setFromPick(e.target.value)} disabled={!!result}>
            {!live.length ? <option value="">No wallet</option> : null}
            {live.map((w) => (
              <option key={w.address} value={w.address}>
                {w.label || short(w.address)} — {sol(balances?.[w.address] ?? w.sol)} SOL
              </option>
            ))}
          </BxSelect>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <BxLabel className="mb-0">To</BxLabel>
            <div className="flex h-6 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
              {(["wallet", "address"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setToMode(m)} className={cx("h-full rounded px-2 text-[10px] font-medium transition-colors", toMode === m ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                  {m === "wallet" ? "Vault wallet" : "Any address"}
                </button>
              ))}
            </div>
          </div>
          {toMode === "wallet" ? (
            <BxSelect value={toWallet} onChange={(e) => setToWallet(e.target.value)}>
              <option value="">Destination wallet</option>
              {live
                .filter((w) => w.address !== from)
                .map((w) => (
                  <option key={w.address} value={w.address}>
                    {w.label || short(w.address)} — {sol(balances?.[w.address] ?? w.sol)} SOL
                  </option>
                ))}
            </BxSelect>
          ) : (
            <BxInput value={toAddr} onChange={(e) => setToAddr(e.target.value)} placeholder="Solana address" spellCheck={false} className="font-mono" />
          )}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <BxLabel>Amount (SOL)</BxLabel>
            <button type="button" className={cx("mb-1.5 text-[11px] hover:underline", max ? "font-medium text-accent" : "text-accent")} onClick={() => setMax((m) => !m)} title="Send the whole balance: exact fees, the source ends at 0">
              {max ? "Max ✓ (click to type an amount)" : `Max ${sol(Number(bal) / 1e9)}`}
            </button>
          </div>
          <BxInput inputMode="decimal" value={max ? `≈ ${lamToSol(amountLam)} (whole balance)` : amount} disabled={max} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" className="font-mono" />
        </div>
        <div>
          <BxLabel>Split into parts</BxLabel>
          <div className="flex gap-1">
            {Array.from({ length: MAX_PARTS }, (_, i) => i + 1).map((k) => (
              <button key={k} type="button" onClick={() => setParts(k)} className={cx("h-8 flex-1 rounded border text-xs font-medium transition-colors", parts === k ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200 hover:text-text-100")}>
                {k === 1 ? "No split" : `${k} parts`}
              </button>
            ))}
          </div>
          {parts > 1 ? <p className="mt-1 text-[11px] text-text-300">Random amounts (±{VARIATION}% around the equal share) that add up to the amount exactly; each part is its own relay payment.</p> : null}
        </div>
        {parts > 1 ? <DelayRangeField value={delay} onChange={setDelay} label="Random delay before each part" /> : null}
        <PrivacyRelaySwitch checked={viaRelay} onChange={setViaRelay} what="part" />
        {amountLam > ZERO && parts > 1 && !result ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-text-300">
              <span>{max ? "Parts (≈ — drawn again from the live balance at send time)" : "Parts preview"}</span>
              <button type="button" onClick={() => setSeed((s) => s + 1)} className="inline-flex items-center gap-1 text-accent hover:underline">
                <Shuffle className="h-3 w-3" /> Re-roll
              </button>
            </div>
            <PlanTable rows={amounts.map((a, i) => ({ label: `Part ${i + 1}/${parts} → ${toLabel}`, sol: lamToSol(a) }))} />
          </div>
        ) : null}
        <PlanSummary line={line} available={lamToSol(bal)} needed={max ? lamToSol(bal) : lamToSol(needLam)} problem={amountLam > ZERO || (delayOn && d.error) ? problem : null} />
        {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
        {result ? (
          <div className="flex flex-col gap-2">
            {result.plan ? <PlanTable title={`Drawn parts — Σ ${result.totalSol} SOL · ETA ~${fmtDuration(result.etaMs)}`} rows={result.plan.map((p) => ({ label: p.label, sol: p.sol, delayMs: p.delayMs }))} /> : null}
            <div className="rounded-md border border-line-100 bg-bg-50 p-3">
              <BxJob jobId={result.jobId} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line-50 px-4 py-3">
        <BxButton onClick={onClose}>{result ? "Close" : "Cancel"}</BxButton>
        {result ? (
          <BxButton onClick={() => setResult(null)}>New send</BxButton>
        ) : (
          <BxButton variant="primary" disabled={!canSend || busy} onClick={send}>
            {busy ? "Starting…" : `Send privately${parts > 1 ? ` in ${parts} parts` : ""}`}
          </BxButton>
        )}
      </div>
    </BxModal>
  );
}
