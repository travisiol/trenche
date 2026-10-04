"use client";
/** Block X right-side drawers of the Portfolio summary panel (BEHAVIOUR.md §5.3): Deposit (portfolio-deposit.html),
 *  Disperse (portfolio-disperse.html: preset bar, total + Split equal, Variation slider, delay in minutes, destinations
 *  with editable rows, Deposit total, Create deposit wallet → fresh deposit wallet with address + QR, the job waits for
 *  the funds), Reverse Disperse (recipient Address / Select wallet, wallet list, delay, Start). Mixer: omitted (no provider). */
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Save, Shuffle, Trash2, X } from "lucide-react";
import type { DispersePreset, DispersePresetsResponse, FundDisperseRequest, FundDisperseResponse, JobCreated, WalletGroup, WalletInfo } from "@/lib/types";
import { failureMessage, isApiFailure, post, useGet } from "@/lib/api";
import { refreshVaultDependents } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxSwitch, cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";

export type DrawerKind = "deposit" | "withdraw" | "disperse" | "reverse" | null;

const field = "w-full border border-line-100 bg-bg-50 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent";
const TX_FEE = 0.000005;

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
/** Equal split with ±variation, rows still summing to the total (two decimals of lamport precision kept at 6). */
function splitAmounts(total: number, n: number, variationPct: number, seed: number): number[] {
  if (!n || !(total > 0)) return Array(n).fill(0);
  const avg = total / n;
  if (!variationPct) return Array(n).fill(avg);
  let s = seed || 1;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const raw = Array.from({ length: n }, () => avg * (1 + ((rnd() * 2 - 1) * variationPct) / 100));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => (x / sum) * total);
}
const fmt6 = (n: number) => (Math.round(n * 1e6) / 1e6).toString();

