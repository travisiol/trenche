"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon3D } from "@/components/Icon3D";
import { Button, Field, Input, InlineError, Modal, Panel, Select, Spinner, Textarea, Toggle, cx, toast } from "@/components/ui";
import { ImagePicker, UrlInput, urlToDataUrl } from "@/components/launch/ImageCrop";
import { AddTaskMenu, TaskCard } from "@/components/launch/TaskEditor";
import { LaunchLive } from "@/components/launch/LaunchLive";
import { EMPTY_FORM, TASK_META, clearDraft, fromPreset, loadDraft, newTask, presetData, saveDraft, toApiTask, validateForm, type LaunchForm } from "@/components/launch/model";
import { useBalances, useVault, useWallets } from "@/lib/store";
import { failureMessage, get, post, useGet } from "@/lib/api";
import { isMint, short, sol } from "@/lib/format";
import type { LaunchExecuteRequest, LaunchExecuteResponse, LaunchPrepareResponse, LaunchPreset, LaunchTaskType, PresetsResponse, TokenInfo } from "@/lib/ui-types";

const noop = () => () => {};
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

export default function LaunchPage() {
  const hydrated = useHydrated();
  const wallets = useWallets();
  if (!hydrated || (wallets.loading && !wallets.data)) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-3">
        <Spinner />
      </div>
    );
  }
  return <LaunchEditor initial={loadDraft() ?? { ...EMPTY_FORM, devWallet: wallets.data?.active ?? "" }} />;
}

