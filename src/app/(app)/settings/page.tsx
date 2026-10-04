"use client";
/** Block X /sol/settings: left rail APP (Appearance · Workspace · Notifications · Keybinds · Account), content on the right. */
import { Suspense, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Bell, Keyboard, LayoutPanelLeft, Lock, LockOpen, Palette, Search, User } from "lucide-react";
import type { Cluster, Settings, SettingsUpdateRequest } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { refreshVaultDependents, settingsRes, useSettings, useVault, writeLocalPresets } from "@/lib/store";
import { setToastsMuted, toast, toastsMuted } from "@/components/ui";
import { BxButton, BxInput, BxSwitch, cx } from "@/components/bx/ui";
import { UnlockVaultModal, lockVault } from "@/components/bx/vault";

type Tab = "appearance" | "workspace" | "notifications" | "keybinds" | "account";
const TABS: { id: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" />, desc: "Theme, font, and visual preferences" },
  { id: "workspace", label: "Workspace", icon: <LayoutPanelLeft className="h-4 w-4" />, desc: "Cluster, RPC endpoints, API keys and trading defaults" },
  { id: "notifications", label: "Notifications", icon: <Bell className="h-4 w-4" />, desc: "In-app toasts" },
  { id: "keybinds", label: "Keybinds", icon: <Keyboard className="h-4 w-4" />, desc: "Keyboard shortcuts" },
  { id: "account", label: "Account", icon: <User className="h-4 w-4" />, desc: "Your vault — keys encrypted on this machine" },
];
const FONTS = [
  ["geist", "Geist (Default)"],
  ["inter", "Inter"],
  ["ibm-plex", "IBM Plex Sans"],
  ["dm-sans", "DM Sans"],
  ["space-grotesk", "Space Grotesk"],
  ["system", "System"],
] as const;
const noop = () => () => {};

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const params = useSearchParams();
  const initialTab = (params.get("tab") as Tab | null) ?? "appearance";
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initialTab) ? initialTab : "appearance");
  const [q, setQ] = useState("");
  const visible = TABS.filter((t) => !q || t.label.toLowerCase().includes(q.toLowerCase()) || t.desc.toLowerCase().includes(q.toLowerCase()));
  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-100">
      <div className="shrink-0 border-b border-line-100 bg-bg-100 md:hidden">
        <div className="flex w-full items-stretch">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cx("flex flex-1 items-center justify-center gap-2 overflow-hidden whitespace-nowrap border-r border-line-100 py-3 text-sm font-medium last:border-r-0", tab === t.id ? "bg-white/10 text-text-100" : "text-text-300 hover:bg-white/[0.04] hover:text-text-100")}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{t.icon}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        <aside className="hidden w-60 shrink-0 flex-col gap-4 overflow-hidden border-r border-line-100 bg-bg-50/40 px-3 py-3 md:flex">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-300" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings..." className="h-9 w-full rounded-lg border border-line-100 bg-bg-50 py-2 pl-8 pr-3 text-sm text-text-100 outline-none placeholder:text-text-300 hover:border-line-200 focus-visible:border-line-200" />
          </div>
          <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
            <div>
              <p className="mb-1.5 px-2.5 text-[10px] font-medium uppercase tracking-wider text-text-300">App</p>
              <ul className="flex flex-col gap-0.5">
                {visible.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setTab(t.id)} className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors", tab === t.id ? "bg-white/10 font-medium text-text-100" : "text-text-300 hover:bg-white/[0.04] hover:text-text-100")}>
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{t.icon}</span>
                      <span className="truncate">{t.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-line-100 bg-bg-100 px-4 py-4 md:px-6">
            <div>
              <h2 className="text-base font-semibold text-text-100 md:text-lg">{cur.label}</h2>
              <p className="mt-0.5 text-xs text-text-300">{cur.desc}</p>
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-4 py-5 md:px-6">
            {tab === "appearance" ? <Appearance /> : tab === "workspace" ? <Workspace /> : tab === "notifications" ? <Notifications /> : tab === "keybinds" ? <Keybinds /> : <Account />}
          </div>
        </div>
      </div>
    </div>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-wider text-text-300">{children}</h3>;
}
function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-line-100 bg-bg-50 p-3">
      <div className="min-w-0 flex-1 pr-2">
        <div className="text-sm font-medium text-text-100">{title}</div>
        {desc ? <div className="mt-0.5 text-xs text-text-300">{desc}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Appearance() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [font, setFont] = useState(() => (typeof document === "undefined" ? "geist" : document.documentElement.dataset.font || "geist"));
  const apply = (f: string) => {
    setFont(f);
    document.documentElement.dataset.font = f;
    try {
      localStorage.setItem("donchain.font", f);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-3">
        <H3>Theme</H3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button type="button" className="flex cursor-pointer flex-col items-center gap-1 text-left">
            <div className="h-11 w-full rounded-md border-[0.5px] border-solid" style={{ borderColor: "rgb(0, 82, 255)" }}>
              <div className="flex h-full w-full flex-col gap-0.5 rounded-md px-3 py-2.5" style={{ backgroundColor: "rgb(18, 18, 18)" }}>
                <div className="flex flex-1 items-center justify-between gap-2">
                  <div className="h-5 w-5 rounded-full" style={{ backgroundColor: "rgb(0, 82, 255)" }} />
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-1">
                      <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(240, 245, 245)", width: 56 }} />
                      <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(103, 110, 112)", width: 12 }} />
                      <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(103, 110, 112)", width: 12 }} />
                    </div>
                    <div className="flex gap-1">
                      <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(0, 82, 255)", width: 16 }} />
                      <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(246, 70, 93)", width: 16 }} />
                      <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(78, 167, 250)", width: 16 }} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(134, 217, 127)", width: 16 }} />
                    <div className="h-1 rounded-[1px]" style={{ backgroundColor: "rgb(246, 70, 93)", width: 16 }} />
                  </div>
                </div>
              </div>
            </div>
            <span className="text-sm text-text-100">Block X</span>
          </button>
        </div>
        <p className="text-xs text-text-300">DONCHAIN ships the Block X dark theme only.</p>
      </div>
      <div className="space-y-3">
        <H3>Typography</H3>
        <Row title="Font" desc="UI typeface across the app">
          <select value={hydrated ? font : "geist"} onChange={(e) => apply(e.target.value)} className="h-9 w-[180px] cursor-pointer rounded-lg border border-line-100 bg-input-200 px-2 text-sm text-text-100 outline-none hover:border-line-200">
            {FONTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Row>
      </div>
    </div>
  );
}