export function DisperseDrawer({ onClose, wallets, groups, scopeLabel, scopeGroup, onHistory }: { onClose: () => void; wallets: WalletInfo[]; groups: WalletGroup[]; scopeLabel: string; scopeGroup: string | null; onHistory: () => void }) {
  const presetsQ = useGet<DispersePresetsResponse>("/api/fund/disperse/presets", 0);
  const presetsMissing = isApiFailure(presetsQ.error) && (presetsQ.error.kind === "missing" || presetsQ.error.status === 404);
  const presets = presetsQ.data?.presets ?? [];
  const [preset, setPreset] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [variation, setVariation] = useState(0);
  const [seed, setSeed] = useState(1);
  const [delay, setDelay] = useState("0");
  const [viaRelay, setViaRelay] = useState(false);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [targetGroup, setTargetGroup] = useState<string>(scopeGroup ?? "");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<FundDisperseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dests = useMemo(() => wallets.filter((w) => !w.archived && (targetGroup ? w.group === targetGroup : true) && !excluded.has(w.address)), [wallets, targetGroup, excluded]);
  const totalNum = Number(total) || 0;
  const auto = useMemo(() => splitAmounts(totalNum, dests.length, variation, seed), [totalNum, dests.length, variation, seed]);
  const amountOf = (a: string, i: number) => (edited[a] !== undefined ? edited[a] : fmt6(auto[i] ?? 0));
  const depositTotal = dests.reduce((n, w, i) => n + (Number(amountOf(w.address, i)) || 0), 0);
  const fees = dests.length * (TX_FEE + (viaRelay ? 0.00001 : 0));
  const canStart = dests.length > 0 && depositTotal > 0;

  const applyPreset = (p: DispersePreset) => {
    setPreset(p.id);
    setTotal(p.totalSol);
    setVariation(p.variationPct);
    setDelay(String(p.delayMinutes));
    setViaRelay(p.viaRelay);
    setEdited({});
  };
  const savePreset = async (name: string, id?: string) => {
    try {
      const r = await post<DispersePresetsResponse>("/api/fund/disperse/presets", { preset: { id, name, totalSol: total || "0", variationPct: variation, delayMinutes: Number(delay) || 0, viaRelay } });
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
      const amounts: Record<string, string> = {};
      dests.forEach((w, i) => (amounts[w.address] = amountOf(w.address, i)));
      const body: FundDisperseRequest = { createDeposit: true, to: dests.map((w) => w.address), totalSol: fmt6(depositTotal), amounts, variationPct: variation, delayMinutes: Number(delay) || 0, viaRelay: viaRelay || undefined, presetName: presets.find((p) => p.id === preset)?.name };
      const r = await post<FundDisperseResponse>("/api/fund/disperse", body);
      setResult(r);
      refreshVaultDependents();
      toast(`Deposit wallet ${short(r.from.address, 6, 6)} created — fund it with ${r.needSol} SOL`, "ok");
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
          <label className="mb-1 block text-xs text-text-300">Total to split (SOL)</label>
          <div className="flex gap-2">
            <input value={total} onChange={(e) => { setTotal(e.target.value.replace(/[^0-9.]/g, "")); setEdited({}); }} placeholder="0.0" inputMode="decimal" className={field} />
            <button type="button" disabled={!(totalNum > 0) || !dests.length} onClick={() => { setVariation(0); setEdited({}); }} className="shrink-0 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45">
              Split equal
            </button>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="disperse-variation" className="text-xs text-text-300">
                Variation
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-xs tabular-nums text-text-100">{variation}%</span>
                <button type="button" disabled={!(totalNum > 0) || !variation} onClick={() => { setSeed((s) => s + 1); setEdited({}); }} className="flex h-6 w-6 items-center justify-center rounded border border-line-100 bg-bg-50 text-text-300 hover:border-accent/35 hover:text-accent disabled:opacity-40" aria-label="Shuffle variation" title="Shuffle amounts">
                  <Shuffle className="h-3 w-3" />
                </button>
              </div>
            </div>
            <input id="disperse-variation" min={0} max={100} step={1} disabled={!(totalNum > 0)} className="consolidate-slider w-full" aria-valuemin={0} aria-valuemax={100} aria-valuenow={variation} aria-label="Variation" type="range" value={variation} onChange={(e) => { setVariation(Number(e.target.value)); setEdited({}); }} />
            <div className="mt-1 flex justify-between text-[11px] text-text-300">
              {[0, 25, 50, 75, 100].map((v) => (
                <button key={v} type="button" disabled={!(totalNum > 0)} onClick={() => { setVariation(v); setEdited({}); }} className={cx("transition-colors hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40", variation === v ? "text-text-100" : "")}>
                  {v}%
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-text-300">0% is an equal split. Drag to vary amounts across wallets while still summing to the total. You can still edit any row.</p>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-300">Delay between wallets (minutes)</label>
          <input value={delay} onChange={(e) => setDelay(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={field} />
        </div>
        {groups.length ? (
          <div>
            <label className="mb-1 block text-xs text-text-300">Destinations</label>
            <select value={targetGroup} onChange={(e) => { setTargetGroup(e.target.value); setExcluded(new Set()); setEdited({}); }} className="h-9 w-full rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-100 outline-none focus:border-accent">
              <option value="">Developer Wallets (all)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            <span className="text-text-100">Relay hop</span>
            <span className="block text-[11px] text-text-300">One fresh relay wallet per destination, keys never stored, two signatures each.</span>
          </span>
          <BxSwitch checked={viaRelay} onChange={setViaRelay} />
        </label>
        <div className="rounded-[10px] border border-line-100">
          <div className="flex items-center justify-between border-b border-line-50 px-3 py-2">
            <span className="text-xs text-text-300">
              Destinations ({dests.length}/{wallets.filter((w) => !w.archived && (targetGroup ? w.group === targetGroup : true)).length})
            </span>
            <button type="button" onClick={() => { setExcluded(new Set(wallets.map((w) => w.address))); setEdited({}); }} className="text-xs text-accent hover:underline">
              Clear
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {!dests.length ? (
              <p className="px-3 py-4 text-sm text-text-300">
                No wallets in this section.
                {excluded.size ? (
                  <button type="button" onClick={() => setExcluded(new Set())} className="ml-2 text-accent hover:underline">
                    Restore
                  </button>
                ) : null}
              </p>
            ) : (
              dests.map((w, i) => (
                <div key={w.address} className="flex items-center gap-2 border-b border-line-50 px-3 py-1.5 text-xs last:border-0">
                  <span className="min-w-0 flex-1 truncate text-text-100">{w.label || short(w.address)}</span>
                  <span className="font-mono text-[11px] text-text-300">{short(w.address, 4, 4)}</span>
                  <span className="relative">
                    <input inputMode="decimal" value={amountOf(w.address, i)} onChange={(e) => setEdited((m) => ({ ...m, [w.address]: e.target.value.replace(/[^0-9.]/g, "") }))} className="h-7 w-24 rounded-md border border-line-100 bg-input-100 px-2 pr-9 text-right font-mono text-[11px] text-text-100 outline-none focus:border-accent" aria-label={`Amount for ${w.label}`} />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-300">SOL</span>
                  </span>
                  <button type="button" onClick={() => setExcluded((s) => new Set([...s, w.address]))} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-decrease" aria-label={`Remove ${w.label}`}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line-50 px-3 py-2 text-xs">
            <span className="text-text-300">Deposit total</span>
            <span className="font-medium text-text-100">
              {sol(depositTotal)} SOL <span className="text-text-300">+ ~{sol(fees, 6)} fees</span>
            </span>
          </div>
        </div>
        {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
        {result ? (
          <div className="flex flex-col gap-3">
            <AddressBox address={result.from.address} label={`${result.from.label} — send ${result.needSol} SOL here`} />
            <p className="text-[11px] text-text-300">The job waits until this wallet holds {result.needSol} SOL, then sends {result.plan.length} transfer{result.plan.length !== 1 ? "s" : ""}{Number(delay) ? ` ${delay} min apart` : ""}. Stop it from the Activity tab.</p>
            <div className="rounded-md border border-line-100 bg-bg-50 p-3">
              <BxJob jobId={result.jobId} />
            </div>
          </div>
        ) : (
          <button type="button" disabled={!canStart || busy} onClick={start} className="h-9 rounded border border-accent/40 bg-accent/15 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50">
            {busy ? "Creating…" : "Create deposit wallet"}
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
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [delay, setDelay] = useState("0");
  const [viaRelay, setViaRelay] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [group, setGroup] = useState<string>(scopeGroup ?? "");
  const pool = wallets.filter((w) => !w.archived && (group ? w.group === group : true));
  const balOf = (a: string) => Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0;
  const picked = pool.filter((w) => sel.has(w.address));
  const totalSel = picked.reduce((n, w) => n + balOf(w.address), 0);
  const to = mode === "address" ? address.trim() : toWallet;
  const valid = picked.length > 0 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<JobCreated>("/api/fund/consolidate", { sources: picked.map((w) => w.address), to, viaRelay: viaRelay || undefined, delayMinutes: Number(delay) || 0 });
      setJobId(r.jobId);
      toast(`Reverse disperse started on ${picked.length} wallet${picked.length !== 1 ? "s" : ""}`, "info");
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
        {groups.length ? (
          <select value={group} onChange={(e) => { setGroup(e.target.value); setSel(new Set()); }} className="h-9 w-full rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-100 outline-none focus:border-accent" aria-label="Wallets to sweep">
            <option value="">Developer Wallets (all)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="rounded-[10px] border border-line-100">
          <div className="flex items-center justify-between border-b border-line-50 px-3 py-2 text-xs">
            <span className="text-text-300">
              {picked.length}/{pool.length} selected · {sol(totalSel)} SOL
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={() => setSel(new Set(pool.filter((w) => balOf(w.address) > 0).map((w) => w.address)))} className="text-accent hover:underline">
                With balance
              </button>
              <button type="button" onClick={() => setSel(new Set())} className="text-accent hover:underline">
                Clear
              </button>
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {!pool.length ? <p className="px-3 py-4 text-sm text-text-300">No wallets in this section.</p> : null}
            {pool.map((w) => {
              const on = sel.has(w.address);
              const disabled = w.address === to;
              return (
                <label key={w.address} className={cx("flex cursor-pointer items-center gap-2 border-b border-line-50 px-3 py-1.5 text-xs last:border-0", on ? "bg-accent-muted" : "hover:bg-hover-100", disabled ? "opacity-40" : "")}>
                  <input type="checkbox" className="pi-checkbox" checked={on} disabled={disabled} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(w.address)) n.delete(w.address); else n.add(w.address); return n; })} />
                  <span className="min-w-0 flex-1 truncate text-text-100">{w.label || short(w.address)}</span>
                  <span className="font-mono text-[11px] text-text-300">{short(w.address, 4, 4)}</span>
                  <span className="font-mono text-[11px] text-text-200">{sol(balOf(w.address))} SOL</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-text-300">
            Delay (min)
            <input value={delay} onChange={(e) => setDelay(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={cx(field, "w-20 py-1.5")} />
          </label>
          <span className="text-[11px] text-text-300">between wallets (0 = ASAP)</span>
        </div>
        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            <span className="text-text-100">Relay hop</span>
            <span className="block text-[11px] text-text-300">Each wallet empties itself through its own fresh relay wallet.</span>
          </span>
          <BxSwitch checked={viaRelay} onChange={setViaRelay} />
        </label>
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
