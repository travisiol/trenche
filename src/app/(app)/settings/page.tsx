"use client";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Button, Field, InlineError, Input, Kbd, Panel, Spinner, Toggle, toast } from "@/components/ui";
import { LockIcon, UnlockModal } from "@/components/Navbar";
import { failureMessage, post } from "@/lib/api";
import { refreshVaultDependents, settingsRes, useSettings, useVault, writeLocalPresets } from "@/lib/store";
import type { Settings, SettingsUpdateRequest } from "@/lib/ui-types";

export default function SettingsPage() {
  const settings = useSettings();
  if (settings.error) {
    return (
      <div className="flex-1 p-4">
        <Panel glow title="Settings" icon={<Icon3D name="settings" size={22} />}>
          <ApiError error={settings.error} retry={settings.refresh} />
        </Panel>
        <div className="mt-4">
          <VaultPanel />
        </div>
      </div>
    );
  }
  if (!settings.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-3">
        <Spinner />
      </div>
    );
  }
  return <SettingsForm key={settings.at} initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [f, setF] = useState<SettingsUpdateRequest>({
    rpcUrl: initial.rpcUrl,
    sendRpcUrl: initial.sendRpcUrl,
    jitoEnabled: initial.jitoEnabled,
    slippageBps: initial.slippageBps,
    cuPrice: initial.cuPrice,
    tipSol: initial.tipSol,
    presets: initial.presets,
    keybinds: initial.keybinds,
  });
  const [pumpKey, setPumpKey] = useState("");
  const [heliusKey, setHeliusKey] = useState("");
  const [clearPump, setClearPump] = useState(false);
  const [clearHelius, setClearHelius] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof SettingsUpdateRequest>(k: K, v: SettingsUpdateRequest[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    setErr(null);
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
      setClearPump(false);
      setClearHelius(false);
      settingsRes.refresh();
      toast("Settings saved", "ok");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 p-4">
      <div className="flex flex-col gap-4">
        <Panel glow title="Network" icon={<Icon3D name="settings" size={22} />} bodyClassName="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Read RPC" hint="Blank = public Solana RPC, or Helius when a key is set below.">
              <Input value={f.rpcUrl ?? ""} onChange={(e) => set("rpcUrl", e.target.value)} placeholder="https://api.mainnet-beta.solana.com" mono />
            </Field>
            <Field label="Send RPC" hint="Where signed transactions go. May equal the read RPC.">
              <Input value={f.sendRpcUrl ?? ""} onChange={(e) => set("sendRpcUrl", e.target.value)} placeholder="same as read RPC" mono />
            </Field>
            <Field label="Helius API key" hint={initial.hasHeliusKey ? "A key is stored. Type a new one to replace it." : "Optional. Faster reads and sender endpoint."}>
              <div className="flex gap-2">
                <Input type="password" value={heliusKey} onChange={(e) => setHeliusKey(e.target.value)} placeholder={initial.hasHeliusKey ? "••••••••" : "not set"} mono autoComplete="off" />
                {initial.hasHeliusKey ? (
                  <Button variant={clearHelius ? "danger" : "outline"} onClick={() => setClearHelius((c) => !c)}>
                    {clearHelius ? "Will clear" : "Clear"}
                  </Button>
                ) : null}
              </div>
            </Field>
            <Field label="PumpPortal API key" hint={initial.hasPumpportalKey ? "A key is stored: real trade events are subscribed on the feed." : "Optional. Enables real per-token trade events on the feed; without it volume is approximated from curve polling."}>
              <div className="flex gap-2">
                <Input type="password" value={pumpKey} onChange={(e) => setPumpKey(e.target.value)} placeholder={initial.hasPumpportalKey ? "••••••••" : "not set"} mono autoComplete="off" />
                {initial.hasPumpportalKey ? (
                  <Button variant={clearPump ? "danger" : "outline"} onClick={() => setClearPump((c) => !c)}>
                    {clearPump ? "Will clear" : "Clear"}
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>
        </Panel>

        <Panel title="Trading defaults" icon={<Icon3D name="jito" size={22} />} bodyClassName="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Slippage">
              <Input type="number" min={0} max={100} value={(f.slippageBps ?? 0) / 100} onChange={(e) => set("slippageBps", Math.round(Number(e.target.value) * 100))} mono suffix="%" />
            </Field>
            <Field label="Priority fee" hint="micro-lamports per CU">
              <Input type="number" min={0} value={f.cuPrice ?? 0} onChange={(e) => set("cuPrice", Number(e.target.value))} mono suffix="µL" />
            </Field>
            <Field label="Jito tip">
              <Input type="number" step="0.0001" min={0} value={f.tipSol ?? ""} onChange={(e) => set("tipSol", e.target.value)} mono suffix="SOL" />
            </Field>
            <Field label="Jito by default">
              <div className="h-9 flex items-center">
                <Toggle checked={!!f.jitoEnabled} onChange={(v) => set("jitoEnabled", v)} label={f.jitoEnabled ? "bundles" : "plain sends"} />
              </div>
            </Field>
          </div>
          <Field label="Quick-buy presets" hint="Used by Trenches cards, Trending and the trade panel. Also editable by double-clicking P1–P3 on a column.">
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <Input
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
                  mono
                  suffix={`P${i + 1} SOL`}
                />
              ))}
            </div>
          </Field>
        </Panel>

        <Panel title="Keyboard" bodyClassName="p-5 flex flex-col gap-3 text-xs text-text-2">
          <div className="flex items-center gap-3">
            <Kbd>{f.keybinds?.quickBuy[0] ?? "1"}</Kbd> <Kbd>{f.keybinds?.quickBuy[1] ?? "2"}</Kbd> <Kbd>{f.keybinds?.quickBuy[2] ?? "3"}</Kbd>
            <span>Quick buy P1 / P2 / P3 on the hovered Trenches card with the active wallet</span>
          </div>
          <div className="flex items-center gap-3">
            <Kbd>{f.keybinds?.close ?? "Esc"}</Kbd>
            <span>Close modals, clear the hovered card</span>
          </div>
          <div className="flex items-center gap-3">
            <Kbd>Enter</Kbd>
            <span>Open the focused card on its trade page</span>
          </div>
          <p className="text-text-3">Theme: dark only.</p>
        </Panel>

        <InlineError>{err}</InlineError>
        <div className="flex justify-end">
          <Button variant="primary" size="lg" busy={busy} onClick={save}>
            Save settings
          </Button>
        </div>
      </div>
      <VaultPanel />
    </div>
  );
}