function Workspace() {
  const settings = useSettings();
  if (settings.error) return <p className="text-xs text-decrease">{failureMessage(settings.error)}</p>;
  if (!settings.data) return <p className="text-xs text-text-300">Loading…</p>;
  return <WorkspaceForm key={settings.at} initial={settings.data} />;
}

function WorkspaceForm({ initial }: { initial: Settings }) {
  const [f, setF] = useState<SettingsUpdateRequest>({ cluster: initial.cluster, rpcUrl: initial.rpcUrl, sendRpcUrl: initial.sendRpcUrl, jitoEnabled: initial.jitoEnabled, slippageBps: initial.slippageBps, cuPrice: initial.cuPrice, tipSol: initial.tipSol, presets: initial.presets, keybinds: initial.keybinds });
  const [pumpKey, setPumpKey] = useState("");
  const [heliusKey, setHeliusKey] = useState("");
  const [clearPump, setClearPump] = useState(false);
  const [clearHelius, setClearHelius] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SettingsUpdateRequest>(k: K, v: SettingsUpdateRequest[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body: SettingsUpdateRequest = { ...f };
      if (pumpKey) body.pumpportalKey = pumpKey;
      else if (clearPump) body.pumpportalKey = "";
      if (heliusKey) body.heliusKey = heliusKey;
      else if (clearHelius) body.heliusKey = "";
      await post("/api/settings", body);
      if (f.presets) writeLocalPresets(f.presets);
      setPumpKey("");
      setHeliusKey("");
      settingsRes.refresh();
      refreshVaultDependents();
      toast("Settings saved", "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const num = "h-9 w-[180px] font-mono text-sm";
  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-3">
        <H3>Cluster</H3>
        <Row title="Solana cluster" desc={f.cluster === "devnet" ? "Devnet: test SOL from the faucet (Airdrop in Portfolio), no Jito, explorer links carry ?cluster=devnet." : "Mainnet: real SOL, Jito bundles and the Helius sender."}>
          <div className="flex h-9 items-center gap-0.5 rounded-lg bg-input-100 p-0.5">
            {(["mainnet", "devnet"] as Cluster[]).map((c) => (
              <button key={c} type="button" onClick={() => set("cluster", c)} className={cx("h-full rounded-md px-3 text-xs font-medium capitalize transition-colors", f.cluster === c ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                {c}
              </button>
            ))}
          </div>
        </Row>
        <p className="text-[11px] text-text-300">
          In use now: read <span className="font-mono text-text-200">{initial.effectiveRpcUrl}</span> · send <span className="font-mono text-text-200">{initial.effectiveSendRpcUrl}</span>
        </p>
      </div>
      <div className="space-y-3">
        <H3>Network</H3>
        <Row title="Read RPC" desc="Blank = public Solana RPC, or Helius when a key is set.">
          <BxInput value={f.rpcUrl ?? ""} onChange={(e) => set("rpcUrl", e.target.value)} placeholder="https://api.mainnet-beta.solana.com" className="h-9 w-[280px] font-mono text-xs" />
        </Row>
        <Row title="Send RPC" desc="Where signed transactions go; may equal the read RPC.">
          <BxInput value={f.sendRpcUrl ?? ""} onChange={(e) => set("sendRpcUrl", e.target.value)} placeholder="Same as read RPC" className="h-9 w-[280px] font-mono text-xs" />
        </Row>
        <Row title="Helius API key" desc={initial.hasHeliusKey ? "A key is stored — type a new one to replace it." : "Optional: faster reads, holders list, sender endpoint."}>
          <div className="flex gap-1.5">
            <BxInput type="password" value={heliusKey} onChange={(e) => setHeliusKey(e.target.value)} placeholder={initial.hasHeliusKey ? "••••••••" : "Not set"} className="h-9 w-[200px] font-mono text-xs" autoComplete="off" />
            {initial.hasHeliusKey ? (
              <BxButton size="sm" className="h-9" variant={clearHelius ? "danger" : "secondary"} onClick={() => setClearHelius((c) => !c)}>
                {clearHelius ? "Will clear" : "Clear"}
              </BxButton>
            ) : null}
          </div>
        </Row>
        <Row title="PumpPortal API key" desc={initial.hasPumpportalKey ? "A key is stored." : "Optional: real per-token trade events."}>
          <div className="flex gap-1.5">
            <BxInput type="password" value={pumpKey} onChange={(e) => setPumpKey(e.target.value)} placeholder={initial.hasPumpportalKey ? "••••••••" : "Not set"} className="h-9 w-[200px] font-mono text-xs" autoComplete="off" />
            {initial.hasPumpportalKey ? (
              <BxButton size="sm" className="h-9" variant={clearPump ? "danger" : "secondary"} onClick={() => setClearPump((c) => !c)}>
                {clearPump ? "Will clear" : "Clear"}
              </BxButton>
            ) : null}
          </div>
        </Row>
      </div>
      <div className="space-y-3">
        <H3>Trading defaults</H3>
        <Row title="Slippage (%)" desc="Max price move accepted on buys and sells.">
          <BxInput type="number" min={0} max={100} value={(f.slippageBps ?? 0) / 100} onChange={(e) => set("slippageBps", Math.round(Number(e.target.value) * 100))} className={num} />
        </Row>
        <Row title="Priority fee (µL per CU)" desc="Micro-lamports per compute unit.">
          <BxInput type="number" min={0} value={f.cuPrice ?? 0} onChange={(e) => set("cuPrice", Number(e.target.value))} className={num} />
        </Row>
        <Row title="Jito tip (SOL)" desc="Paid once per bundle.">
          <BxInput type="number" step="0.0001" min={0} value={f.tipSol ?? ""} onChange={(e) => set("tipSol", e.target.value)} className={num} />
        </Row>
        <Row title="Send through Jito by default" desc="Bundles land together or not at all (mainnet only).">
          <BxSwitch checked={!!f.jitoEnabled} onChange={(v) => set("jitoEnabled", v)} />
        </Row>
        <Row title="Quick-buy presets P1 · P2 · P3 (SOL)" desc="Used on the trading page and the Tasks panel.">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <BxInput
                key={i}
                type="number"
                step="0.01"
                min={0}
                value={f.presets?.[i] ?? ""}
                onChange={(e) => {
                  const next = [...(f.presets ?? ["0.1", "0.5", "1"])] as [string, string, string];
                  next[i] = e.target.value;
                  set("presets", next);
                }}
                className="h-9 w-20 font-mono text-sm"
                aria-label={`P${i + 1}`}
              />
            ))}
          </div>
        </Row>
      </div>
      <div className="flex justify-end">
        <BxButton variant="primary" onClick={save} disabled={busy}>
          Save settings
        </BxButton>
      </div>
    </div>
  );
}

function Notifications() {
  const [muted, setMuted] = useState(() => (typeof window === "undefined" ? false : toastsMuted()));
  return (
    <div className="space-y-3">
      <H3>In-app</H3>
      <Row title="Mute toasts" desc="Hides confirmation and info toasts. Errors always show.">
        <BxSwitch
          checked={muted}
          onChange={(v) => {
            setMuted(v);
            setToastsMuted(v);
          }}
        />
      </Row>
    </div>
  );
}

function Keybinds() {
  const settings = useSettings();
  const kb = settings.data?.keybinds;
  const rows: [string, string][] = [
    ["/", "Open the search (name, ticker, CA)"],
    [kb?.close ?? "Esc", "Close dialogs and menus"],
    [`${kb?.quickBuy[0] ?? "1"} · ${kb?.quickBuy[1] ?? "2"} · ${kb?.quickBuy[2] ?? "3"}`, "Quick buy P1 / P2 / P3 with the active wallet on a trading page"],
    ["Enter", "Confirm the focused dialog"],
  ];
  return (
    <div className="space-y-3">
      <H3>Shortcuts</H3>
      {rows.map(([k, d]) => (
        <Row key={k} title={d}>
          <kbd className="rounded border border-line-100 bg-bg-100 px-2 py-1 font-mono text-xs text-text-100">{k}</kbd>
        </Row>
      ))}
    </div>
  );
}

function Account() {
  const vault = useVault();
  const [open, setOpen] = useState(false);
  const unlocked = vault.data?.unlocked ?? false;
  return (
    <div className="space-y-3">
      <H3>Vault</H3>
      <div className="flex items-center gap-3 rounded-lg border border-line-100 bg-bg-50 p-3">
        <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border", unlocked ? "border-green-100/40 bg-green-100/10 text-green-100" : "border-line-100 bg-bg-100 text-text-300")}>{unlocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-100">{vault.data ? (vault.data.exists ? (unlocked ? "Unlocked" : "Locked") : "No vault") : "—"}</div>
          <div className="break-all font-mono text-[11px] text-text-300">{vault.data?.path ?? ""}</div>
        </div>
        {unlocked ? (
          <BxButton onClick={() => lockVault()}>
            <Lock className="h-3.5 w-3.5" /> Lock
          </BxButton>
        ) : vault.data?.exists ? (
          <BxButton variant="primary" onClick={() => setOpen(true)}>
            <LockOpen className="h-3.5 w-3.5" /> Unlock
          </BxButton>
        ) : null}
      </div>
      <p className="text-xs text-text-300">Keys are encrypted with your passphrase in this file. Locking wipes the decrypted keys from memory; balances keep working. The passphrase is never stored.</p>
      <UnlockVaultModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
