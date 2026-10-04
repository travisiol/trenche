"use client";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { Icon } from "@/components/icons";
import { ApiError, Button, Card, Field, InlineError, Input, Kbd, Note, Page, PageHeader, Segmented, Spinner, Toggle, toast } from "@/components/ui";
import { UnlockVaultModal as UnlockModal } from "@/components/bx/vault";
import { failureMessage, post } from "@/lib/api";
import { refreshVaultDependents, settingsRes, useSettings, useVault, writeLocalPresets } from "@/lib/store";
import type { Settings, SettingsUpdateRequest } from "@/lib/types";

/** `cluster` is read and written defensively until the server contract ships it (mainnet | devnet). */
type Cluster = "mainnet" | "devnet";
type SettingsX = Settings & { cluster?: Cluster };
type UpdateX = SettingsUpdateRequest & { cluster?: Cluster };

export default function SettingsPage() {
  const settings = useSettings();
  if (settings.error) {
    return (
      <Page>
        <PageHeader icon={<Icon3D name="settings" size={40} glow />} title="Settings" description="Network, trading defaults, keyboard and the vault." />
        <Card>
          <ApiError error={settings.error} retry={settings.refresh} />
        </Card>
        <VaultCard />
      </Page>
    );
  }
  if (!settings.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-3">
        <Spinner />
      </div>
    );
  }
  return <SettingsForm key={settings.at} initial={settings.data as SettingsX} />;
}

function SettingsForm({ initial }: { initial: SettingsX }) {
  const [f, setF] = useState<UpdateX>({
    rpcUrl: initial.rpcUrl,
    sendRpcUrl: initial.sendRpcUrl,
    jitoEnabled: initial.jitoEnabled,
    slippageBps: initial.slippageBps,
    cuPrice: initial.cuPrice,
    tipSol: initial.tipSol,
    presets: initial.presets,
    keybinds: initial.keybinds,
    ...(initial.cluster ? { cluster: initial.cluster } : {}),
  });
  const [pumpKey, setPumpKey] = useState("");
  const [heliusKey, setHeliusKey] = useState("");
  const [clearPump, setClearPump] = useState(false);
  const [clearHelius, setClearHelius] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof UpdateX>(k: K, v: UpdateX[K]) => setF((s) => ({ ...s, [k]: v }));
  const hasCluster = initial.cluster !== undefined;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: UpdateX = { ...f };
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
      refreshVaultDependents();
      toast("Settings saved", "ok");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        icon={<Icon3D name="settings" size={40} glow />}
        title="Settings"
        description="Network, trading defaults, keyboard shortcuts and the vault. Changes apply after you save."
        actions={
          <Button variant="primary" busy={busy} onClick={save} icon="check">
            Save settings
          </Button>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          {hasCluster ? (
            <Card glow title="Cluster" description="Mainnet is the real network. Devnet uses test SOL from a faucet — an Airdrop button appears in Portfolio." icon={<Icon3D name="radar" size={24} />}>
              <div className="flex flex-wrap items-center gap-4">
                <Segmented size="md" value={f.cluster ?? "mainnet"} onChange={(v) => set("cluster", v)} options={[{ value: "mainnet", label: "Mainnet" }, { value: "devnet", label: "Devnet" }]} />
                {f.cluster === "devnet" ? <Note tone="warn">Devnet: pump.fun launches and Jito bundles are not available there; use it to test transfers and the wallet flows.</Note> : null}
              </div>
            </Card>
          ) : null}

          <Card glow={!hasCluster} title="Network" description="Where TRENCH reads the chain and where it sends signed transactions. Blank fields use the public RPC." icon={<Icon3D name="settings" size={24} />} bodyClassName="gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Read RPC" hint="Blank = public Solana RPC, or Helius when a key is set below.">
                <Input value={f.rpcUrl ?? ""} onChange={(e) => set("rpcUrl", e.target.value)} placeholder="https://api.mainnet-beta.solana.com" mono />
              </Field>
              <Field label="Send RPC" hint="Where signed transactions go. May be the same as the read RPC.">
                <Input value={f.sendRpcUrl ?? ""} onChange={(e) => set("sendRpcUrl", e.target.value)} placeholder="Same as the read RPC" mono />
              </Field>
              <Field label="Helius API key" hint={initial.hasHeliusKey ? "A key is stored. Type a new one to replace it." : "Optional. Faster reads, holders list and the sender endpoint for bundles."}>
                <div className="flex gap-2">
                  <Input type="password" value={heliusKey} onChange={(e) => setHeliusKey(e.target.value)} placeholder={initial.hasHeliusKey ? "••••••••" : "Not set"} mono autoComplete="off" />
                  {initial.hasHeliusKey ? (
                    <Button variant={clearHelius ? "danger" : "outline"} onClick={() => setClearHelius((c) => !c)}>
                      {clearHelius ? "Will clear" : "Clear"}
                    </Button>
                  ) : null}
                </div>
              </Field>
              <Field label="PumpPortal API key" hint={initial.hasPumpportalKey ? "A key is stored: real trade events are subscribed on the feed." : "Optional. Enables real per-token trade events on the feed; without it volume is estimated from curve polling."}>
                <div className="flex gap-2">
                  <Input type="password" value={pumpKey} onChange={(e) => setPumpKey(e.target.value)} placeholder={initial.hasPumpportalKey ? "••••••••" : "Not set"} mono autoComplete="off" />
                  {initial.hasPumpportalKey ? (
                    <Button variant={clearPump ? "danger" : "outline"} onClick={() => setClearPump((c) => !c)}>
                      {clearPump ? "Will clear" : "Clear"}
                    </Button>
                  ) : null}
                </div>
              </Field>
            </div>
          </Card>

          <Card title="Trading defaults" description="Used by every buy and sell unless you override them on the page." icon={<Icon3D name="jito" size={24} />} bodyClassName="gap-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Slippage" hint="Max price move you accept.">
                <Input type="number" min={0} max={100} value={(f.slippageBps ?? 0) / 100} onChange={(e) => set("slippageBps", Math.round(Number(e.target.value) * 100))} mono suffix="%" />
              </Field>
              <Field label="Priority fee" hint="Micro-lamports per compute unit.">
                <Input type="number" min={0} value={f.cuPrice ?? 0} onChange={(e) => set("cuPrice", Number(e.target.value))} mono suffix="µL" />
              </Field>
              <Field label="Jito tip" hint="Paid per bundle.">
                <Input type="number" step="0.0001" min={0} value={f.tipSol ?? ""} onChange={(e) => set("tipSol", e.target.value)} mono suffix="SOL" />
              </Field>
              <Field label="Send through Jito" hint="Bundles land together or not at all.">
                <div className="h-10 flex items-center">
                  <Toggle checked={!!f.jitoEnabled} onChange={(v) => set("jitoEnabled", v)} label={f.jitoEnabled ? "On by default" : "Plain sends"} />
                </div>
              </Field>
            </div>
            <Field label="Quick-buy presets" hint="The three amounts on Trenches cards, Trending rows and the trade panel.">
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
                    suffix="SOL"
                    aria-label={`Preset ${i + 1}`}
                  />
                ))}
              </div>
            </Field>
          </Card>

          <Card title="Keyboard" description="Shortcuts on the Trenches page." bodyClassName="gap-3 text-sm text-text-2">
            <div className="flex items-center gap-3">
              <span className="flex gap-1">
                <Kbd>{f.keybinds?.quickBuy[0] ?? "1"}</Kbd> <Kbd>{f.keybinds?.quickBuy[1] ?? "2"}</Kbd> <Kbd>{f.keybinds?.quickBuy[2] ?? "3"}</Kbd>
              </span>
              <span>Buy preset 1, 2 or 3 on the hovered card with the active wallet</span>
            </div>
            <div className="flex items-center gap-3">
              <Kbd>{f.keybinds?.close ?? "Esc"}</Kbd>
              <span>Close dialogs, clear the hovered card</span>
            </div>
            <div className="flex items-center gap-3">
              <Kbd>Enter</Kbd>
              <span>Open the focused card on its trade page</span>
            </div>
          </Card>

          <InlineError>{err}</InlineError>
        </div>
        <VaultCard />
      </div>
    </Page>
  );
}

