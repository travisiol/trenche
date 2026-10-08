"use client";
/** Robinhood mode › Settings: slippage, launch defaults, where the keys live — Robinhood only, apart from Solana's. */
import { useState } from "react";
import { FolderOpen, Save } from "lucide-react";
import { failureMessage, post, useGet } from "@/lib/api";
import { toast } from "@/components/ui";
import { BxButton, BxCard, BxInput, BxLabel, BxSelect } from "@/components/bx/ui";
import { useRhStatus, type RhSettings } from "@/components/rh/common";

export default function RhSettingsPage() {
  const settings = useGet<RhSettings>("/api/robinhood/settings", 0);
  const status = useRhStatus(0);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold text-text-100">Settings</h1>
          <p className="text-xs text-text-300">Robinhood Chain only · the Solana settings are in Solana mode</p>
        </div>
        {settings.data ? <Form initial={settings.data} onSaved={settings.refresh} /> : <p className="text-sm text-text-300">{settings.error ? failureMessage(settings.error) : "Loading…"}</p>}
        <BxCard title="Keys" bodyClassName="px-5 pb-5">
          <div className="flex flex-col gap-2 text-xs text-text-200">
            <p>
              Robinhood keys: <span className="font-mono text-text-100">{status.data?.keystore ?? "…"}</span>
            </p>
            <p className="text-text-300">Encrypted with your vault passphrase, a dated backup before every change. Export a key from Portfolio (key icon on its row).</p>
            <div>
              <BxButton size="sm" onClick={() => post("/api/robinhood/open-folder", {}).catch((e) => toast(failureMessage(e), "err"))}>
                <FolderOpen className="h-3.5 w-3.5" /> Open the folder
              </BxButton>
            </div>
          </div>
        </BxCard>
        <BxCard title="Network" bodyClassName="px-5 pb-5">
          <div className="flex flex-col gap-1.5 text-xs text-text-200">
            <p>Robinhood Chain · chain id 4663 · gas in ETH · ~100 ms blocks, ordered by arrival (no priority fee to pay).</p>
            <p className="text-text-300">Transactions go to the sequencer (sequencer.mainnet.chain.robinhood.com), then the public RPC. Trades and the chart are read from publicnode, which serves the real chain head.</p>
          </div>
        </BxCard>
      </div>
    </div>
  );
}

function Form({ initial, onSaved }: { initial: RhSettings; onSaved: () => void }) {
  const [f, setF] = useState({ ...initial, slippagePct: String(initial.slippagePct), bundleGasLimit: String(initial.bundleGasLimit) });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      await post("/api/robinhood/settings", { ...f, slippagePct: Number(String(f.slippagePct).replace(",", ".")), bundleGasLimit: Number(f.bundleGasLimit) });
      toast("Saved", "ok");
      onSaved();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <BxCard title="Trading & launch" bodyClassName="px-5 pb-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <BxLabel>Slippage (%)</BxLabel>
          <BxInput inputMode="decimal" value={f.slippagePct} onChange={(e) => set("slippagePct", e.target.value)} />
          <p className="mt-1 text-[11px] text-text-300">Min-out haircut on every buy and sell. Bundle buys and multi-wallet clicks also assume your other wallets land first.</p>
        </div>
        <div>
          <BxLabel>Bundle buy gas limit</BxLabel>
          <BxInput inputMode="numeric" value={f.bundleGasLimit} onChange={(e) => set("bundleGasLimit", e.target.value.replace(/[^0-9]/g, ""))} />
          <p className="mt-1 text-[11px] text-text-300">Signed before the curve exists. A buy uses ~103 000; only the gas used is paid.</p>
        </div>
        <div>
          <BxLabel>Default dev buy (ETH)</BxLabel>
          <BxInput inputMode="decimal" value={f.devBuyEth} onChange={(e) => set("devBuyEth", e.target.value)} />
        </div>
        <div>
          <BxLabel>Default bundle buy per wallet (ETH)</BxLabel>
          <BxInput inputMode="decimal" value={f.bundleEth} onChange={(e) => set("bundleEth", e.target.value)} />
        </div>
        <div>
          <BxLabel>Default creator tax</BxLabel>
          <BxSelect value={f.creatorTaxBps} onChange={(e) => set("creatorTaxBps", Number(e.target.value))}>
            {[0, 100, 200, 300, 500, 1000].map((b) => (
              <option key={b} value={b}>
                {b / 100} %
              </option>
            ))}
          </BxSelect>
        </div>
      </div>
      <div className="mt-4">
        <BxButton variant="primary" disabled={busy} onClick={() => void save()}>
          <Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save"}
        </BxButton>
      </div>
    </BxCard>
  );
}
