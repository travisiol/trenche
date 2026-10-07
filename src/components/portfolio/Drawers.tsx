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
import { DEFAULT_DELAY, DelayRangeField, PlanSummary, PrivacyRelaySwitch, delayText, readDelay, type DelayDraft } from "./PrivacyFields";
import type { DispersePreset, DispersePresetsResponse, FundDisperseRequest, FundDisperseResponse, JobCreated, WalletGroup, WalletInfo, WalletsGenerateResponse } from "@/lib/types";
import { useJob } from "@/components/JobProgress";
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

function useQr(text: string | null, onWhite = false) {
  const [qr, setQr] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: onWhite ? 164 : 180, color: onWhite ? { dark: "#000000", light: "#ffffff" } : { dark: "#f0f5f5", light: "#0a0a0a" } }).then((url) => alive && setQr({ text, url }));
    return () => {
      alive = false;
    };
  }, [text, onWhite]);
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
const ZERO = BigInt(0);
const RENT_MIN = BigInt(RENT_MIN_LAM);
const solL = (l: bigint) => sol(Number(l) / 1e9, 6);
const lamOfBalance = (v: string | number | null | undefined): bigint => (v === null || v === undefined ? ZERO : (solToLam(String(v)) ?? ZERO));

export function DisperseDrawer({ onClose, wallets, groups, balances, selected, active, scopeLabel, scopeGroup, onHistory }: { onClose: () => void; wallets: WalletInfo[]; groups: WalletGroup[]; balances: Record<string, string | null> | null; selected: string[]; active: string | null; scopeLabel: string; scopeGroup: string | null; onHistory: () => void }) {
  void groups;
  void active;
  const presetsQ = useGet<DispersePresetsResponse>("/api/fund/disperse/presets", 0);
  const presetsMissing = isApiFailure(presetsQ.error) && (presetsQ.error.kind === "missing" || presetsQ.error.status === 404);
  const presets = presetsQ.data?.presets ?? [];
  const [preset, setPreset] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [variation, setVariation] = useState(0);
  const [seed, setSeed] = useState(1);
  const [delayMin, setDelayMin] = useState("0");
  const [viaRelay, setViaRelay] = useState(true);
  const live = wallets.filter((w) => !w.archived);
  // Block X: a group's Disperse lists that group; the Developer Wallets one lists the wallets outside any group
  const section = (scopeGroup ? live.filter((w) => w.group === scopeGroup) : live.filter((w) => !w.group)).map((w) => w.address);
  const [extraDevs, setExtraDevs] = useState<string[]>([]);
  const listed = [...section, ...extraDevs.filter((a) => !section.includes(a))];
  const [destPick, setDestPick] = useState<string[]>(() => {
    const picked = !scopeGroup ? selected.filter((a) => section.includes(a)) : [];
    return picked.length ? picked : section;
  });
  const [devPick, setDevPick] = useState("");
  const [creatingDev, setCreatingDev] = useState(false);
  /** null = amounts follow total / variation; typing a row freezes them until the next change */
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const [result, setResult] = useState<FundDisperseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addressOnly, setAddressOnly] = useState(false);
  const [confirmPay, setConfirmPay] = useState<string | null>(null);
  const [payJob, setPayJob] = useState<string | null>(null);

  const balLam = (a: string) => lamOfBalance(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol);
  const labelOf = (a: string) => wallets.find((w) => w.address === a)?.label || short(a);
  const dests = listed.filter((a) => destPick.includes(a));
  const n = dests.length;
  const totalLam = solToLam(total) ?? ZERO;
  const auto = useMemo(() => splitLamports(totalLam, n, variation, seededRng(seed)), [totalLam, n, variation, seed]);
  const autoMap: Record<string, string> = Object.fromEntries(dests.map((a, i) => [a, auto[i] !== undefined && auto[i] > ZERO ? lamToSol(auto[i]) : ""]));
  const amountOf = (a: string) => (edited ? (edited[a] ?? "") : (autoMap[a] ?? ""));
  const rowLam = (a: string) => solToLam(amountOf(a)) ?? ZERO;
  const depositLam = dests.reduce((s, a) => s + rowLam(a), ZERO);
  const delayNum = Number(delayMin || "0");
  const perSend = BigInt(5_000 + (viaRelay ? RELAY_FEE_LAM : 0));
  const needLam = depositLam + BigInt(n) * perSend;
  const freeze = () => setEdited(null);
  const devOptions = live.filter((w) => !w.group && !listed.includes(w.address));
  const problem =
    !n ? "Tick at least one destination."
    : !(delayNum >= 0 && delayNum <= 1440) ? "Delay: 0 to 1440 minutes."
    : dests.some((a) => rowLam(a) <= ZERO) ? (totalLam > ZERO || edited ? "Every ticked wallet needs an amount." : null)
    : viaRelay && dests.some((a) => rowLam(a) < RENT_MIN) ? `Through a relay each payment must be ≥ ${lamToSol(RENT_MIN)} SOL — raise the total or lower the variation.`
    : null;
  const canStart = n > 0 && depositLam > ZERO && !problem;

  const applyPreset = (p: DispersePreset) => {
    setPreset(p.id);
    setTotal(p.totalSol);
    setVariation(p.variationPct);
    setDelayMin(String(Math.round(((p.delayMaxSec ?? p.delayMinutes * 60) / 60) * 100) / 100));
    setViaRelay(p.viaRelay);
    freeze();
  };
  const savePreset = async (name: string, id?: string) => {
    try {
      const r = await post<DispersePresetsResponse>("/api/fund/disperse/presets", { preset: { id, name, totalSol: total || "0", variationPct: variation, delayMinutes: delayNum, delayMinSec: delayNum * 60, delayMaxSec: delayNum * 60, viaRelay } });
      await presetsQ.refresh();
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
  const addDev = (a: string) => {
    if (!a) return;
    setExtraDevs((x) => (x.includes(a) ? x : [...x, a]));
    setDestPick((x) => (x.includes(a) ? x : [...x, a]));
    setDevPick("");
    freeze();
  };
  const newDev = async () => {
    setCreatingDev(true);
    try {
      const r = await post<WalletsGenerateResponse>("/api/wallets/generate", { count: 1 });
      refreshVaultDependents();
      const a = r.addresses?.[0];
      if (a) addDev(a);
      toast("Developer wallet created", "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setCreatingDev(false);
    }
  };
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const amountMap: Record<string, string> = {};
      for (const a of dests) amountMap[a] = lamToSol(rowLam(a));
      const body: FundDisperseRequest = { createDeposit: true, to: dests, totalSol: lamToSol(depositLam), amounts: amountMap, variationPct: variation, delayMinSec: Math.round(delayNum * 60), delayMaxSec: Math.round(delayNum * 60), shuffle: true, viaRelay, presetName: presets.find((p) => p.id === preset)?.name };
      const r = await post<FundDisperseResponse>("/api/fund/disperse", body);
      setResult(r);
      refreshVaultDependents();
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pay = async (from: string) => {
    if (!result) return;
    setErr(null);
    try {
      const r = await post<JobCreated>("/api/fund/transfer", { from, to: result.from.address, sol: result.needSol });
      setPayJob(r.jobId);
      setConfirmPay(null);
      refreshVaultDependents();
    } catch (e) {
      setErr(failureMessage(e));
    }
  };
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copied", "ok");
    } catch {
      toast("Select it and copy by hand", "info");
    }
  };
  const presetBtn = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 transition-colors hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40";
  const card = "rounded-[10px] border border-line-100";

  // after "Create deposit wallet": the job waits for the deposit, then disperses (job.extra.phase / plan)
  const job = useJob(result?.jobId ?? null).job;
  const extra = (job?.extra ?? {}) as { phase?: string; balanceSol?: string | null; plan?: { label: string; sol: string; status?: string; delayMs?: number }[] };
  const phase = job?.status === "error" ? "error" : job?.status === "stopped" ? "stopped" : extra.phase ?? "waiting";
  const planRows: { label: string; sol: string; status?: string; delayMs?: number }[] = extra.plan ?? result?.plan ?? [];
  const sentCount = planRows.filter((r) => r.status === "sent").length;
  const qr = useQr(result && !addressOnly ? result.from.address : null, true);
  const needWithFee = result ? (solToLam(result.needSol) ?? ZERO) + BigInt(TX_FEE_MARGIN_LAM) : ZERO;
  const payers = result ? live.filter((w) => w.address !== result.from.address && !result.plan.some((p) => p.address === w.address) && balLam(w.address) >= needWithFee) : [];
  const statusText =
    phase === "waiting" ? "Waiting for deposit"
    : phase === "sending" ? `Dispersing · ${sentCount}/${planRows.length}`
    : phase === "done" ? `Done · ${sentCount}/${planRows.length} funded`
    : phase === "stopped" ? "Stopped"
    : "Failed";

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
        {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
        {result ? (
          <>
            {phase === "waiting" ? (
              <div className={cx(card, "p-4")}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-300">Deposit address</span>
                  <button type="button" onClick={() => setAddressOnly(!addressOnly)} className="h-7 rounded border border-line-100 bg-bg-50 px-2.5 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent">
                    {addressOnly ? "Show QR" : "Address only"}
                  </button>
                </div>
                {!addressOnly ? (
                  <div className="my-4 flex justify-center">
                    {qr ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side
                      <img src={qr} alt="Deposit address QR code" width={164} height={164} className="rounded-lg bg-white p-1.5" />
                    ) : (
                      <div className="h-[164px] w-[164px] rounded-lg bg-white/5" />
                    )}
                  </div>
                ) : null}
                <div className={cx("flex items-center gap-2", addressOnly && "mt-3")}>
                  <span className="min-w-0 flex-1 select-all break-all font-mono text-xs text-text-100">{result.from.address}</span>
                  <button type="button" aria-label="Copy deposit address" onClick={() => copy(result.from.address)} className="shrink-0 text-text-300 hover:text-accent">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-3 text-sm text-text-200">
                  Send{" "}
                  <button type="button" onClick={() => copy(result.needSol)} className="font-semibold text-text-100 hover:text-accent">
                    {result.needSol} SOL
                  </button>{" "}
                  to start dispersing.
                </p>
                {extra.balanceSol && Number(extra.balanceSol) > 0 ? <p className="mt-1 text-[11px] text-text-300">Received so far: {extra.balanceSol} SOL</p> : null}
              </div>
            ) : null}
            {phase === "waiting" ? (
              <div className={card}>
                <div className="border-b border-line-50 px-3 py-2">
                  <p className="text-[13px] font-medium text-text-100">Pay from wallet</p>
                  <p className="text-[11px] text-text-300">Send {result.needSol} SOL from a managed wallet with enough balance.</p>
                </div>
                {payJob ? (
                  <div className="px-3 py-3">
                    <BxJob jobId={payJob} compact />
                  </div>
                ) : payers.length ? (
                  <div className="max-h-56 overflow-y-auto">
                    {payers.map((w) => (
                      <div key={w.address} className="flex items-center gap-3 border-b border-line-50 px-3 py-2 last:border-b-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-text-100">{w.label || short(w.address)}</span>
                          <span className="block text-[11px] text-text-300">
                            {short(w.address)} · {sol(balances?.[w.address] ?? w.sol)} SOL
                          </span>
                        </span>
                        {confirmPay === w.address ? (
                          <span className="flex gap-1.5">
                            <button type="button" onClick={() => setConfirmPay(null)} className="h-8 rounded border border-line-100 bg-bg-50 px-2.5 text-xs text-text-200">
                              Cancel
                            </button>
                            <button type="button" onClick={() => pay(w.address)} className="h-8 rounded bg-accent px-3 text-xs font-medium text-white">
                              Send {result.needSol} SOL
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirmPay(w.address)} className="h-8 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent">
                            Pay
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-3 text-sm text-text-300">No wallets have enough SOL (need ~{solL(needWithFee)} including fees).</p>
                )}
              </div>
            ) : null}
            <div className={cx(card, "flex items-center justify-between px-3 py-3 text-sm")}>
              <span className="text-text-300">Status</span>
              <span className={cx("font-medium", phase === "error" ? "text-decrease" : phase === "done" ? "text-green-100" : "text-text-100")}>{statusText}</span>
            </div>
            {job?.error ? <p className="text-[11px] leading-relaxed text-decrease">{job.error}</p> : null}
            {planRows.length ? (
              <div className={card}>
                <div className="border-b border-line-50 px-3 py-2 text-xs text-text-300">
                  Plan · {result.totalSol} SOL → {planRows.length} wallet{planRows.length !== 1 ? "s" : ""} · random order{viaRelay ? " · relay each" : ""}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {planRows.map((r, i) => (
                    <div key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 border-b border-line-50 px-3 py-2 text-xs last:border-b-0">
                      <span className="text-text-100">{r.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-text-100">{r.sol} SOL</span>
                        <span className={cx("w-14 text-right", r.status === "sent" ? "text-green-100" : r.status === "failed" ? "text-decrease" : "text-text-300")}>{r.status ?? "pending"}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {phase === "waiting" || phase === "sending" ? (
              <div className="rounded-md border border-line-100 bg-bg-50 p-3">
                <BxJob jobId={result.jobId} compact />
              </div>
            ) : null}
            <button type="button" onClick={() => { setResult(null); setPayJob(null); setConfirmPay(null); }} className="h-9 rounded border border-line-100 bg-bg-50 text-sm text-text-200 hover:text-text-100">
              {phase === "waiting" || phase === "sending" ? "New disperse (this one keeps running)" : "New disperse"}
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="mb-1 text-xs text-text-300">Preset</p>
              <div className="flex min-w-0 items-center gap-1">
                <select value={preset} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) applyPreset(p); else setPreset(""); }} disabled={!presets.length} className="h-9 min-w-0 flex-1 rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-100 outline-none focus:border-accent disabled:opacity-50" aria-label="Load disperse preset" title={presetsMissing ? "Disperse presets are not served by this server yet" : "Load preset"}>
                  <option value="">{presets.length ? "Load preset" : "No presets"}</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {naming === null ? (
                  <button type="button" disabled={presetsMissing} onClick={() => setNaming("")} className={cx(presetBtn, "h-9 w-9")} title="Save current settings as a new preset" aria-label="Save as preset">
                    <Save className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <>
                    <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && naming.trim()) savePreset(naming.trim()); if (e.key === "Escape") setNaming(null); }} placeholder="Name" className="h-9 w-28 rounded-md border border-line-100 bg-input-100 px-2 text-xs text-text-100 outline-none focus:border-accent" />
                    <button type="button" disabled={!naming.trim()} onClick={() => savePreset(naming.trim())} className="h-9 rounded-md bg-accent px-2 text-xs font-medium text-white disabled:opacity-40">
                      Save
                    </button>
                  </>
                )}
                <button type="button" disabled={!preset} onClick={() => { const p = presets.find((x) => x.id === preset); if (p) savePreset(p.name, p.id); }} className={cx(presetBtn, "h-9 w-auto px-2.5 text-xs font-medium")} title="Overwrite selected preset">
                  Update
                </button>
                <button type="button" disabled={!preset} onClick={deletePreset} className={cx(presetBtn, "h-9 w-9 text-decrease hover:text-decrease")} title="Delete selected preset" aria-label="Delete preset">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-300">Total to split (SOL)</label>
              <div className="flex gap-2">
                <input value={total} onChange={(e) => { setTotal(e.target.value.replace(/[^0-9.]/g, "")); freeze(); }} placeholder="0.0" inputMode="decimal" className={field} />
                <button type="button" disabled={!(totalLam > ZERO) || !n} onClick={() => { setVariation(0); freeze(); }} className="shrink-0 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45">
                  Split equal
                </button>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor="disperse-variation" className="text-xs text-text-300">
                  Variation
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs tabular-nums text-text-100">{variation}%</span>
                  <button type="button" disabled={!(totalLam > ZERO) || !variation} onClick={() => { setSeed((s) => s + 1); freeze(); }} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:text-accent disabled:opacity-40" aria-label="Re-roll amounts" title="Re-roll the amounts">
                    <Shuffle className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <input id="disperse-variation" min={0} max={100} step={1} className="consolidate-slider w-full" aria-label="Variation" type="range" value={variation} onChange={(e) => { setVariation(Number(e.target.value)); freeze(); }} />
              <div className="mt-1 flex justify-between text-[11px] text-text-300">
                {[0, 25, 50, 75, 100].map((v) => (
                  <button key={v} type="button" onClick={() => { setVariation(v); freeze(); }} className={cx("transition-colors hover:text-text-100", variation === v ? "text-text-100" : "")}>
                    {v}%
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-text-300">0% is an equal split. Drag to vary amounts across wallets while still summing to the total. You can still edit any row.</p>
            </div>
            <div>
              <label htmlFor="disperse-delay" className="mb-1 block text-xs text-text-300">
                Delay between wallets (minutes)
              </label>
              <input id="disperse-delay" value={delayMin} onChange={(e) => setDelayMin(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={field} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-300">Add Developer Wallet</label>
              <div className="flex gap-2">
                <select value={devPick} onChange={(e) => setDevPick(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-100 outline-none focus:border-accent" aria-label="Developer wallet to add">
                  <option value="">{devOptions.length ? "Select a developer wallet…" : "No other developer wallet"}</option>
                  {devOptions.map((w) => (
                    <option key={w.address} value={w.address}>
                      {w.label || short(w.address)} — {sol(balances?.[w.address] ?? w.sol)} SOL
                    </option>
                  ))}
                </select>
                <button type="button" disabled={creatingDev} onClick={newDev} className="flex h-9 shrink-0 items-center gap-1 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45">
                  {creatingDev ? "…" : "+ New"}
                </button>
                <button type="button" disabled={!devPick} onClick={() => addDev(devPick)} className="flex h-9 shrink-0 items-center gap-1 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45">
                  + Add
                </button>
              </div>
              <p className="mt-1 text-[11px] text-text-300">Adds a developer wallet alongside {scopeGroup ? "this group's" : "these"} destinations.</p>
            </div>
            <div className={card}>
              <div className="flex items-center justify-between border-b border-line-50 px-3 py-2">
                <span className="text-xs text-text-300">
                  Destinations ({n}/{listed.length})
                </span>
                {n ? (
                  <button type="button" onClick={() => { setDestPick([]); freeze(); }} className="text-xs text-accent hover:underline">
                    Clear
                  </button>
                ) : (
                  <button type="button" onClick={() => { setDestPick(listed); freeze(); }} className="text-xs text-accent hover:underline">
                    All
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {listed.length ? (
                  listed.map((a) => {
                    const on = destPick.includes(a);
                    return (
                      <div key={a} className="flex items-center gap-3 px-3 py-2">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                          <input type="checkbox" checked={on} onChange={(e) => { setDestPick((x) => (e.target.checked ? [...x, a] : x.filter((y) => y !== a))); freeze(); }} className="h-4 w-4 shrink-0 accent-accent" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-text-100">
                              {labelOf(a)}
                              {extraDevs.includes(a) ? <span className="ml-1.5 text-[10px] font-normal text-accent">dev</span> : null}
                            </span>
                            <span className="block truncate text-[11px] text-text-300">
                              {short(a)} · {sol(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol)} SOL
                            </span>
                          </span>
                        </label>
                        <input aria-label={`Amount for ${labelOf(a)}`} inputMode="decimal" placeholder="0" disabled={!on} value={on ? amountOf(a) : ""} onChange={(e) => setEdited({ ...(edited ?? autoMap), [a]: e.target.value.replace(/[^0-9.]/g, "") })} className="h-9 w-[120px] shrink-0 border border-line-100 bg-bg-50 px-3 text-right font-mono text-xs text-text-100 outline-none focus:border-accent disabled:opacity-50" />
                      </div>
                    );
                  })
                ) : (
                  <p className="px-3 py-4 text-sm text-text-300">No wallets in this section.</p>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-line-50 px-3 py-2 text-xs">
                <span className="text-text-300">Deposit total</span>
                <span className="font-medium text-text-100">{depositLam > ZERO ? solL(depositLam) : "0"} SOL</span>
              </div>
            </div>
            <PrivacyRelaySwitch checked={viaRelay} onChange={setViaRelay} />
            {problem && (totalLam > ZERO || edited || !n) ? <p className="text-[11px] leading-relaxed text-decrease">{problem}</p> : null}
            {canStart ? <p className="text-[11px] text-text-300">A fresh deposit wallet is created. Fund it with ~{solL(needLam)} SOL (amounts + {n} send fee{n !== 1 ? "s" : ""}) and it sends to the {n} wallet{n !== 1 ? "s" : ""} in random order, {delayNum ? `${delayNum} min apart` : "one after the other"}.</p> : null}
            <button type="button" disabled={!canStart || busy} onClick={start} className="h-10 rounded border border-accent/40 bg-accent/15 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50">
              {busy ? "Creating…" : "Create deposit wallet"}
            </button>
          </>
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
