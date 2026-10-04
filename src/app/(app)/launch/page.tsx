"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon3D } from "@/components/Icon3D";
import { Icon } from "@/components/icons";
import { Button, Card, CostLine, Field, Input, InlineError, Modal, Note, Page, PageHeader, Popover, Select, Spinner, StepNumber, Textarea, Toggle, cx, toast } from "@/components/ui";
import { ImagePicker, UrlInput, urlToDataUrl } from "@/components/launch/ImageCrop";
import { AddTaskMenu, TaskCard } from "@/components/launch/TaskEditor";
import { LaunchLive } from "@/components/launch/LaunchLive";
import { COST, EMPTY_FORM, TASK_META, clearDraft, fromPreset, launchNeeds, loadDraft, newTask, presetData, saveDraft, taskSentence, taskWallets, toApiTask, validateForm, type LaunchForm } from "@/components/launch/model";
import { useBalances, useVault, useWallets } from "@/lib/store";
import { failureMessage, get, post, useGet } from "@/lib/api";
import { isMint, short, sol } from "@/lib/format";
import type { LaunchExecuteRequest, LaunchExecuteResponse, LaunchPrepareResponse, LaunchPreset, LaunchTaskType, PresetsResponse, TokenInfo } from "@/lib/types";

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
  const bundleWallets = form.tasks.filter((t) => t.type === "bundle").reduce((n, t) => n + taskWallets(t, live).length, 0);
  const devWallet = live.find((w) => w.address === form.devWallet) ?? null;
  const devBal = Number(balances.data?.[form.devWallet] ?? devWallet?.sol ?? 0);
  const needs = launchNeeds(form, live, balances.data ?? null);
  const needed = needs.reduce((n, r) => n + r.needed, 0);
  const available = needs.reduce((n, r) => n + r.available, 0);
  const shortRows = needs.filter((r) => r.needed > r.available);
  const stepDone = [!!form.name.trim() && !!form.symbol.trim() && !!form.imageDataUrl, !!form.devWallet && Number(form.devBuySol) >= 0, form.tasks.length > 0 && form.tasks.every((t) => !validateFormTask(t, form)), problems.length === 0];

  if (launchId) {
    return (
      <Page className="max-w-5xl">
        <PageHeader icon={<Icon3D name="launch" size={40} glow />} title="Launch in progress" description="Live from the server: create, buys, tasks and every signature." />
        <Card glow>
          <LaunchLive
            id={launchId}
            onReset={() => {
              setLaunchId(null);
              setForm({ ...EMPTY_FORM, devWallet: form.devWallet, tasks: [] });
            }}
          />
        </Card>
      </Page>
    );
  }

  const presetMenu = (
    <Popover
      width={320}
      trigger={(open) => (
        <Button icon="grid" className={open ? "border-accent" : ""}>
          Presets {presets?.length ? <span className="mono text-text-3">{presets.length}</span> : null}
        </Button>
      )}
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-sm font-semibold">Presets</div>
          <p className="hint">A preset keeps everything on this page except the image.</p>
        </div>
        <div className="flex gap-2">
          <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current setup as…" className="text-[13px] h-9" onKeyDown={(e) => e.key === "Enter" && savePreset()} />
          <Button size="sm" className="h-9" busy={busy === "preset"} disabled={!presetName.trim()} onClick={savePreset}>
            Save
          </Button>
        </div>
        {presetsErr ? <p className="text-[13px] text-warn">{presetsErr}</p> : null}
        {presets && !presets.length ? <p className="hint">No preset yet.</p> : null}
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {presets?.map((p) => (
            <div key={p.id} className="flex items-center gap-2 min-h-10 px-2 rounded-lg bg-card border border-line text-sm">
              <span className="font-medium truncate flex-1">{p.name}</span>
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
              <button className="w-7 h-7 rounded-md text-text-3 hover:text-down hover:bg-white/5 flex items-center justify-center" onClick={() => post("/api/presets", { remove: p.id }).then(loadPresets).catch((e) => toast(failureMessage(e), "err"))} aria-label={`Delete preset ${p.name}`}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );

  return (
    <Page>
      <PageHeader
        icon={<Icon3D name="launch" size={40} glow />}
        title="Launch"
        description="Create a pump.fun token and run buys, snipes and volume around it — four steps, then one confirmation."
        actions={
          <>
            {presetMenu}
            <Button
              variant="ghost"
              icon="trash"
              onClick={() => {
                setForm({ ...EMPTY_FORM, devWallet: form.devWallet });
                clearDraft();
              }}
            >
              Clear
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-4 items-start">
        {/* ------------------------------------------------ steps */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* 1 — token */}
          <Card
            glow
            icon={<StepNumber n={1} done={stepDone[0]} />}
            title="Token"
            description="Name, symbol, picture and links — what pump.fun shows. Or clone an existing token's metadata."
            actions={
              <div className="flex gap-2 w-full sm:w-auto">
                <Input value={clone} onChange={(e) => setClone(e.target.value)} placeholder="Clone: paste a mint address" mono className="w-full sm:w-72 text-[13px]" onKeyDown={(e) => e.key === "Enter" && doClone()} aria-label="Mint to clone" />
                <Button busy={cloneBusy} onClick={doClone} disabled={!clone} icon="copy">
                  Clone
                </Button>
              </div>
            }
            bodyClassName="gap-4"
          >
            {cloneErr ? <InlineError>{cloneErr}</InlineError> : null}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4">
              <div className="flex flex-col gap-4 min-w-0">
                <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4">
                  <Field label="Name">
                    <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Token name" maxLength={32} />
                  </Field>
                  <Field label="Symbol" hint="Up to 10 characters.">
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
              </div>
              <Field label="Picture" hint="Square, 512 px, cropped here.">
                <div className="flex flex-col gap-3">
                  <ImagePicker value={form.imageDataUrl} onChange={(d) => set("imageDataUrl", d)} />
                  <UrlInput onLoad={(d) => set("imageDataUrl", d)} />
                </div>
              </Field>
            </div>
          </Card>

          {/* 2 — dev wallet */}
          <Card icon={<StepNumber n={2} done={stepDone[1]} />} title="Dev wallet" description="The wallet that creates the token and makes the first buy. It pays the create fee." bodyClassName="gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_1fr] gap-4">
              <Field label="Wallet" hint={form.devWallet ? `${sol(devBal)} SOL available` : "Pick the creator wallet."}>
                <Select value={form.devWallet} onChange={(e) => set("devWallet", e.target.value)}>
                  <option value="">Choose the creator wallet</option>
                  {live.map((w) => (
                    <option key={w.address} value={w.address}>
                      {w.label || short(w.address)} — {sol(balances.data?.[w.address] ?? w.sol)} SOL
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Dev buy" hint="Bought in the create transaction.">
                <Input type="number" step="0.01" min={0} value={form.devBuySol} onChange={(e) => set("devBuySol", e.target.value)} mono suffix="SOL" />
              </Field>
              <Field label="Slippage">
                <Input type="number" min={0} max={100} value={form.slippageBps / 100} onChange={(e) => set("slippageBps", Math.round(Number(e.target.value) * 100))} mono suffix="%" />
              </Field>
              <Field label="Vanity suffix" hint="Optional; mint ends with it. Slow.">
                <Input value={form.vanity} onChange={(e) => set("vanity", e.target.value)} placeholder="pump" mono maxLength={5} />
              </Field>
            </div>
            <Toggle checked={form.cashback} onChange={(v) => set("cashback", v)} label="Cashback coin — sets pump.fun's creator cashback flag on the token" />
          </Card>

          {/* 3 — tasks */}
          <Card
            icon={<StepNumber n={3} done={stepDone[2]} />}
            title="Tasks"
            description="What your other wallets do around the create. Optional: with no task the dev wallet creates and buys alone."
            actions={<span className="mono text-[13px] text-text-3">{form.tasks.length} task{form.tasks.length !== 1 ? "s" : ""}</span>}
            bodyClassName="gap-4"
          >
            <AddTaskMenu count={taskCount} onAdd={(t) => set("tasks", [...form.tasks, newTask(t)])} />
            {form.tasks.map((t) => (
              <TaskCard key={t.id} task={t} wallets={live} groups={groups} balances={balances.data ?? null} onChange={(nt) => set("tasks", form.tasks.map((x) => (x.id === t.id ? nt : x)))} onRemove={() => set("tasks", form.tasks.filter((x) => x.id !== t.id))} />
            ))}
            {bundleWallets > 4 ? <InlineError>Jito accepts 5 transactions per bundle: the create plus 4 buys. Move the extra wallets to a Sniper task.</InlineError> : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Icon3D name="autodump" size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Auto-dump</div>
                    <p className="hint">Sell automatically once the market cap hits a target, or after a delay.</p>
                  </div>
                  <Toggle checked={form.autoDumpEnabled} onChange={(v) => set("autoDumpEnabled", v)} color="auto" />
                </div>
                {form.autoDumpEnabled ? (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Sell">
                      <Input type="number" min={1} max={100} value={form.autoDumpPercent} onChange={(e) => set("autoDumpPercent", Number(e.target.value))} mono suffix="%" />
                    </Field>
                    <Field label="At market cap">
                      <Input type="number" min={0} value={form.autoDumpMcUsd} onChange={(e) => set("autoDumpMcUsd", e.target.value)} mono suffix="USD" placeholder="—" />
                    </Field>
                    <Field label="Or after">
                      <Input type="number" min={0} value={form.autoDumpAfterSec} onChange={(e) => set("autoDumpAfterSec", e.target.value)} mono suffix="s" placeholder="—" />
                    </Field>
                  </div>
                ) : null}
              </div>
              <div className="card p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Icon3D name="sniper" size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Sell on external volume</div>
                    <p className="hint">Dump every launch wallet once buys from wallets that are not yours reach a threshold.</p>
                  </div>
                  <Toggle checked={form.sellOnExternalEnabled} onChange={(v) => set("sellOnExternalEnabled", v)} color="auto" />
                </div>
                {form.sellOnExternalEnabled ? (
                  <Field label="External buys threshold">
                    <Input type="number" min={0} step="0.5" value={form.sellOnExternalThreshold} onChange={(e) => set("sellOnExternalThreshold", e.target.value)} mono suffix="SOL" />
                  </Field>
                ) : null}
              </div>
            </div>
          </Card>

          {/* 4 — review */}
          <Card icon={<StepNumber n={4} done={stepDone[3]} />} title="Review & launch" description="Everything below must be green. The summary on the right lists what will happen and what it costs." bodyClassName="gap-3">
            <ul className="flex flex-col gap-1.5 text-sm">
              {[
                { ok: !!form.name.trim() && !!form.symbol.trim(), text: form.name.trim() && form.symbol.trim() ? `Token ${form.name.trim()} (${form.symbol.trim()})` : "Token name and symbol" },
                { ok: !!form.imageDataUrl, text: form.imageDataUrl ? "Picture ready" : "A picture is required by pump.fun" },
                { ok: !!form.devWallet, text: devWallet ? `Dev wallet ${devWallet.label || short(devWallet.address)} buys ${form.devBuySol || "0"} SOL at create` : "Pick the dev wallet" },
                ...form.tasks.map((t) => ({ ok: validateFormTask(t, form) === null, text: `${TASK_META[t.type].label}: ${taskSentence(t, live)}` })),
                { ok: !shortRows.length, text: shortRows.length ? `${shortRows.length} wallet${shortRows.length > 1 ? "s are" : " is"} short of SOL — fund them in Portfolio` : `Every wallet holds enough SOL (about ${sol(needed)} needed)` },
                { ok: canSign, text: canSign ? "Vault unlocked" : "Unlock the vault to sign" },
              ].map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={cx("mt-0.5 shrink-0", r.ok ? "text-up" : "text-down")}>
                    <Icon name={r.ok ? "check" : "x"} size={15} />
                  </span>
                  <span className={r.ok ? "text-text-2" : "text-text"}>{r.text}</span>
                </li>
              ))}
            </ul>
            <p className="hint">Press Launch in the summary when every line is green. A confirmation lists every wallet and amount before anything is signed.</p>
          </Card>
        </div>

        {/* ------------------------------------------------ sticky summary */}
        <div className="xl:sticky xl:top-[72px] flex flex-col gap-4">
          <Card glow title="What will happen" description="In order, once you confirm." bodyClassName="gap-4">
            <div className="flex items-center gap-3">
              {form.imageDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL
                <img src={form.imageDataUrl} alt="" className="w-14 h-14 rounded-xl border border-line object-cover shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-xl border border-dashed border-line-hover flex items-center justify-center text-text-3 shrink-0">
                  <Icon name="eye" size={18} />
                </div>
              )}
              <div className="min-w-0">
                <div className="font-semibold truncate">{form.name.trim() || <span className="text-text-3">Token name</span>}</div>
                <div className="mono text-[13px] text-text-2">{form.symbol.trim() || <span className="text-text-3">TICKER</span>} · pump.fun · Solana</div>
              </div>
            </div>
            <ol className="flex flex-col gap-2 text-sm">
              <Step n={1}>
                <b>{devWallet ? devWallet.label || short(devWallet.address) : "The dev wallet"}</b> creates the token{Number(form.devBuySol) > 0 ? ` and buys ${form.devBuySol} SOL` : ""}
                {bundleWallets ? ` in one Jito bundle with ${bundleWallets} bundle buy${bundleWallets > 1 ? "s" : ""}` : ""}.
              </Step>
              {form.tasks.map((t, i) => (
                <Step key={t.id} n={i + 2} icon={TASK_META[t.type].icon}>
                  <b>{TASK_META[t.type].label}:</b> {taskSentence(t, live)}
                  {!t.autoStart ? <span className="text-text-3"> Started by hand from the dashboard.</span> : null}
                </Step>
              ))}
              {form.autoDumpEnabled ? (
                <Step n={form.tasks.length + 2} icon="autodump">
                  <b>Auto-dump</b> sells {form.autoDumpPercent} %{Number(form.autoDumpMcUsd) > 0 ? ` when the market cap reaches $${form.autoDumpMcUsd}` : ""}
                  {Number(form.autoDumpAfterSec) > 0 ? `${Number(form.autoDumpMcUsd) > 0 ? ", or" : ""} after ${form.autoDumpAfterSec} s` : ""}.
                </Step>
              ) : null}
              {form.sellOnExternalEnabled ? (
                <Step n={form.tasks.length + (form.autoDumpEnabled ? 3 : 2)} icon="sniper">
                  <b>Sell on external volume:</b> every launch wallet dumps once outside buys reach {form.sellOnExternalThreshold} SOL.
                </Step>
              ) : null}
            </ol>

            <CostLine
              rows={[
                { label: `Create fee`, value: `~${COST.create} SOL` },
                ...(Number(form.devBuySol) > 0 ? [{ label: "Dev buy", value: `${form.devBuySol} SOL` }] : []),
                ...form.tasks
                  .filter((t) => t.type !== "wash")
                  .map((t) => {
                    const addrs = taskWallets(t, live);
                    const v = t.type === "bundle" || t.type === "sniper" ? addrs.reduce((n, a) => n + (Number(t.walletBuyAmounts[a] ?? t.buyAmount) || 0), 0) : addrs.length * (Number(t.maxTradeAmount) || 0);
                    return { label: `${TASK_META[t.type].label} · ${addrs.length} wallet${addrs.length !== 1 ? "s" : ""}${t.type === "buy" || t.type === "volume" ? " · first trade" : ""}`, value: `${sol(v)} SOL` };
                  }),
                { label: "Available on those wallets", value: `${sol(available)} SOL`, tone: shortRows.length ? "down" : "up" },
              ]}
              total={{ label: "SOL needed", value: `≈ ${sol(needed)} SOL`, tone: shortRows.length ? "down" : undefined }}
              note={shortRows.length ? `Short: ${shortRows.map((r) => `${r.label} needs ${sol(r.needed)}, has ${sol(r.available)}`).join(" · ")}.` : "Estimates include ~0.01 SOL per buy for rent and fees; the server re-checks every balance before sending."}
            />

            {problems.length ? (
              <ul className="text-sm text-text-2 flex flex-col gap-1">
                {problems.slice(0, 5).map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <Icon name="x" size={14} className="text-down mt-0.5 shrink-0" /> {p}
                  </li>
                ))}
                {problems.length > 5 ? <li className="hint pl-6">and {problems.length - 5} more</li> : null}
              </ul>
            ) : null}
            {!canSign ? <Note tone="warn">Unlock the vault to launch.</Note> : null}
            <Button variant="primary" size="lg" className="w-full" disabled={!!problems.length || !canSign} onClick={() => setSummary(true)} title={!canSign ? "Unlock the vault first" : problems.length ? "Fix the items above first" : undefined}>
              <Icon3D name="launch" size={22} /> Launch
            </Button>
            <p className="hint text-center">Nothing is signed before the confirmation. The draft autosaves on this machine.</p>
          </Card>
        </div>
      </div>

      <Modal open={summary} onClose={() => !busy && setSummary(false)} title="Confirm the launch" description="Real SOL leaves your wallets as soon as you confirm." width={600}>
        <div className="flex items-center gap-3">
          {form.imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL
            <img src={form.imageDataUrl} alt="" className="w-14 h-14 rounded-xl border border-line object-cover" />
          ) : null}
          <div>
            <div className="font-semibold">
              {form.name} <span className="text-text-3 mono">{form.symbol}</span>
            </div>
            <div className="hint">
              pump.fun · dev {devWallet?.label || short(form.devWallet)} · dev buy {form.devBuySol || "0"} SOL · slippage {form.slippageBps / 100} %{form.vanity ? ` · vanity …${form.vanity}` : ""}
            </div>
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {form.tasks.map((t) => (
            <li key={t.id} className="card px-3 py-2.5 text-sm flex items-start gap-3">
              <Icon3D name={TASK_META[t.type].icon} size={22} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{TASK_META[t.type].label}</span> <span className="text-text-2">{taskSentence(t, live)}</span>
              </span>
              <span className={cx("text-[13px] shrink-0", t.autoStart ? "text-up" : "text-text-3")}>{t.autoStart ? "auto start" : "manual"}</span>
            </li>
          ))}
          {form.autoDumpEnabled ? (
            <li className="text-sm text-auto">
              Auto-dump {form.autoDumpPercent} %{form.autoDumpMcUsd ? ` at $${form.autoDumpMcUsd}` : ""}
              {form.autoDumpAfterSec ? ` after ${form.autoDumpAfterSec} s` : ""}
            </li>
          ) : null}
          {form.sellOnExternalEnabled ? <li className="text-sm text-auto">Sell on external volume ≥ {form.sellOnExternalThreshold} SOL</li> : null}
        </ul>
        <CostLine
          rows={needs.map((r) => ({ label: `${r.label} · ${r.role}`, value: `${sol(r.needed)} of ${sol(r.available)} SOL`, tone: r.needed > r.available ? ("down" as const) : undefined }))}
          total={{ label: "SOL needed", value: `≈ ${sol(needed)} SOL`, tone: shortRows.length ? "down" : undefined }}
          note={`Create + dev buy${bundleWallets ? ` + ${bundleWallets} bundle buy${bundleWallets > 1 ? "s" : ""} go out as one Jito bundle` : " go out as one transaction"}.`}
        />
        <InlineError>{launchErr}</InlineError>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSummary(false)} disabled={!!busy}>
            Back
          </Button>
          <Button variant="primary" size="lg" busy={busy === "launch"} onClick={launch} icon="rocket">
            Confirm and launch
          </Button>
        </div>
      </Modal>
    </Page>
  );
}

function Step({ n, icon, children }: { n: number; icon?: "bundle" | "sniper" | "buy" | "volume" | "wash" | "autodump"; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mono text-[13px] text-text-3 w-4 shrink-0 text-right mt-0.5">{n}.</span>
      {icon ? <Icon3D name={icon} size={18} className="mt-0.5" /> : null}
      <span className="text-text-2 min-w-0">{children}</span>
    </li>
  );
}

/** First validation problem of a task inside the form, or null when it is fine. */
function validateFormTask(t: LaunchForm["tasks"][number], f: LaunchForm): string | null {
  const msgs = validateForm({ ...f, name: "x", symbol: "X", imageDataUrl: "d", devWallet: f.devWallet || "w", tasks: [t], sellOnExternalEnabled: false, autoDumpEnabled: false });
  return msgs[0] ?? null;
}
