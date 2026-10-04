"use client";
/** Block X /sol/launch: left rail (+ new launch, launched tokens), workspace (Chart · Tasks · Token info · Activity), right rail.
 *  ?new=1 opens the Launch Token modal on the draft · ?open=<mint> shows a launched token · ?quick=<presetId> loads a preset and asks to confirm. */
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Rocket } from "lucide-react";
import type { JobCreated, LaunchesResponse, LaunchExecuteRequest, LaunchExecuteResponse, LaunchPrepareResponse, LaunchPreset, PresetsResponse, TokenInfo } from "@/lib/types";
import { claimFees, failureMessage, post, useGet } from "@/lib/api";
import { useBalances, useSettings, useVault, useWallets } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxModal, PadAvatar, cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";
import { LaunchModal } from "@/components/launch/LaunchModal";
import { ActivityPanel, ChartPanel, RightRail, TasksPanel, TokenInfoPanel } from "@/components/launch/Workspace";
import { useLaunchState } from "@/components/launch/LaunchLive";
import { COST, EMPTY_FORM, TASK_META, clearDraft, fromPreset, launchNeeds, loadDraft, presetData, saveDraft, taskSentence, taskWallets, toApiTask, validateForm, type LaunchForm } from "@/components/launch/model";

const noop = () => () => {};

export default function LaunchPage() {
  return (
    <Suspense fallback={null}>
      <LaunchInner />
    </Suspense>
  );
}

function LaunchInner() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const wallets = useWallets();
  if (!hydrated || (wallets.loading && !wallets.data)) return <div className="flex flex-1 items-center justify-center text-xs text-text-300">Loading…</div>;
  return <LaunchScreen initial={loadDraft() ?? { ...EMPTY_FORM, devWallet: wallets.data?.active ?? "" }} />;
}