function VaultPanel() {
  const vault = useVault();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const unlocked = vault.data?.unlocked ?? false;
  return (
    <Panel title="Vault" icon={<Icon3D name="portfolio" size={22} />} bodyClassName="p-5 flex flex-col gap-4" className="self-start">
      {vault.error ? <ApiError error={vault.error} retry={vault.refresh} compact /> : null}
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center border ${unlocked ? "border-up/40 bg-up-soft text-up" : "border-warn/40 bg-warn-soft text-warn"}`}>
          <LockIcon open={unlocked} size={18} />
        </span>
        <div>
          <div className="text-sm font-semibold">{vault.data ? (vault.data.exists ? (unlocked ? "Unlocked" : "Locked") : "No vault") : "—"}</div>
          <div className="mono text-[10px] text-text-3 break-all">{vault.data?.path ?? ""}</div>
        </div>
      </div>
      <p className="text-xs text-text-3">Keys are encrypted with your passphrase in this file. Locking wipes the decrypted keys from memory; reading balances keeps working.</p>
      {unlocked ? (
        <Button
          variant="warn"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post("/api/vault/lock", {});
              refreshVaultDependents();
              toast("Vault locked", "info");
            } catch (e) {
              toast(failureMessage(e), "err");
            } finally {
              setBusy(false);
            }
          }}
        >
          Lock vault
        </Button>
      ) : vault.data?.exists ? (
        <Button variant="primary" onClick={() => setUnlockOpen(true)}>
          Unlock vault
        </Button>
      ) : null}
      <UnlockModal open={unlockOpen} onClose={() => setUnlockOpen(false)} />
    </Panel>
  );
}
