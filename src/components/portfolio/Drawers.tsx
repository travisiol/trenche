"use client";
/** Block X right-side drawers of the Portfolio summary panel (BEHAVIOUR.md §5.3): Deposit (portfolio-deposit.html),
 *  Disperse = Privacy funding (preset bar, From = any vault wallet or a new deposit wallet with QR, total + Variation
 *  (Σ = total exactly, plan preview + re-roll), random delay range s/min, random order, destinations by group or tick,
 *  relay hop ON), Reverse Disperse (recipient Address / Select wallet, wallets by group, random delay range, random
 *  order, relay ON). Mixer / bridge: omitted on purpose (the relay hop only breaks the direct link). */
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Save, Shuffle, Trash2, X } from "lucide-react";
import { RELAY_FEE_LAM, RENT_MIN_LAM, TX_FEE_MARGIN_LAM, fmtDuration, lamToSol, seededRng, solToLam, splitLamports } from "@/lib/privacy";
import { WalletPicker } from "@/components/bx/WalletPicker";
import { DEFAULT_DELAY, DelayRangeField, PlanSummary, PlanTable, PrivacyRelaySwitch, delayText, draftFromSec, readDelay, type DelayDraft } from "./PrivacyFields";
import type { DispersePreset, DispersePresetsResponse, FundDisperseRequest, FundDisperseResponse, JobCreated, WalletGroup, WalletInfo } from "@/lib/types";
import { failureMessage, isApiFailure, post, useGet } from "@/lib/api";
import { refreshVaultDependents } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";

export type DrawerKind = "deposit" | "withdraw" | "disperse" | "reverse" | null;

const field = "w-full border border-line-100 bg-bg-50 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent";

export function Drawer({ title, width = 460, onClose, right, children }: { title: string; width?: number; onClose: () => void; right?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-[180]" style={{ background: "var(--modal-overlay)" }} onMouseDown={onClose} />
      <div role="dialog" aria-modal="true" className="fixed right-0 top-0 z-[181] flex h-[100dvh] w-full flex-col border-l border-line-100 bg-bg-100 shadow-[0_0_48px_rgba(0,0,0,0.35)]" style={{ maxWidth: width }}>
        <div className="flex shrink-0 items-center justify-between border-b border-line-50 px-4 py-3">
          <div className="min-w-0 text-sm font-medium text-text-100">{title}</div>
          <div className="flex items-center gap-2">
            {right}
            <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center text-text-300 hover:text-text-100" aria-label="Close drawer">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </>
  );
}

function useQr(text: string | null) {
  const [qr, setQr] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: 180, color: { dark: "#f0f5f5", light: "#0a0a0a" } }).then((url) => alive && setQr({ text, url }));
    return () => {
      alive = false;
    };
  }, [text]);
  return qr && qr.text === text ? qr.url : null;
}