function LaunchEditor({ initial }: { initial: LaunchForm }) {
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const [form, setForm] = useState<LaunchForm>(initial);
  const [clone, setClone] = useState("");
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneErr, setCloneErr] = useState<string | null>(null);
  const [summary, setSummary] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const presetsQ = useGet<PresetsResponse>("/api/presets", 0);
  const presets: LaunchPreset[] | null = presetsQ.data?.presets ?? null;
  const presetsErr = presetsQ.error ? failureMessage(presetsQ.error) : null;
  const loadPresets = presetsQ.refresh;
  const [presetName, setPresetName] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const live = (wallets.data?.wallets ?? []).filter((w) => !w.archived);
  const groups = wallets.data?.groups ?? [];
  const canSign = vault.data?.unlocked ?? false;
  const problems = validateForm(form);
  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // debounced autosave of the draft
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(form), 400);
  }, [form]);

  const doClone = async () => {
    if (!isMint(clone)) return setCloneErr("Paste a valid mint address.");
    setCloneBusy(true);
    setCloneErr(null);
    try {
      const t = await get<TokenInfo>(`/api/token/${clone.trim()}`);
      let img = form.imageDataUrl;
      if (t.image) {
        try {
          img = await urlToDataUrl(t.image);
        } catch {
          setCloneErr("Metadata copied; the image host blocked the download — upload the picture by hand.");
        }
      }
      setForm((f) => ({ ...f, name: t.name ?? f.name, symbol: t.symbol ?? f.symbol, description: t.description ?? f.description, twitter: t.twitter ?? "", telegram: t.telegram ?? "", website: t.website ?? "", imageDataUrl: img }));
      toast(`Cloned ${t.symbol ?? short(clone)}`, "ok");
    } catch (e) {
      setCloneErr(failureMessage(e));
    } finally {
      setCloneBusy(false);
    }
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    setBusy("preset");
    try {
      await post("/api/presets", { preset: { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, data: presetData(form) } });
      setPresetName("");
      await loadPresets();
      toast(`Preset "${name}" saved`, "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
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
      setLaunchId(r.id ?? r.mint ?? prep.mint);
      setSummary(false);
      clearDraft();
      toast(`Launch sent — ${short(prep.mint, 6, 6)}`, "ok");
    } catch (e) {
      setLaunchErr(failureMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const taskCount = form.tasks.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] ?? 0) + 1 }), {} as Record<LaunchTaskType, number>);
  const bundleWallets = form.tasks.filter((t) => t.type === "bundle").reduce((n, t) => n + t.walletIds.length, 0);
  const devBal = Number(balances.data?.[form.devWallet] ?? live.find((w) => w.address === form.devWallet)?.sol ?? 0);

  if (launchId) {
    return (
      <div className="flex-1 p-4 max-w-4xl w-full mx-auto">
        <Panel glow title="Launch in progress" icon={<Icon3D name="launch" size={22} />} bodyClassName="p-5">
          <LaunchLive
            id={launchId}
            onReset={() => {
              setLaunchId(null);
              setForm({ ...EMPTY_FORM, devWallet: form.devWallet, tasks: [] });
            }}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-4 p-4 min-h-0">
      {/* ------------------------------------------------ left: token */}
      <div className="flex flex-col gap-4 min-w-0">
        <Panel glow bodyClassName="p-5 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Icon3D name="pumpfun" size={34} />
            <div>
              <div className="text-[15px] font-semibold tracking-tight">Token metadata</div>
              <div className="text-[11px] text-text-3">Launchpad: pump.fun · Solana · quote SOL</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Input value={clone} onChange={(e) => setClone(e.target.value)} placeholder="Clone: paste a mint" mono className="w-64 text-xs" onKeyDown={(e) => e.key === "Enter" && doClone()} />
              <Button size="md" busy={cloneBusy} onClick={doClone} disabled={!clone}>
                Clone
              </Button>
            </div>
          </div>
          {cloneErr ? <InlineError>{cloneErr}</InlineError> : null}
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Token name" maxLength={32} />
            </Field>
            <Field label="Symbol">
              <Input value={form.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="TICKER" maxLength={10} mono />
            </Field>
          </div>
          <Field label="Description">
            <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What is it?" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="X / Twitter">
              <Input value={form.twitter} onChange={(e) => set("twitter", e.target.value)} placeholder="https://x.com/…" />
            </Field>
            <Field label="Telegram">
              <Input value={form.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="https://t.me/…" />
            </Field>
            <Field label="Website">
              <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Image">
            <div className="flex flex-col gap-3">
              <ImagePicker value={form.imageDataUrl} onChange={(d) => set("imageDataUrl", d)} />
              <UrlInput onLoad={(d) => set("imageDataUrl", d)} />
            </div>
          </Field>
        </Panel>

        <Panel title="Dev wallet" icon={<Icon3D name="portfolio" size={22} />} bodyClassName="p-5 grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_1fr_1fr] gap-4 items-end">
          <Field label="Wallet" hint={form.devWallet ? `${sol(devBal)} SOL available` : undefined}>
            <Select value={form.devWallet} onChange={(e) => set("devWallet", e.target.value)}>
              <option value="">Choose the creator wallet</option>
              {live.map((w) => (
                <option key={w.address} value={w.address}>
                  {w.label || short(w.address)} — {sol(balances.data?.[w.address] ?? w.sol)} SOL
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dev buy">
            <Input type="number" step="0.01" min={0} value={form.devBuySol} onChange={(e) => set("devBuySol", e.target.value)} mono suffix="SOL" />
          </Field>
          <Field label="Slippage">
            <Input type="number" min={0} max={100} value={form.slippageBps / 100} onChange={(e) => set("slippageBps", Math.round(Number(e.target.value) * 100))} mono suffix="%" />
          </Field>
          <Field label="Vanity suffix" hint="optional, slow">
            <Input value={form.vanity} onChange={(e) => set("vanity", e.target.value)} placeholder="pump" mono maxLength={5} />
          </Field>
          <div className="sm:col-span-4">
            <Toggle checked={form.cashback} onChange={(v) => set("cashback", v)} label="Cashback coin (pump.fun creator cashback flag)" />
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------ right: options */}
      <div className="flex flex-col gap-4 min-w-0">
        <Panel
          title="Options"
          icon={<Icon3D name="bundle" size={22} />}
          actions={<span className="mono text-[11px] text-text-3">{form.tasks.length} task{form.tasks.length !== 1 ? "s" : ""}</span>}
          bodyClassName="p-3 flex flex-col gap-3"
        >
          <AddTaskMenu count={taskCount} onAdd={(t) => set("tasks", [...form.tasks, newTask(t)])} />
          {!form.tasks.length ? <p className="text-[11px] text-text-3 px-1">No task — the dev wallet alone creates and buys. Add a Bundle to buy inside the create bundle, a Sniper to buy on confirmation, Buy or Volume to keep trading after launch, Wash to move tokens to fresh wallets.</p> : null}
          {form.tasks.map((t) => (
            <TaskCard key={t.id} task={t} wallets={live} groups={groups} balances={balances.data ?? null} onChange={(nt) => set("tasks", form.tasks.map((x) => (x.id === t.id ? nt : x)))} onRemove={() => set("tasks", form.tasks.filter((x) => x.id !== t.id))} />
          ))}
          {bundleWallets > 4 ? <InlineError>Jito accepts 5 transactions per bundle: the create plus 4 buys. Move the extra wallets to a Sniper task.</InlineError> : null}

          <div className="card p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Icon3D name="autodump" size={22} />
              <span className="text-xs font-semibold">Auto-dump</span>
              <span className="ml-auto">
                <Toggle checked={form.autoDumpEnabled} onChange={(v) => set("autoDumpEnabled", v)} color="auto" />
              </span>
            </div>
            {form.autoDumpEnabled ? (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Sell">
                  <Input type="number" min={1} max={100} value={form.autoDumpPercent} onChange={(e) => set("autoDumpPercent", Number(e.target.value))} mono suffix="%" />
                </Field>
                <Field label="When MC ≥">
                  <Input type="number" min={0} value={form.autoDumpMcUsd} onChange={(e) => set("autoDumpMcUsd", e.target.value)} mono suffix="USD" placeholder="—" />
                </Field>
                <Field label="Or after">
                  <Input type="number" min={0} value={form.autoDumpAfterSec} onChange={(e) => set("autoDumpAfterSec", e.target.value)} mono suffix="s" placeholder="—" />
                </Field>
              </div>
            ) : null}
            <div className="flex items-center gap-2 pt-2 border-t border-line">
              <span className="text-xs font-medium">Sell on external volume</span>
              <span className="ml-auto flex items-center gap-2">
                {form.sellOnExternalEnabled ? <Input type="number" min={0} step="0.5" value={form.sellOnExternalThreshold} onChange={(e) => set("sellOnExternalThreshold", e.target.value)} mono suffix="SOL" className="w-28 h-7 text-xs" /> : null}
                <Toggle checked={form.sellOnExternalEnabled} onChange={(v) => set("sellOnExternalEnabled", v)} color="auto" />
              </span>
            </div>
            <p className="text-[11px] text-text-3">Dumps every launch wallet once buys from wallets that are not yours reach the threshold.</p>
          </div>
        </Panel>

        <Panel title="Presets" bodyClassName="p-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current setup as…" className="text-xs" onKeyDown={(e) => e.key === "Enter" && savePreset()} />
            <Button size="md" busy={busy === "preset"} disabled={!presetName.trim()} onClick={savePreset}>
              Save
            </Button>
          </div>
          {presetsErr ? <p className="text-[11px] text-warn">{presetsErr}</p> : null}
          {presets && !presets.length ? <p className="text-[11px] text-text-3">No preset yet. A preset keeps everything except the image.</p> : null}
          {presets?.map((p) => (
            <div key={p.id} className="flex items-center gap-2 h-9 px-2 rounded-lg bg-card border border-line text-xs">
              <span className="font-medium truncate">{p.name}</span>
              <span className="ml-auto flex gap-1">
                <Button size="xs" onClick={() => setForm((f) => fromPreset(p.data, f))}>
                  Load
                </Button>
                <Button
                  size="xs"
                  variant="primary"
                  disabled={!canSign}
                  onClick={() => {
                    setForm((f) => fromPreset(p.data, f));
                    setSummary(true);
                  }}
                  title="Load and open the launch summary"
                >
                  Quick launch
                </Button>
                <Button size="xs" variant="ghost" className="text-text-3" onClick={() => post("/api/presets", { remove: p.id }).then(loadPresets).catch((e) => toast(failureMessage(e), "err"))}>
                  ×
                </Button>
              </span>
            </div>
          ))}
        </Panel>

        <div className="glow-frame p-4 flex flex-col gap-3 sticky bottom-4">
          {problems.length ? (
            <ul className="text-[11px] text-text-3 flex flex-col gap-0.5">
              {problems.slice(0, 4).map((p) => (
                <li key={p}>· {p}</li>
              ))}
              {problems.length > 4 ? <li>· and {problems.length - 4} more</li> : null}
            </ul>
          ) : (
            <p className="text-[11px] text-text-3">Ready. The summary shows every wallet and amount before anything is signed.</p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setForm({ ...EMPTY_FORM, devWallet: form.devWallet }); clearDraft(); }}>
              Clear
            </Button>
            <Button variant="primary" size="lg" className="flex-1" disabled={!!problems.length || !canSign} onClick={() => setSummary(true)} title={!canSign ? "Unlock the vault first" : undefined}>
              <Icon3D name="launch" size={20} /> LAUNCH
            </Button>
          </div>
          <p className="text-[11px] text-text-3 text-center">Draft autosaves on this machine.</p>
        </div>
      </div>

      <Modal open={summary} onClose={() => !busy && setSummary(false)} title="Launch summary" width={560}>
        <div className="flex items-center gap-3">
          {form.imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL
            <img src={form.imageDataUrl} alt="" className="w-14 h-14 rounded-xl border border-line object-cover" />
          ) : null}
          <div>
            <div className="font-semibold">{form.name} <span className="text-text-3">{form.symbol}</span></div>
            <div className="text-[11px] text-text-3">pump.fun · dev {live.find((w) => w.address === form.devWallet)?.label || short(form.devWallet)} · dev buy {form.devBuySol || "0"} SOL · slippage {form.slippageBps / 100} %{form.vanity ? ` · vanity …${form.vanity}` : ""}</div>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5">
          {form.tasks.map((t) => {
            const addrs = Array.from(new Set([...t.walletIds, ...live.filter((w) => t.walletGroupIds.includes(w.group ?? "")).map((w) => w.address)]));
            const total = t.type === "bundle" || t.type === "sniper" ? addrs.reduce((n, a) => n + Number(t.walletBuyAmounts[a] ?? t.buyAmount), 0) : null;
            return (
              <li key={t.id} className="card px-3 py-2 text-xs flex items-center gap-2">
                <Icon3D name={TASK_META[t.type].icon} size={18} />
                <span className="font-medium">{TASK_META[t.type].label}</span>
                <span className="text-text-3">
                  {addrs.length} wallet{addrs.length !== 1 ? "s" : ""}
                  {total !== null ? ` · ${sol(total)} SOL total` : ` · ${t.minTradeAmount}–${t.maxTradeAmount} SOL every ${t.minIntervalSec}–${t.maxIntervalSec}s · ${t.tradeMode}`}
                  {t.type === "bundle" ? ` · tip ${t.tip}` : ""}
                </span>
                <span className={cx("ml-auto text-[10px]", t.autoStart ? "text-up" : "text-text-3")}>{t.autoStart ? "auto start" : "manual"}</span>
              </li>
            );
          })}
          {form.autoDumpEnabled ? <li className="text-[11px] text-auto">Auto-dump {form.autoDumpPercent} %{form.autoDumpMcUsd ? ` at $${form.autoDumpMcUsd}` : ""}{form.autoDumpAfterSec ? ` after ${form.autoDumpAfterSec}s` : ""}</li> : null}
          {form.sellOnExternalEnabled ? <li className="text-[11px] text-auto">Sell on external volume ≥ {form.sellOnExternalThreshold} SOL</li> : null}
        </ul>
        <p className="text-[11px] text-text-3">Create + dev buy{bundleWallets ? ` + ${bundleWallets} bundle buys go out as one Jito bundle` : " go out as one transaction"}. Real SOL leaves your wallets.</p>
        <InlineError>{launchErr}</InlineError>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSummary(false)} disabled={!!busy}>
            Back
          </Button>
          <Button variant="primary" size="lg" busy={busy === "launch"} onClick={launch}>
            Confirm launch
          </Button>
        </div>
      </Modal>
    </div>
  );
}
