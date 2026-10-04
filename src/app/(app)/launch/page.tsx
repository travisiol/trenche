"use client";
/** Block X /sol/launch: "Launches" sidebar (search, + New launch, CTO, Draft / Launched tabs), workspace
 *  (Chart · Tasks · Token info · Activity), right rail. BEHAVIOUR.md §4.1–4.3.
 *  ?new=1 opens a fresh draft in the Launch Token modal · ?open=<mint> shows a launched token · ?quick=<presetId> replays a preset. */
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Flag, Pencil, Plus, Rocket, Search, Trash2 } from "lucide-react";
import type { CtoListResponse, CtoRecord, CtoResponse, JobCreated, LaunchesResponse, LaunchExecuteResponse, LaunchPrepareResponse, LaunchPreset, LaunchState, PresetsResponse, TokenInfo } from "@/lib/types";
import { claimFees, del, failureMessage, post, useGet } from "@/lib/api";
import { useBalances, useSettings, useVault, useWallets } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxModal, PadAvatar, cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";
import { LaunchModal } from "@/components/launch/LaunchModal";
import { CtoModal } from "@/components/launch/CtoModal";
import { ActivityPanel, ChartPanel, RightRail, TasksPanel, TokenInfoPanel } from "@/components/launch/Workspace";
import { useLaunchState } from "@/components/launch/LaunchLive";
import { deleteDraft, saveDraft, useDrafts, type DraftRow } from "@/components/launch/drafts";
import { listenKeybinds, useKeybinds, type KeybindId } from "@/lib/keybinds";
import { COST, TASK_META, fromApiTask, fromPreset, fromPresetSnapshot, launchNeeds, newForm, presetData, taskSentence, taskWallets, toApiTask, toExecuteRequest, validateForm, type LaunchForm } from "@/components/launch/model";

const noop = () => () => {};
type View = { kind: "empty" } | { kind: "draft"; id: string } | { kind: "mint"; mint: string } | { kind: "cto"; id: string };

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
  const { loaded } = useDrafts();
  if (!hydrated || !loaded || (wallets.loading && !wallets.data)) return <div className="flex flex-1 items-center justify-center text-xs text-text-300">Loading…</div>;
  return <LaunchScreen />;
}