function AddressBox({ address, label }: { address: string; label?: string }) {
  const qr = useQr(address);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 rounded-[10px] border border-line-100 p-4">
      {label ? <span className="self-start text-xs text-text-300">{label}</span> : null}
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side
        <img src={qr} alt="Deposit address QR" width={180} height={180} className="rounded-md border border-line-100" />
      ) : null}
      <button type="button" onClick={() => navigator.clipboard?.writeText(address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1000)))} className="inline-flex max-w-full items-center gap-1.5 break-all rounded-lg border border-line-100 bg-input-200 px-3 py-2 text-left font-mono text-[11px] text-text-200 hover:text-text-100">
        {address} {copied ? <Check className="h-3 w-3 shrink-0 text-green-100" /> : <Copy className="h-3 w-3 shrink-0" />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ Deposit */
export function DepositDrawer({ onClose, wallets, selected, active, balances }: { onClose: () => void; wallets: WalletInfo[]; selected: string[]; active: string | null; balances: Record<string, string | null> | null }) {
  const [addr, setAddr] = useState(selected[0] ?? active ?? wallets[0]?.address ?? "");
  const target = wallets.some((w) => w.address === addr) ? addr : (wallets[0]?.address ?? "");
  return (
    <Drawer title="Deposit" width={420} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-[10px] border border-line-100 p-4">
          {!wallets.length ? (
            <div className="rounded-lg border border-line-100 bg-input-200 px-3 py-2 text-sm text-text-300">No wallets available</div>
          ) : (
            <select value={target} onChange={(e) => setAddr(e.target.value)} className="h-9 w-full rounded-lg border border-line-100 bg-input-200 px-3 text-sm text-text-100 outline-none focus:border-accent" aria-label="Wallet to deposit to">
              {wallets.map((w) => (
                <option key={w.address} value={w.address}>
                  {w.label || short(w.address)} — {sol(balances?.[w.address] ?? w.sol)} SOL
                </option>
              ))}
            </select>
          )}
        </div>
        {!wallets.length ? <div className="rounded-[10px] border border-line-100 p-4 text-sm text-text-300">Create or import a wallet to receive deposits.</div> : target ? <AddressBox address={target} /> : null}
        {target ? <p className="text-[11px] text-text-300">Send SOL to this address. The balance refreshes every 5 seconds.</p> : null}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------ Disperse */
const DEPOSIT = "__deposit__";
const ZERO = BigInt(0);
const RENT_MIN = BigInt(RENT_MIN_LAM);
const solL = (l: bigint) => sol(Number(l) / 1e9, 6);
const lamOfBalance = (v: string | number | null | undefined): bigint => (v === null || v === undefined ? ZERO : (solToLam(String(v)) ?? ZERO));

export function DisperseDrawer({ onClose, wallets, groups, balances, selected, active, scopeLabel, scopeGroup, onHistory }: { onClose: () => void; wallets: WalletInfo[]; groups: WalletGroup[]; balances: Record<string, string | null> | null; selected: string[]; active: string | null; scopeLabel: string; scopeGroup: string | null; onHistory: () => void }) {
  const presetsQ = useGet<DispersePresetsResponse>("/api/fund/disperse/presets", 0);
  const presetsMissing = isApiFailure(presetsQ.error) && (presetsQ.error.kind === "missing" || presetsQ.error.status === 404);
  const presets = presetsQ.data?.presets ?? [];
  const [preset, setPreset] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [fromPick, setFromPick] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [variation, setVariation] = useState(30);
  const [seed, setSeed] = useState(1);
  const [delay, setDelay] = useState<DelayDraft>(DEFAULT_DELAY);
  const [viaRelay, setViaRelay] = useState(true);
  const [destPick, setDestPick] = useState<string[]>(() => (scopeGroup ? wallets.filter((w) => !w.archived && w.group === scopeGroup).map((w) => w.address) : []));
  const [result, setResult] = useState<FundDisperseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const balLam = (a: string) => lamOfBalance(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol);
  // From: what the user picked, else the selected/active wallet with a balance, else the first funded wallet, else a deposit wallet
  const autoFrom = [...selected, ...(active ? [active] : []), ...wallets.map((w) => w.address)].find((a) => wallets.some((w) => w.address === a) && balLam(a) > ZERO) ?? DEPOSIT;
  const from = fromPick ?? autoFrom;
  const isDeposit = from === DEPOSIT;
  const dests = destPick.filter((a) => a !== from && wallets.some((w) => w.address === a && !w.archived));
  const n = dests.length;
  const totalLam = solToLam(total) ?? ZERO;
  const amounts = useMemo(() => splitLamports(totalLam, n, variation, seededRng(seed)), [totalLam, n, variation, seed]);
  const sumLam = amounts.reduce((s, x) => s + x, ZERO);
  const d = readDelay(delay);
  const perSend = BigInt((isDeposit ? 5_000 : TX_FEE_MARGIN_LAM) + (viaRelay ? RELAY_FEE_LAM : 0));
  const feesLam = BigInt(n) * perSend;
  const needLam = totalLam + feesLam;
  const fromBal = isDeposit ? null : balLam(from);
  const etaMs = n ? ((d.range.minMs + d.range.maxMs) / 2) * (n - 1) + n * (viaRelay ? 4000 : 2000) : 0;
  const labelOf = (a: string) => wallets.find((w) => w.address === a)?.label || short(a);
  const low = viaRelay ? dests.findIndex((_, i) => amounts[i] < RENT_MIN) : -1;
  const problem =
    d.error ??
    (low >= 0 && totalLam > ZERO ? `Through a relay each payment must be ≥ ${lamToSol(RENT_MIN)} SOL — ${labelOf(dests[low])} would get ${lamToSol(amounts[low])} SOL. Raise the total or lower the variation.` : null) ??
    (fromBal !== null && totalLam > ZERO && fromBal < needLam ? `Short by ${solL(needLam - fromBal)} SOL.` : null) ??
    (fromBal !== null && totalLam > ZERO && fromBal - needLam < RENT_MIN ? `Would leave ~${solL(fromBal - needLam)} SOL on the source — under the ${lamToSol(RENT_MIN)} SOL rent minimum the network requires. Use Max or lower the total.` : null);
  const maxLam = fromBal !== null && n ? fromBal - feesLam - RENT_MIN : ZERO;
  const canStart = n > 0 && totalLam > ZERO && !problem;
  const line = `Total ${totalLam > ZERO ? solL(totalLam) : "0"} SOL → ${n} wallet${n !== 1 ? "s" : ""} · random ±${variation} % · delays ${delayText(delay)} · random order · relay ${viaRelay ? "ON" : "OFF"} · fees ~${solL(feesLam)} SOL · ETA ~${fmtDuration(etaMs)}`;
  const reroll = () => setSeed((s) => s + 1);

  const applyPreset = (p: DispersePreset) => {
    setPreset(p.id);
    setTotal(p.totalSol);
    setVariation(p.variationPct);
    setDelay(p.delayMaxSec !== undefined ? draftFromSec(p.delayMinSec ?? 0, p.delayMaxSec) : { min: String(p.delayMinutes), max: String(p.delayMinutes), unit: "min" });
    setViaRelay(p.viaRelay);
  };
  const savePreset = async (name: string, id?: string) => {
    try {
      const r = await post<DispersePresetsResponse>("/api/fund/disperse/presets", { preset: { id, name, totalSol: total || "0", variationPct: variation, delayMinutes: d.minSec / 60, delayMinSec: d.minSec, delayMaxSec: d.maxSec, viaRelay } });
      await presetsQ.refresh();
      // Block X keeps the saved preset selected (Update / Delete act on it right away)
      const saved = id ? r.presets.find((p) => p.id === id) : [...r.presets].reverse().find((p) => p.name === name);
      if (saved) setPreset(saved.id);
      setNaming(null);
      toast(`Preset “${name}” ${id ? "updated" : "saved"}`, "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const deletePreset = async () => {
    const p = presets.find((x) => x.id === preset);
    if (!p) return;
    try {
      await post("/api/fund/disperse/presets", { remove: p.id });
      await presetsQ.refresh();
      setPreset("");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const amountMap: Record<string, string> = {};
      dests.forEach((a, i) => (amountMap[a] = lamToSol(amounts[i])));
      const body: FundDisperseRequest = { ...(isDeposit ? { createDeposit: true } : { from }), to: dests, totalSol: lamToSol(totalLam), amounts: amountMap, variationPct: variation, delayMinSec: d.minSec, delayMaxSec: d.maxSec, shuffle: true, viaRelay, presetName: presets.find((p) => p.id === preset)?.name };
      const r = await post<FundDisperseResponse>("/api/fund/disperse", body);
      setResult(r);
      refreshVaultDependents();
      toast(r.from.isDeposit ? `Deposit wallet ${short(r.from.address, 6, 6)} created — fund it with ${r.needSol} SOL` : `Disperse started from ${r.from.label}`, "ok");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const presetBtn = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 transition-colors hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <Drawer
      title={`Disperse · ${scopeLabel}`}
      onClose={onClose}
      right={
        <button type="button" onClick={onHistory} className="text-xs text-accent hover:underline">
          History
        </button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div>
          <p className="mb-1 text-xs text-text-300">Preset</p>
          <div className="flex min-w-0 items-center gap-1">
            <select value={preset} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) applyPreset(p); else setPreset(""); }} disabled={!presets.length} className="h-7 min-w-0 flex-1 rounded-md border border-line-100 bg-bg-50 px-1.5 text-[11px] text-text-100 outline-none focus:border-accent disabled:opacity-50" aria-label="Load disperse preset" title={presetsMissing ? "Disperse presets are not served by this server yet" : "Load preset"}>
              <option value="">{presets.length ? "Load preset" : "No presets"}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {naming === null ? (
              <button type="button" disabled={presetsMissing} onClick={() => setNaming("")} className={presetBtn} title={presetsMissing ? "Disperse presets are not served by this server yet" : "Save current settings as a new preset"} aria-label="Save as preset">
                <Save className="h-3 w-3" />
              </button>
            ) : (
              <>
                <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && naming.trim()) savePreset(naming.trim()); if (e.key === "Escape") setNaming(null); }} placeholder="Name" className="h-7 w-28 rounded-md border border-line-100 bg-input-100 px-2 text-[11px] text-text-100 outline-none focus:border-accent" />
                <button type="button" disabled={!naming.trim()} onClick={() => savePreset(naming.trim())} className="h-7 rounded-md bg-accent px-2 text-[11px] font-medium text-white disabled:opacity-40">
                  Save
                </button>
              </>
            )}
            <button type="button" disabled={!preset} onClick={() => { const p = presets.find((x) => x.id === preset); if (p) savePreset(p.name, p.id); }} className={cx(presetBtn, "w-auto px-2 text-[11px] font-medium")} title="Overwrite selected preset">
              Update
            </button>
            <button type="button" disabled={!preset} onClick={deletePreset} className={cx(presetBtn, "text-decrease hover:text-decrease")} title="Delete selected preset" aria-label="Delete preset">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-300">From</label>
          <select value={from} onChange={(e) => setFromPick(e.target.value)} disabled={!!result} className="h-9 w-full rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-100 outline-none focus:border-accent" aria-label="Funding wallet">
            <option value={DEPOSIT}>New deposit wallet (fund it by QR, the job waits)</option>
            {wallets
              .filter((w) => !w.archived)
              .map((w) => (
                <option key={w.address} value={w.address}>
                  {w.label || short(w.address)} — {sol(balances?.[w.address] ?? w.sol)} SOL
                </option>
              ))}
          </select>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-text-300">Total to split (SOL)</label>
            {!isDeposit && n ? (
              <button type="button" disabled={maxLam <= ZERO} onClick={() => setTotal(lamToSol(maxLam - (maxLam % BigInt(1000))))} className="text-[11px] text-accent hover:underline disabled:opacity-40" title="Whole balance minus fees, keeping the rent minimum on the source">
                Max {maxLam > ZERO ? solL(maxLam) : "0"}
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <input value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" inputMode="decimal" className={field} />
            <button type="button" disabled={!(totalLam > ZERO) || !n} onClick={() => setVariation(0)} className="shrink-0 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45">
              Split equal
            </button>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="disperse-variation" className="text-xs text-text-300">
                Random variation
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-xs tabular-nums text-text-100">±{variation}%</span>
                <button type="button" disabled={!(totalLam > ZERO) || !variation} onClick={reroll} className="flex h-6 w-6 items-center justify-center rounded border border-line-100 bg-bg-50 text-text-300 hover:border-accent/35 hover:text-accent disabled:opacity-40" aria-label="Re-roll amounts" title="Re-roll the random amounts">
                  <Shuffle className="h-3 w-3" />
                </button>
              </div>
            </div>
            <input id="disperse-variation" min={0} max={100} step={1} className="consolidate-slider w-full" aria-valuemin={0} aria-valuemax={100} aria-valuenow={variation} aria-label="Variation" type="range" value={variation} onChange={(e) => setVariation(Number(e.target.value))} />
            <div className="mt-1 flex justify-between text-[11px] text-text-300">
              {[0, 25, 50, 75, 100].map((v) => (
                <button key={v} type="button" onClick={() => setVariation(v)} className={cx("transition-colors hover:text-text-100", variation === v ? "text-text-100" : "")}>
                  {v}%
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-text-300">Each amount is drawn ±{variation}% around the equal share, then rescaled so they add up to the total exactly.</p>
          </div>
        </div>
        <DelayRangeField value={delay} onChange={setDelay} />
        <div>
          <label className="mb-1 block text-xs text-text-300">Destinations — a group in one click, or tick wallets</label>
          <WalletPicker wallets={wallets} groups={groups} value={dests} onChange={setDestPick} balances={balances} exclude={isDeposit ? [] : [from]} />
        </div>
        <PrivacyRelaySwitch checked={viaRelay} onChange={setViaRelay} />
        {n && totalLam > ZERO ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-text-300">
              <span>Plan preview — order and delays are drawn at start</span>
              <button type="button" onClick={reroll} disabled={!variation} className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-40">
                <Shuffle className="h-3 w-3" /> Re-roll
              </button>
            </div>
            <PlanTable rows={dests.map((a, i) => ({ label: labelOf(a), sol: lamToSol(amounts[i]) }))} />
            <p className={cx("mt-1 text-right font-mono text-[11px]", sumLam === totalLam ? "text-green-100" : "text-decrease")}>
              Σ {lamToSol(sumLam)} SOL {sumLam === totalLam ? "= total" : "≠ total"}
            </p>
          </div>
        ) : null}
        <PlanSummary line={line} available={isDeposit ? undefined : fromBal === null ? null : lamToSol(fromBal)} needed={lamToSol(needLam)} problem={totalLam > ZERO || d.error ? problem : null} />
        {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
        {result ? (
          <div className="flex flex-col gap-3">
            {result.from.isDeposit ? <AddressBox address={result.from.address} label={`${result.from.label} — send exactly ${result.needSol} SOL here`} /> : null}
            <p className="text-[11px] text-text-300">
              {result.from.isDeposit ? `The job waits until this wallet holds ${result.needSol} SOL, then` : `${result.from.label}`} sends {result.plan.length} payment{result.plan.length !== 1 ? "s" : ""} in this random order{viaRelay ? ", each through its own relay" : ""}. Stop it any time below or from the Activity tab.
            </p>
            <PlanTable title={`Drawn plan — Σ ${result.totalSol} SOL · ETA ~${fmtDuration(result.etaMs ?? 0)}`} rows={result.plan.map((p) => ({ label: p.label, sol: p.sol, delayMs: p.delayMs }))} />
            <div className="rounded-md border border-line-100 bg-bg-50 p-3">
              <BxJob jobId={result.jobId} />
            </div>
            <button type="button" onClick={() => setResult(null)} className="h-8 rounded border border-line-100 bg-bg-50 text-xs text-text-200 hover:text-text-100">
              New disperse
            </button>
          </div>
        ) : (
          <button type="button" disabled={!canStart || busy} onClick={start} className="h-9 rounded border border-accent/40 bg-accent/15 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50">
            {busy ? "Starting…" : isDeposit ? "Create deposit wallet" : `Start private disperse · ${n} wallet${n !== 1 ? "s" : ""}`}
          </button>
        )}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------ Reverse Disperse */
export function ReverseDisperseDrawer({ onClose, wallets, groups, scopeLabel, scopeGroup, balances }: { onClose: () => void; wallets: WalletInfo[]; groups: WalletGroup[]; scopeLabel: string; scopeGroup: string | null; balances: Record<string, string | null> | null }) {
  const [mode, setMode] = useState<"address" | "wallet">("address");
  const [address, setAddress] = useState("");
  const [toWallet, setToWallet] = useState("");
  const [sel, setSel] = useState<string[]>(() => (scopeGroup ? wallets.filter((w) => !w.archived && w.group === scopeGroup).map((w) => w.address) : []));
  const [delay, setDelay] = useState<DelayDraft>(DEFAULT_DELAY);
  const [viaRelay, setViaRelay] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const balOf = (a: string) => Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0;
  const to = mode === "address" ? address.trim() : toWallet;
  const picked = sel.filter((a) => a !== to && wallets.some((w) => w.address === a && !w.archived));
  const n = picked.length;
  const totalSel = picked.reduce((s, a) => s + balOf(a), 0);
  const d = readDelay(delay);
  const fees = n * (0.000005 + (viaRelay ? 0.000005 : 0));
  const etaMs = n ? ((d.range.minMs + d.range.maxMs) / 2) * (n - 1) + n * (viaRelay ? 4000 : 2000) : 0;
  const relayMin = (RENT_MIN_LAM + 10_000) / 1e9;
  const tooSmall = viaRelay ? picked.filter((a) => balOf(a) > 0 && balOf(a) < relayMin).length : 0;
  const validTo = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to);
  const toLabel = mode === "wallet" ? wallets.find((w) => w.address === to)?.label || (to ? short(to) : "—") : to ? short(to) : "—";
  const valid = n > 0 && validTo && !d.error;
  const line = `Sweep ${n} wallet${n !== 1 ? "s" : ""} (${sol(totalSel)} SOL) → ${toLabel} · delays ${delayText(delay)} · random order · relay ${viaRelay ? "ON" : "OFF"} · fees ~${sol(fees, 6)} SOL · ETA ~${fmtDuration(etaMs)}`;
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<JobCreated>("/api/fund/consolidate", { sources: picked, to, viaRelay, delayMinSec: d.minSec, delayMaxSec: d.maxSec, shuffle: true, kind: "reverse" });
      setJobId(r.jobId);
      toast(`Reverse disperse started on ${n} wallet${n !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={`Reverse Disperse · ${scopeLabel}`} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-text-300">Recipient</label>
            <div className="flex h-6 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
              {(["address", "wallet"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cx("h-full rounded px-2 text-[10px] font-medium transition-colors", mode === m ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                  {m === "address" ? "Address" : "Select wallet"}
                </button>
              ))}
            </div>
          </div>
          {mode === "address" ? (
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Solana address" spellCheck={false} className={cx(field, "font-mono text-xs")} />
          ) : (
            <select value={toWallet} onChange={(e) => setToWallet(e.target.value)} className="h-9 w-full rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-100 outline-none focus:border-accent">
              <option value="">Choose a wallet</option>
              {wallets
                .filter((w) => !w.archived)
                .map((w) => (
                  <option key={w.address} value={w.address}>
                    {w.label || short(w.address)} — {sol(balOf(w.address))} SOL
                  </option>
                ))}
            </select>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-text-300">Wallets to sweep — a group in one click, or tick wallets</label>
            <button type="button" onClick={() => setSel(wallets.filter((w) => !w.archived && w.address !== to && balOf(w.address) > 0).map((w) => w.address))} className="text-[11px] text-accent hover:underline">
              With balance
            </button>
          </div>
          <WalletPicker wallets={wallets} groups={groups} value={picked} onChange={setSel} balances={balances} exclude={to ? [to] : []} />
        </div>
        <DelayRangeField value={delay} onChange={setDelay} label="Random delay before each wallet" />
        <PrivacyRelaySwitch checked={viaRelay} onChange={setViaRelay} what="wallet" />
        <PlanSummary line={line} problem={d.error ?? (tooSmall ? `${tooSmall} wallet${tooSmall !== 1 ? "s hold" : " holds"} less than ${relayMin} SOL — too little for a relay hop; skipped.` : null)} />
        <p className="text-[11px] text-text-300">Every wallet sends its whole balance and ends at 0; the order is drawn at start.</p>
        {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
        {jobId ? (
          <div className="rounded-md border border-line-100 bg-bg-50 p-3">
            <BxJob jobId={jobId} />
          </div>
        ) : (
          <button type="button" disabled={!valid || busy} onClick={start} className="h-9 rounded border border-accent/40 bg-accent/15 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50">
            Start Reverse Disperse
          </button>
        )}
      </div>
    </Drawer>
  );
}
