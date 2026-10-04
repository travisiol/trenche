"use client";
/** Buy / Sell panel (right side of /trade and the quick-buy modal). */
import { useState } from "react";
import type { JobCreated, WalletInfo } from "@/lib/ui-types";
import { failureMessage, post } from "@/lib/api";
import { DEFAULT_PRESETS, readLocalPresets, useBalances, useSettings, useVault, useWallets } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { Button, Field, InlineError, Input, Segmented, cx, toast } from "../ui";
import { JobProgress } from "../JobProgress";

export function usePresets(): [string, string, string] {
  const settings = useSettings();
  return settings.data?.presets ?? readLocalPresetsSafe() ?? DEFAULT_PRESETS;
}
function readLocalPresetsSafe() {
  if (typeof window === "undefined") return null;
  return readLocalPresets();
}

export function TradePanel({ mint, symbol }: { mint: string; symbol: string | null }) {
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const settings = useSettings();
  const presets = usePresets();
  const canSign = vault.data?.unlocked ?? false;
  const live = (wallets.data?.wallets ?? []).filter((w) => !w.archived);
  const active = wallets.data?.active ?? null;

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [multi, setMulti] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [amount, setAmount] = useState(presets[0]);
  const [percent, setPercent] = useState(100);
  const [slippage, setSlippage] = useState<string>("");
  const [cuPrice, setCuPrice] = useState<string>("");
  const [tip, setTip] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);

  const targets = multi ? sel : active ? [active] : [];
  const slippageBps = slippage ? Math.round(Number(slippage) * 100) : (settings.data?.slippageBps ?? 2000);
  const totalSol = targets.length * Number(amount || 0);

  const send = async () => {
    if (!targets.length) return setErr("Pick a wallet first.");
    setBusy(true);
    setErr(null);
    try {
      const body =
        side === "buy"
          ? { mint, wallets: targets, sol: amount, slippageBps, cuPrice: cuPrice ? Number(cuPrice) : undefined, tipSol: tip || undefined }
          : { mint, wallets: targets, percent, slippageBps, cuPrice: cuPrice ? Number(cuPrice) : undefined, tipSol: tip || undefined };
      const r = await post<JobCreated>(`/api/trade/${side}`, body);
      setJobs((j) => [r.jobId, ...j].slice(0, 5));
      toast(side === "buy" ? `Buying ${amount} SOL × ${targets.length}` : `Selling ${percent} % × ${targets.length}`, "info");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-bg border border-line">
        <button onClick={() => setSide("buy")} className={cx("h-9 rounded-md text-sm font-semibold transition-colors", side === "buy" ? "bg-up text-black" : "text-text-3 hover:text-text")}>
          Buy
        </button>
        <button onClick={() => setSide("sell")} className={cx("h-9 rounded-md text-sm font-semibold transition-colors", side === "sell" ? "bg-down text-white" : "text-text-3 hover:text-text")}>
          Sell
        </button>
      </div>

      <Field
        label="Wallets"
        right={
          <button type="button" className="text-[11px] text-accent" onClick={() => setMulti((m) => !m)}>
            {multi ? "Active wallet only" : "Pick several"}
          </button>
        }
      >
        {multi ? (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-line bg-bg p-1 flex flex-col gap-0.5">
            {live.map((w) => (
              <label key={w.address} className={cx("flex items-center gap-2 h-8 px-2 rounded-md text-xs cursor-pointer", sel.includes(w.address) ? "bg-accent-soft" : "hover:bg-white/5")}>
                <input type="checkbox" className="accent-accent" checked={sel.includes(w.address)} onChange={() => setSel((s) => (s.includes(w.address) ? s.filter((x) => x !== w.address) : [...s, w.address]))} />
                <span className="truncate flex-1">{w.label || short(w.address)}</span>
                <span className="mono text-text-3">{sol(balances.data?.[w.address] ?? w.sol)}</span>
              </label>
            ))}
            {!live.length ? <div className="text-[11px] text-text-3 p-2">No wallet — create some in Portfolio.</div> : null}
          </div>
        ) : (
          <div className="input flex items-center gap-2 text-xs">
            <Icon3D name="portfolio" size={16} />
            {active ? (
              <>
                <span className="truncate">{live.find((w) => w.address === active)?.label || short(active)}</span>
                <span className="ml-auto mono text-text-3">{sol(balances.data?.[active] ?? live.find((w) => w.address === active)?.sol)} SOL</span>
              </>
            ) : (
              <span className="text-text-3">No active wallet</span>
            )}
          </div>
        )}
      </Field>

      {side === "buy" ? (
        <Field label="Amount per wallet">
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-1.5">
              {presets.map((p, i) => (
                <button key={i} type="button" onClick={() => setAmount(p)} className={cx("h-8 rounded-lg border text-xs mono", amount === p ? "border-accent bg-accent-soft text-accent" : "border-line text-text-2 hover:border-line-hover")}>
                  P{i + 1} · {p}
                </button>
              ))}
            </div>
            <Input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} mono suffix="SOL" />
          </div>
        </Field>
      ) : (
        <Field label="Sell">
          <Segmented value={String(percent) as "25" | "50" | "75" | "100"} onChange={(v) => setPercent(Number(v))} options={[25, 50, 75, 100].map((n) => ({ value: String(n) as "25", label: `${n} %` }))} />
        </Field>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Field label="Slippage">
          <Input type="number" min={0} max={100} value={slippage} onChange={(e) => setSlippage(e.target.value)} placeholder={String((settings.data?.slippageBps ?? 2000) / 100)} mono suffix="%" />
        </Field>
        <Field label="Priority">
          <Input type="number" min={0} value={cuPrice} onChange={(e) => setCuPrice(e.target.value)} placeholder={String(settings.data?.cuPrice ?? "")} mono suffix="µL" />
        </Field>
        <Field label="Jito tip">
          <Input type="number" step="0.0001" min={0} value={tip} onChange={(e) => setTip(e.target.value)} placeholder="off" mono suffix="SOL" />
        </Field>
      </div>

      <InlineError>{err}</InlineError>
      <Button variant={side === "buy" ? "up" : "down"} size="lg" busy={busy} disabled={!canSign || !targets.length || (side === "buy" && !(Number(amount) > 0))} onClick={send} title={!canSign ? "Unlock the vault first" : undefined}>
        {side === "buy" ? `BUY ${symbol ?? ""} · ${sol(totalSol)} SOL` : `SELL ${percent} % ${symbol ?? ""}`}
        {targets.length > 1 ? ` · ${targets.length} wallets` : ""}
      </Button>

      {jobs.length ? (
        <div className="flex flex-col gap-3 pt-3 border-t border-line">
          <span className="label">Sent</span>
          {jobs.map((j) => (
            <JobProgress key={j} jobId={j} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