function LaunchScreen({ initial }: { initial: LaunchForm }) {
  const router = useRouter();
  const params = useSearchParams();
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const settings = useSettings();
  const launches = useGet<LaunchesResponse>("/api/dev/launches", 10000);
  const presetsQ = useGet<PresetsResponse>("/api/presets", 0);
  const [form, setForm] = useState<LaunchForm>(initial);
  const [view, setView] = useState<"empty" | "draft" | string>(params.get("open") ? params.get("open")! : params.get("new") || params.get("quick") ? "draft" : "empty");
  const [modal, setModal] = useState(!!params.get("new"));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [dumpJob, setDumpJob] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickDone = useRef(false);

  const live = (wallets.data?.wallets ?? []).filter((w) => !w.archived);
  const groups = wallets.data?.groups ?? [];
  const canSign = vault.data?.unlocked ?? false;
  const problems = validateForm(form);
  const presets = presetsQ.data?.presets ?? [];
  const viewingMint = view !== "empty" && view !== "draft" ? view : launchId ? (launches.data?.launches.find((l) => l.mint === launchId)?.mint ?? launchId) : null;
  const token = useGet<TokenInfo>(viewingMint ? `/api/token/${viewingMint}` : null, 4000);
  const launchState = useLaunchState(viewingMint);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(form), 400);
  }, [form]);
  // ?quick=<presetId>: load the preset and open the confirmation once presets are known
  useEffect(() => {
    const q = params.get("quick");
    if (!q || quickDone.current || !presetsQ.data) return;
    const p = presetsQ.data.presets.find((x) => x.id === q);
    quickDone.current = true;
    if (!p) return toast("Preset not found — save one from the Tasks panel first", "err");
    setForm((f) => fromPreset(p.data, f));
    setView("draft");
    setConfirm(true);
  }, [params, presetsQ.data]);

  const onPreset = async (action: "load" | "quick" | "save" | "delete", preset?: LaunchPreset, name?: string) => {
    try {
      if (action === "save" && name) {
        await post("/api/presets", { preset: { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, data: presetData(form) } });
        await presetsQ.refresh();
        toast(`Preset “${name}” saved`, "ok");
      } else if (action === "delete" && preset) {
        await post("/api/presets", { remove: preset.id });
        await presetsQ.refresh();
      } else if ((action === "load" || action === "quick") && preset) {
        setForm((f) => fromPreset(preset.data, f));
        if (action === "quick") setConfirm(true);
      }
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };

  const launch = async () => {
    setBusy("launch");
    setLaunchErr(null);
    try {
      const prep = await post<LaunchPrepareResponse>("/api/launch/prepare", {
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        description: form.description.trim() || undefined,
        twitter: form.twitter.trim() || undefined,
        telegram: form.telegram.trim() || undefined,
        website: form.website.trim() || undefined,
        imageDataUrl: form.imageDataUrl,
        vanity: form.vanity.trim() || undefined,
      });
      const body: LaunchExecuteRequest = {
        mint: prep.mint,
        launchpad: "pumpfun",
        devWallet: form.devWallet,
        devBuySol: form.devBuySol || "0",
        quote: "SOL",
        tasks: form.tasks.map(toApiTask),
        sellOnExternalEnabled: form.sellOnExternalEnabled || undefined,
        sellOnExternalThreshold: form.sellOnExternalEnabled ? form.sellOnExternalThreshold : undefined,
        autoDump: form.autoDumpEnabled ? { percent: form.autoDumpPercent, mcUsd: Number(form.autoDumpMcUsd) > 0 ? Number(form.autoDumpMcUsd) : undefined, afterSec: Number(form.autoDumpAfterSec) > 0 ? Number(form.autoDumpAfterSec) : undefined } : undefined,
        slippageBps: form.slippageBps,
        cashback: form.cashback || undefined,
      };
      const r = await post<LaunchExecuteResponse>("/api/launch/execute", body);
      const id = r.id ?? r.mint ?? prep.mint;
      setLaunchId(id);
      setView(id);
      setConfirm(false);
      clearDraft();
      setForm({ ...EMPTY_FORM, devWallet: form.devWallet, tipSol: form.tipSol });
      launches.refresh();
      toast(`Launch sent — ${short(prep.mint, 6, 6)}`, "ok");
    } catch (e) {
      setLaunchErr(failureMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const dumpAll = async () => {
    if (!viewingMint) return;
    if (!confirm_(`Sell 100 % of ${token.data?.symbol ?? short(viewingMint)} on every wallet of this launch?`)) return;
    try {
      const r = await post<JobCreated>("/api/dev/dump", { mint: viewingMint, percent: 100, bundle: settings.data?.jitoEnabled ?? true, slippageBps: settings.data?.slippageBps ?? 2000, tipSol: settings.data?.tipSol });
      setDumpJob(r.jobId);
      toast("Dump sent", "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const claim = async () => {
    if (!viewingMint) return;
    setBusy("claim");
    try {
      const r = await claimFees({ mint: viewingMint });
      toast(r.error ?? `Claimed ${r.totalSol} SOL`, r.error ? "err" : "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const needs = launchNeeds(form, live, balances.data ?? null);
  const needed = needs.reduce((n, r) => n + r.needed, 0);
  const shortRows = needs.filter((r) => r.needed > r.available);
  const bundleWallets = form.tasks.filter((t) => t.type === "bundle").reduce((n, t) => n + taskWallets(t, live).length, 0);
  const dev = live.find((w) => w.address === form.devWallet) ?? null;
  const isDraft = view === "draft";
  const hasDraft = !!(form.name || form.symbol || form.imageDataUrl || form.tasks.length);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* left rail */}
      <div className="shrink-0 overflow-hidden" style={{ width: 56 }}>
        <aside className="launch-sidebar flex h-full shrink-0 flex-col border-r border-line-100 bg-bg-100" style={{ width: 56 }}>
          <div className="flex flex-col gap-0.5 border-b border-line-50 p-2">
            <button
              type="button"
              onClick={() => {
                setView("draft");
                setModal(true);
              }}
              className={cx("flex min-w-0 flex-1 items-center justify-center rounded-md px-1 py-2 text-left text-xs text-accent transition-colors hover:bg-accent-muted/60", isDraft ? "bg-accent-muted/60" : "")}
              aria-label="New launch"
              title={hasDraft ? "Edit the current draft" : "New launch"}
            >
              <span className={cx("flex h-8 w-8 items-center justify-center rounded-full border border-dashed", hasDraft ? "border-accent text-accent" : "border-line-100 text-text-300")}>
                <Plus className="h-3.5 w-3.5" />
              </span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 px-2">
            <div className="flex flex-col gap-1">
              {(launches.data?.launches ?? []).map((l) => (
                <button key={l.mint} type="button" onClick={() => setView(l.mint)} className={cx("flex items-center justify-center rounded-md py-1", view === l.mint ? "bg-accent-muted" : "hover:bg-white/[0.04]")} title={`${l.symbol} — ${l.name}`}>
                  <PadAvatar src={l.image} alt={l.symbol} size={32} />
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-100">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-row-reverse">
            <RightRail canLaunch={isDraft && !problems.length && canSign} onLaunch={() => setConfirm(true)} onClaim={viewingMint ? claim : undefined} claimBusy={busy === "claim"} launched={!!viewingMint} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {view === "empty" ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line-100 text-accent">
                    <Rocket className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-text-100">Create a new launch</p>
                    <p className="mt-0.5 text-xs text-text-300">Token details, developer wallet, then bundle, sniper, buy, volume and wash tasks.</p>
                  </div>
                  <BxButton
                    variant="primary"
                    onClick={() => {
                      setView("draft");
                      setModal(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> New launch
                  </BxButton>
                  {hasDraft ? (
                    <button type="button" onClick={() => setView("draft")} className="text-xs text-accent hover:underline">
                      Continue the saved draft{form.name ? ` “${form.name}”` : ""}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="workspace-grid-canvas no-scrollbar min-h-0 flex-1 overflow-auto bg-bg-100">
                  <div className="workspace-grid-surface flex h-full min-h-[720px] min-w-[1180px] gap-4 p-4">
                    <div className="flex w-[380px] shrink-0 flex-col gap-4">
                      <ChartPanel mint={viewingMint} />
                      {dumpJob ? (
                        <div className="rounded-md border border-line-100 bg-bg-50 p-3">
                          <BxJob jobId={dumpJob} />
                        </div>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <TasksPanel form={form} onChange={setForm} wallets={live} groups={groups} balances={balances.data ?? null} presets={presets} onPreset={onPreset} live={viewingMint ? launchState.state : null} launchId={viewingMint} onDump={viewingMint ? dumpAll : undefined} />
                    </div>
                    <div className="flex w-[400px] shrink-0 flex-col gap-4">
                      <div className="h-[316px] shrink-0">
                        <TokenInfoPanel form={form} token={token.data} mint={viewingMint} onEdit={isDraft ? () => setModal(true) : undefined} />
                      </div>
                      <div className="min-h-0 flex-1">
                        <ActivityPanel mint={viewingMint} live={viewingMint ? launchState.state : null} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <LaunchModal open={modal} onClose={() => setModal(false)} form={form} onChange={setForm} wallets={live} balances={balances.data ?? null} />

      <BxModal open={confirm} onClose={() => !busy && setConfirm(false)} title="Confirm launch" width={560}>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            {form.imageDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL
              <img src={form.imageDataUrl} alt="" className="h-12 w-12 rounded-md border border-line-100 object-cover" />
            ) : null}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-100">
                {form.name} <span className="font-mono text-text-300">{form.symbol}</span>
              </div>
              <div className="text-[11px] text-text-300">
                pump.fun · dev {dev?.label || short(form.devWallet)} · dev buy {form.devBuySol || "0"} SOL · slippage {form.slippageBps / 100}%{form.vanity ? ` · …${form.vanity} address` : ""}
              </div>
            </div>
          </div>
          <ol className="flex flex-col gap-1 text-xs text-text-200">
            <li>
              1. <b className="text-text-100">{dev?.label || "Dev"}</b> creates the token{Number(form.devBuySol) > 0 ? ` and buys ${form.devBuySol} SOL` : ""}
              {bundleWallets ? ` in one Jito bundle with ${bundleWallets} bundle buy${bundleWallets > 1 ? "s" : ""}` : ""}.
            </li>
            {form.tasks.map((t, i) => (
              <li key={t.id}>
                {i + 2}. <b className="text-text-100">{TASK_META[t.type].label}:</b> {taskSentence(t, live)}
                {!t.autoStart ? <span className="text-text-300"> Started by hand.</span> : null}
              </li>
            ))}
            {form.autoDumpEnabled ? (
              <li>
                Auto Dev Sell: {form.autoDumpPercent}%{Number(form.autoDumpMcUsd) > 0 ? ` at $${form.autoDumpMcUsd} MC` : ""}
                {Number(form.autoDumpAfterSec) > 0 ? ` after ${form.autoDumpAfterSec} s` : ""}.
              </li>
            ) : null}
            {form.sellOnExternalEnabled ? <li>Auto Dump once external buys reach {form.sellOnExternalThreshold} SOL.</li> : null}
          </ol>
          <div className="flex flex-col gap-1 rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-xs">
            {needs.map((r) => (
              <div key={r.address} className="flex justify-between gap-3">
                <span className="text-text-300">
                  {r.label} · {r.role}
                </span>
                <span className={cx("font-mono", r.needed > r.available ? "text-decrease" : "text-text-100")}>
                  {sol(r.needed)} of {sol(r.available)} SOL
                </span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line-50 pt-1 font-medium">
              <span className="text-text-100">SOL needed</span>
              <span className={cx("font-mono", shortRows.length ? "text-decrease" : "text-text-100")}>≈ {sol(needed)} SOL</span>
            </div>
            <p className="text-[11px] text-text-300">Includes ~{COST.create} SOL for the create and ~{COST.perBuy} SOL per buy for rent and fees; the server re-checks every balance before sending{shortRows.length ? ` — ${shortRows.length} wallet${shortRows.length > 1 ? "s are" : " is"} short, it will refuse` : ""}.</p>
          </div>
          {launchErr ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{launchErr}</p> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line-50 px-4 py-3">
          <BxButton onClick={() => setConfirm(false)} disabled={!!busy}>
            Back
          </BxButton>
          <BxButton variant="primary" onClick={launch} disabled={busy === "launch" || !!problems.length || !canSign}>
            <Rocket className="h-3.5 w-3.5" /> {busy === "launch" ? "Launching…" : "Launch"}
          </BxButton>
        </div>
      </BxModal>
    </div>
  );
}

function confirm_(msg: string) {
  return typeof window !== "undefined" && window.confirm(msg);
}