function VaultCard() {
  const vault = useVault();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const unlocked = vault.data?.unlocked ?? false;
  return (
    <Card title="Vault" description="Your keys, encrypted with your passphrase in one file on this machine." icon={<Icon3D name="portfolio" size={24} />} bodyClassName="gap-4" className="xl:sticky xl:top-[72px]">
      {vault.error ? <ApiError error={vault.error} retry={vault.refresh} compact /> : null}
      <div className="flex items-center gap-3">
        <span className={`w-11 h-11 rounded-xl flex items-center justify-center border shrink-0 ${unlocked ? "border-up/40 bg-up-soft text-up" : "border-warn/40 bg-warn-soft text-warn"}`}>
          <Icon name={unlocked ? "unlock" : "lock"} size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{vault.data ? (vault.data.exists ? (unlocked ? "Unlocked" : "Locked") : "No vault") : "—"}</div>
          <div className="mono text-[13px] text-text-3 break-all">{vault.data?.path ?? ""}</div>
        </div>
      </div>
      <p className="text-sm text-text-2">Locking wipes the decrypted keys from memory; balances and the feed keep working. Unlock again with the passphrase.</p>
      {unlocked ? (
        <Button
          variant="warn"
          icon="lock"
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
        <Button variant="primary" icon="unlock" onClick={() => setUnlockOpen(true)}>
          Unlock vault
        </Button>
      ) : null}
      <UnlockModal open={unlockOpen} onClose={() => setUnlockOpen(false)} />
    </Card>
  );
}