function LaunchScreen() {
  const params = useSearchParams();
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const settings = useSettings();
  const { drafts } = useDrafts();
  const launches = useGet<LaunchesResponse>("/api/dev/launches", 10000);
  const presetsQ = useGet<PresetsResponse>("/api/presets", 0);
  const ctos = useGet<CtoListResponse>("/api/cto", 5000);
  const [view, setView] = useState<View>(() => (params.get("open") ? { kind: "mint", mint: params.get("open")! } : { kind: "empty" }));
  const [form, setForm] = useState<LaunchForm | null>(null);
  const [ctoForm, setCtoForm] = useState<LaunchForm | null>(null);
  const ctoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modal, setModal] = useState(false);
  const [ctoOpen, setCtoOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const [dumpJob, setDumpJob] = useState<string | null>(null);
  const [tab, setTab] = useState<"draft" | "launched">("launched");
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootDone = useRef(false);

  const live = (wallets.data?.wallets ?? []).filter((w) => !w.archived);
  const groups = wallets.data?.groups ?? [];
  const active = wallets.data?.active ?? "";
  const canSign = vault.data?.unlocked ?? false;
  const presets = presetsQ.data?.presets ?? [];
  const cto: CtoRecord | null = view.kind === "cto" ? (ctos.data?.ctos.find((c) => c.id === view.id) ?? null) : null;
  const viewingMint = view.kind === "mint" ? view.mint : (cto?.mint ?? null);
  const isDraft = view.kind === "draft";
  const isCto = view.kind === "cto";
  const token = useGet<TokenInfo>(viewingMint ? `/api/token/${viewingMint}` : null, 4000);
  const launchState = useLaunchState(view.kind === "mint" ? view.mint : null);
  /** CTO task states as a LaunchState for the Tasks panel once the CTO ran (Start / Stop live on the right rail) */
  const ctoLive: LaunchState | null = cto && cto.mint && (cto.status === "running" || cto.status === "stopped" || cto.taskStates.some((t) => t.status !== "pending")) ? { id: cto.id, mint: cto.mint, name: cto.name, symbol: cto.symbol ?? "", dev: "", mode: "plain", status: cto.status === "running" ? "live" : "done", createSignature: null, createConfirmed: true, error: null, steps: [], tasks: cto.taskStates, startedAt: cto.createdAt, sellOnExternal: null, autoDump: cto.autoDump, autoDevSell: null, autoClaim: null } : null;
  const openCto = (c: CtoRecord) => {
    setCtoForm({ ...newForm(active), id: c.id, name: c.name, symbol: c.symbol ?? "", tasks: c.tasks.map(fromApiTask) });
    setView({ kind: "cto", id: c.id });
    setTab("launched");
  };
  const onCtoChange = (f: LaunchForm) => {
    setCtoForm(f);
    if (ctoTimer.current) clearTimeout(ctoTimer.current);
    ctoTimer.current = setTimeout(() => post(`/api/cto/${f.id}`, { tasks: f.tasks.map(toApiTask) }, "PATCH").then(() => ctos.refresh()).catch((e) => toast(failureMessage(e), "err")), 500);
  };
  const ctoAction = async (action: "start" | "stop") => {
    if (!cto) return;
    try {
      await post<CtoResponse>(`/api/cto/${cto.id}/${action}`, {});
      ctos.refresh();
      toast(action === "start" ? `CTO started on ${short(cto.mint, 6, 6)}` : "CTO stopped", action === "start" ? "ok" : "info");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const removeCto = async (c: CtoRecord) => {
    if (!confirm_(`Delete CTO “${c.name}”?`)) return;
    try {
      await del(`/api/cto/${c.id}`);
      if (view.kind === "cto" && view.id === c.id) setView({ kind: "empty" });
      ctos.refresh();
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const problems = form ? validateForm(form) : ["No draft"];

  /** Opens (or creates) a draft in the workspace. */
  const openDraft = (f: LaunchForm, withModal: boolean) => {
    setForm(f);
    setView({ kind: "draft", id: f.id });
    setTab("draft");
    if (withModal) setModal(true);
  };
  const newLaunch = (withModal = true) => {
    const f = newForm(active, settings.data?.autoClaimRewards ?? true);
    saveDraft(f).catch((e) => toast(failureMessage(e), "err"));
    openDraft(f, withModal);
  };

  // ?new=1 / ?quick=<presetId> / ?draft=<id> / ?cto=<id> (search dialog rows) once, after presets / CTOs are known
  useEffect(() => {
    if (bootDone.current) return;
    const quick = params.get("quick");
    const draftId = params.get("draft");
    const ctoId = params.get("cto");
    if (quick && !presetsQ.data) return;
    if (ctoId && !ctos.data) return;
    const t = setTimeout(() => {
      bootDone.current = true;
      if (params.get("new")) newLaunch(true);
      else if (draftId) {
        const d = drafts.find((x) => x.id === draftId);
        if (d) openDraft(d.parsed, false);
        else toast("Draft not found", "err");
      } else if (ctoId) {
        const c = ctos.data?.ctos.find((x) => x.id === ctoId);
        if (c) openCto(c);
        else toast("CTO not found", "err");
      } else if (quick) {
        const p = presetsQ.data?.presets.find((x) => x.id === quick);
        if (!p) return toast("Preset not found — save one from the Tasks panel first", "err");
        const f = fromPresetSnapshot(p.data, newForm(active));
        saveDraft(f).catch(() => {});
        openDraft(f, false);
        setConfirm(true);
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot only
  }, [params, presetsQ.data, ctos.data]);

  // autosave the draft while typing (debounced); ✕ / Escape / Save flush it immediately
  const onFormChange = (f: LaunchForm) => {
    const next = { ...f, updatedAt: Date.now() };
    setForm(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(next).catch((e) => toast(failureMessage(e), "err")), 500);
  };
  const closeModal = () => {
    setModal(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (form) saveDraft(form).catch((e) => toast(failureMessage(e), "err"));
  };

  /** returns the new preset id on "save" so the dialog keeps it selected (Update / Delete / Load act on it right away) */
  const onPreset = async (action: "load" | "quick" | "save" | "update" | "delete", preset?: LaunchPreset, name?: string): Promise<string | void> => {
    if (!form) return;
    try {
      if (action === "save" && name) {
        const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
        await post("/api/presets", { preset: { id, name, data: presetData(form) } });
        await presetsQ.refresh();
        toast(`Preset “${name}” saved`, "ok");
        return id;
      } else if (action === "update" && preset) {
        await post("/api/presets", { preset: { id: preset.id, name: preset.name, createdAt: preset.createdAt, data: presetData(form) } });
        await presetsQ.refresh();
        toast(`Preset “${preset.name}” updated`, "ok");
      } else if (action === "delete" && preset) {
        await post("/api/presets", { remove: preset.id });
        await presetsQ.refresh();
      } else if (action === "load" && preset) {
        onFormChange(fromPreset(preset.data, form));
      } else if (action === "quick" && preset) {
        onFormChange(fromPresetSnapshot(preset.data, form));
        setConfirm(true);
      }
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };

  const launch = async () => {
    if (!form) return;
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
        vanitySuffix: form.mintSecret || form.reservedMint ? undefined : form.vanity.trim() || undefined,
        mint: form.reservedMint || undefined,
        mintSecret: form.mintSecret || undefined,
      });
      const r = await post<LaunchExecuteResponse>("/api/launch/execute", toExecuteRequest(form, prep.mint));
      const id = r.id ?? r.mint ?? prep.mint;
      await deleteDraft(form.id).catch(() => {});
      setForm(null);
      setView({ kind: "mint", mint: id });
      setTab("launched");
      setConfirm(false);
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
  // Settings → Keybinds: Dump All, Dev sell, Buy/Volume task n Start/Pause/Stop on the launch being viewed
  const [kb] = useKeybinds();
  const liveRef = useRef(launchState.state);
  useEffect(() => {
    liveRef.current = launchState.state;
  }, [launchState.state]);
  useEffect(() => {
    if (!viewingMint) return;
    return listenKeybinds(async (id: KeybindId) => {
      const live = liveRef.current;
      if (!live) return toast("No live launch in the workspace", "err");
      try {
        if (id === "dumpAll") return dumpAll();
        if (id === "devSell100" || id === "devSellCustom") {
          const percent = id === "devSell100" ? 100 : kb.customSellPct;
          await post<JobCreated>("/api/trade/sell", { mint: live.mint, wallets: [live.dev], percent });
          return toast(`Selling ${percent}% of the dev wallet`, "info");
        }
        const m = /^(buy|vol)(\d)(Toggle|Stop)$/.exec(id);
        if (!m) return;
        const type = m[1] === "buy" ? "buy" : "volume";
        const task = live.tasks.filter((t) => t.type === type)[Number(m[2]) - 1];
        if (!task) return toast(`No ${type} task ${m[2]} on this launch`, "err");
        const action = m[3] === "Stop" ? "stop" : task.status === "running" ? "pause" : "resume";
        await post(`/api/launch/${live.id}/tasks/${task.id}/${action}`, {});
        toast(`${type} task ${m[2]}: ${action}`, "info");
      } catch (e) {
        toast(failureMessage(e), "err");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dumpAll reads current state
  }, [viewingMint, kb.customSellPct]);

  const removeDraft = async (d: DraftRow) => {
    if (!confirm_(`Delete draft “${d.name || "Untitled"}”?`)) return;
    try {
      await deleteDraft(d.id);
      if (view.kind === "draft" && view.id === d.id) {
        setForm(null);
        setView({ kind: "empty" });
      }
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };

  const needle = q.trim().toLowerCase();
  const draftRows = drafts.filter((d) => !needle || (d.name ?? "").toLowerCase().includes(needle) || (d.symbol ?? "").toLowerCase().includes(needle));
  const ctoRows = (ctos.data?.ctos ?? []).filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.symbol ?? "").toLowerCase().includes(needle) || (c.mint ?? "").toLowerCase().includes(needle));
  const launchRows = (launches.data?.launches ?? []).filter((l) => !needle || l.name.toLowerCase().includes(needle) || l.symbol.toLowerCase().includes(needle) || l.mint.toLowerCase().includes(needle));
  const needs = form ? launchNeeds(form, live, balances.data ?? null) : [];
  const needed = needs.reduce((n, r) => n + r.needed, 0);
  const shortRows = needs.filter((r) => r.needed > r.available);
  const bundleWallets = form ? form.tasks.filter((t) => t.type === "bundle").reduce((n, t) => n + taskWallets(t, live).length, 0) : 0;
  const dev = live.find((w) => w.address === form?.devWallet) ?? null;
  const sidebarW = collapsed ? 56 : 280;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* ------------------------------------------------ Launches sidebar */}
      <div className="shrink-0 overflow-hidden transition-[width] duration-200" style={{ width: sidebarW }}>
        <aside className="launch-sidebar flex h-full flex-col border-r border-line-100 bg-bg-100" style={{ width: sidebarW }} aria-label="Launches">
          <div className={cx("flex h-12 shrink-0 items-center border-b border-line-50", collapsed ? "justify-center px-2" : "justify-between px-3")}>
            {!collapsed ? <h2 className="text-sm font-medium text-text-100">Launches</h2> : null}
            <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex h-6 w-6 items-center justify-center rounded text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100" aria-label={collapsed ? "Expand sidebar" : "Minimize sidebar"} title={collapsed ? "Expand sidebar" : "Minimize sidebar"}>
              {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
            </button>
          </div>
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 p-2">
              <button type="button" onClick={() => newLaunch(true)} className="flex h-8 w-8 items-center justify-center rounded-md text-accent hover:bg-accent-muted/60" aria-label="New launch" title="New launch">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setCtoOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-md text-text-300 hover:bg-white/[0.04] hover:text-text-100" aria-label="CTO" title="CTO an existing token">
                <Flag className="h-4 w-4" />
              </button>
              <div className="my-1 h-px w-6 bg-line-50" />
              {drafts.map((d) => (
                <button key={d.id} type="button" onClick={() => openDraft(d.parsed, false)} className={cx("flex h-9 w-9 items-center justify-center rounded-md", view.kind === "draft" && view.id === d.id ? "bg-accent-muted" : "hover:bg-white/[0.04]")} title={d.name || "Untitled"}>
                  <DraftAvatar d={d} size={28} />
                </button>
              ))}
              {launchRows.map((l) => (
                <button key={l.mint} type="button" onClick={() => setView({ kind: "mint", mint: l.mint })} className={cx("flex h-9 w-9 items-center justify-center rounded-md", viewingMint === l.mint ? "bg-accent-muted" : "hover:bg-white/[0.04]")} title={`${l.symbol} — ${l.name}`}>
                  <PadAvatar src={l.image} alt={l.symbol} size={28} />
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="px-3 pt-3">
                <div className="flex h-8 items-center gap-2 rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-300">
                  <Search className="h-3 w-3 shrink-0" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." className="w-full bg-transparent outline-none placeholder:text-text-300" />
                </div>
              </div>
              <div className="flex items-center justify-between px-3 pt-4">
                <button type="button" onClick={() => newLaunch(true)} className="inline-flex h-7 items-center gap-2 rounded-md px-2 text-xs font-medium text-accent transition-colors hover:bg-accent-muted/60" title="New launch">
                  <Plus className="h-3.5 w-3.5" />
                  New launch
                </button>
                <button type="button" onClick={() => setCtoOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-text-200 transition-colors hover:bg-white/[0.04] hover:text-text-100" title="CTO an existing token">
                  <Flag className="h-3.5 w-3.5 text-text-300" />
                  CTO
                </button>
              </div>
              <div className="mt-4 flex border-b border-line-50 px-3">
                {(["draft", "launched"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)} className={cx("-mb-px flex-1 border-b-2 py-2 text-xs font-medium capitalize transition-colors", tab === t ? "border-accent text-text-100" : "border-transparent text-text-300 hover:text-text-100")}>
                    {t === "draft" ? `Draft${drafts.length ? ` (${drafts.length})` : ""}` : "Launched"}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {tab === "draft" ? (
                  !draftRows.length ? (
                    <p className="px-2 py-16 text-center text-xs text-text-300">{needle ? "No draft matches." : "No drafts yet."}</p>
                  ) : (
                    draftRows.map((d) => {
                      const on = view.kind === "draft" && view.id === d.id;
                      return (
                        <div key={d.id} className={cx("group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors", on ? "bg-accent-muted" : "hover:bg-white/[0.04]")}>
                          <button type="button" onClick={() => openDraft(d.parsed, false)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                            <DraftAvatar d={d} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-text-100">{d.name || "Untitled"}</span>
                              <span className="block truncate text-[11px] text-text-300">{d.symbol || "No name yet"}</span>
                            </span>
                          </button>
                          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button type="button" onClick={() => openDraft(d.parsed, true)} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-white/[0.06] hover:text-text-100" aria-label="Edit draft" title="Edit draft">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => removeDraft(d)} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-white/[0.06] hover:text-decrease" aria-label="Delete draft" title="Delete draft">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        </div>
                      );
                    })
                  )
                ) : launches.error ? (
                  <p className="px-2 py-16 text-center text-xs text-decrease">{failureMessage(launches.error)}</p>
                ) : !launchRows.length && !ctoRows.length ? (
                  <p className="px-2 py-16 text-center text-xs text-text-300">{needle ? "No launched token matches." : "No launched tokens yet."}</p>
                ) : (
                  [...ctoRows.map((c) => (
                    <div key={c.id} className={cx("group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors", view.kind === "cto" && view.id === c.id ? "bg-accent-muted" : "hover:bg-white/[0.04]")}>
                      <button type="button" onClick={() => openCto(c)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={c.mint ?? `watching ${c.devWallet}`}>
                        <span className="relative shrink-0">
                          <PadAvatar src={c.image} alt={c.symbol ?? c.name} size={32} />
                          <Flag className="absolute -left-1 -top-1 h-3 w-3 text-accent" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text-100">{c.symbol ?? c.name}</span>
                          <span className="block truncate text-[11px] text-text-300">{c.mint ? short(c.mint, 6, 6) : "No mint yet — watching dev"}</span>
                        </span>
                      </button>
                      <span className={cx("shrink-0 text-[10px]", c.status === "running" ? "text-green-100" : c.status === "expired" ? "text-decrease" : "text-text-300")}>{c.status}</span>
                      <button type="button" onClick={() => removeCto(c)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-300 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-decrease group-hover:opacity-100" aria-label="Delete CTO" title="Delete CTO">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )),
                  ...launchRows.map((l) => (
                    <button key={l.mint} type="button" onClick={() => setView({ kind: "mint", mint: l.mint })} className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors", viewingMint === l.mint ? "bg-accent-muted" : "hover:bg-white/[0.04]")} title={l.mint}>
                      <PadAvatar src={l.image} alt={l.symbol} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text-100">{l.symbol}</span>
                        <span className="block truncate text-[11px] text-text-300">{l.name}</span>
                      </span>
                      <span className={cx("shrink-0 text-[10px]", l.createConfirmed ? "text-green-100" : l.createError ? "text-decrease" : "text-text-300")}>{l.createConfirmed ? "live" : l.createError ? "failed" : "pending"}</span>
                    </button>
                  ))]
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-100">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-row-reverse">
            {isCto ? (
              <RightRail canLaunch={!!cto?.mint && cto.status !== "running" && canSign && !!cto.tasks.length} onLaunch={() => ctoAction("start")} launched={false} launchLabel="Start" launchTitle={!cto?.mint ? "The token is not created yet — the CTO is watching the dev wallet" : !cto.tasks.length ? "Add a task first" : !canSign ? "Unlock the vault first" : cto.status === "running" ? "Already running" : "Run the tasks now"} onStop={cto?.status === "running" ? () => ctoAction("stop") : undefined} />
            ) : (
              <RightRail canLaunch={isDraft && !problems.length && canSign} onLaunch={() => setConfirm(true)} onClaim={viewingMint ? claim : undefined} claimBusy={busy === "claim"} launched={!!viewingMint} launchTitle={!isDraft ? undefined : !form?.devWallet ? "Select a developer wallet first" : problems[0] ?? (!canSign ? "Unlock the vault first" : undefined)} />
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {view.kind === "empty" || (isDraft && !form) || (isCto && !cto) ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line-100 bg-bg-50 text-text-100">
                    <Plus className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-text-100">Create a new launch</p>
                    <p className="mt-0.5 text-xs text-text-300">Or choose one from your list in the sidebar..</p>
                  </div>
                  <BxButton variant="primary" onClick={() => newLaunch(true)}>
                    <Plus className="h-3.5 w-3.5" /> New launch
                  </BxButton>
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
                      {isCto ? (
                        <TasksPanel form={ctoForm ?? newForm(active)} onChange={onCtoChange} wallets={live} groups={groups} balances={balances.data ?? null} presets={presets} onPreset={onPreset} live={ctoLive} launchId={null} onDump={viewingMint ? dumpAll : undefined} taskControls={false} />
                      ) : (
                        <TasksPanel form={form ?? newForm(active)} onChange={onFormChange} wallets={live} groups={groups} balances={balances.data ?? null} presets={presets} onPreset={onPreset} live={viewingMint ? launchState.state : null} launchId={viewingMint} onDump={viewingMint ? dumpAll : undefined} />
                      )}
                    </div>
                    <div className="flex w-[400px] shrink-0 flex-col gap-4">
                      <div className="h-[316px] shrink-0">
                        <TokenInfoPanel form={isCto ? (ctoForm ?? newForm(active)) : (form ?? newForm(active))} token={token.data} mint={viewingMint} onEdit={isDraft ? () => setModal(true) : undefined} />
                      </div>
                      <div className="min-h-0 flex-1">
                        <ActivityPanel mint={viewingMint} live={isCto ? ctoLive : viewingMint ? launchState.state : null} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {form ? <LaunchModal open={modal} onClose={closeModal} form={form} onChange={onFormChange} wallets={live} balances={balances.data ?? null} /> : null}
      <CtoModal
        open={ctoOpen}
        onClose={() => setCtoOpen(false)}
        presets={presets}
        onCreated={(r) => {
          const c = r.cto;
          openCto(c);
          ctos.refresh();
          toast(c.mint ? `CTO ${c.name || short(c.mint, 6, 6)} created — workspace opened` : `CTO ${c.name || c.id} is watching ${short(c.devWallet, 6, 6)} for 1 hour`, c.mint ? "ok" : "info");
        }}
      />

      <BxModal open={confirm && !!form} onClose={() => !busy && setConfirm(false)} title="Confirm launch" width={560}>
        {form ? (
          <>
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
                    pump.fun · dev {dev?.label || short(form.devWallet)} · buy {form.devBuySol || "0"} SOL · slippage {form.slippageBps / 100}%{form.mintSecret ? ` · mint ${short(form.mintAddress, 6, 6)}` : form.vanity ? ` · …${form.vanity} address` : ""}
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
                    {!t.autoStart && (t.type === "buy" || t.type === "volume" || t.type === "wash") ? <span className="text-text-300"> Started by hand.</span> : null}
                  </li>
                ))}
                {form.autoDevSellEnabled ? <li>Auto Dev Sell: 100 % of the dev wallet {form.autoDevSellMode === "ms" ? `${form.autoDevSellValue} ms after the token goes live` : `at $${form.autoDevSellValue} market cap`}.</li> : null}
                {form.sellOnExternalEnabled ? <li>Auto Dump once net external volume reaches {form.sellOnExternalThreshold} SOL.</li> : null}
                {form.autoClaimEnabled ? (
                  <li>
                    Auto-claim: the creator fees go to <b className="text-text-100">{dev?.label || "the dev wallet"}</b> by themselves once the vault holds ≥ {form.autoClaimMinSol || "0.01"} SOL (checked every {form.autoClaimIntervalSec || "300"} s).
                  </li>
                ) : null}
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
          </>
        ) : null}
      </BxModal>
    </div>
  );
}

function DraftAvatar({ d, size }: { d: DraftRow; size: number }) {
  return (
    <span className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-100 bg-bg-50 text-[11px] font-semibold text-text-300" style={{ width: size, height: size }}>
      {d.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data URL
        <img src={d.image} alt="" className="h-full w-full object-cover" />
      ) : (
        "??"
      )}
    </span>
  );
}

function confirm_(msg: string) {
  return typeof window !== "undefined" && window.confirm(msg);
}
