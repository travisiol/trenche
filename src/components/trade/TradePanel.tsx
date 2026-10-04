"use client";
/** Buy / Sell panel (right side of /trade): large amount buttons, a cost line, one big BUY / SELL button. */
import { useState } from "react";
import type { JobCreated } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { DEFAULT_PRESETS, readLocalPresets, useBalances, useSettings, useVault, useWallets } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { Icon3D } from "../Icon3D";
import { Button, CostLine, Field, InlineError, Input, Note, cx, toast } from "../ui";
import { JobProgress } from "../JobProgress";

export function usePresets(): [string, string, string] {
  const settings = useSettings();
  return settings.data?.presets ?? readLocalPresetsSafe() ?? DEFAULT_PRESETS;
}
function readLocalPresetsSafe() {
  if (typeof window === "undefined") return null;
  return readLocalPresets();
}

const TX_FEE = 0.000005;

export function TradePanel({ mint, symbol, valueSol }: { mint: string; symbol: string | null; valueSol?: number }) {
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
  const [advanced, setAdvanced] = useState(false);
  const [slippage, setSlippage] = useState<string>("");
  const [cuPrice, setCuPrice] = useState<string>("");
  const [tip, setTip] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);

  const targets = multi ? sel : active ? [active] : [];
  const slippageBps = slippage ? Math.round(Number(slippage) * 100) : (settings.data?.slippageBps ?? 2000);
  const perWallet = Number(amount || 0);
  const totalSol = targets.length * perWallet;
  const tipSol = tip ? Number(tip) : 0;
  const fees = targets.length * (TX_FEE + 0.002) + tipSol;
  const balanceOf = (a: string) => Number(balances.data?.[a] ?? live.find((w) => w.address === a)?.sol ?? 0);
  const shortWallets = side === "buy" ? targets.filter((a) => balanceOf(a) < perWallet + TX_FEE) : [];

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
      toast(side === "buy" ? `Buying ${amount} SOL on ${targets.length} wallet${targets.length !== 1 ? "s" : ""}` : `Selling ${percent} % on ${targets.length} wallet${targets.length !== 1 ? "s" : ""}`, "info");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-bg border border-line">
        <button onClick={() => setSide("buy")} className={cx("h-11 rounded-md text-[15px] font-semibold transition-colors", side === "buy" ? "bg-up text-black" : "text-text-3 hover:text-text")}>
          Buy
        </button>
        <button onClick={() => setSide("sell")} className={cx("h-11 rounded-md text-[15px] font-semibold transition-colors", side === "sell" ? "bg-down text-white" : "text-text-3 hover:text-text")}>
          Sell
        </button>
      </div>

      <Field
        label={multi ? "Wallets" : "Wallet"}
        right={
          <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => setMulti((m) => !m)}>
            {multi ? "Use the active wallet only" : "Pick several wallets"}
          </button>
        }
      >
        {multi ? (
          <div className="max-h-44 overflow-y-auto rounded-lg border border-line bg-bg p-1.5 flex flex-col gap-0.5">
            {live.map((w) => (
              <label key={w.address} className={cx("flex items-center gap-2.5 h-9 px-2 rounded-md text-sm cursor-pointer", sel.includes(w.address) ? "bg-accent-soft" : "hover:bg-white/5")}>
                <input type="checkbox" className="accent-accent w-4 h-4" checked={sel.includes(w.address)} onChange={() => setSel((s) => (s.includes(w.address) ? s.filter((x) => x !== w.address) : [...s, w.address]))} />
                <span className="truncate flex-1">{w.label || short(w.address)}</span>
                <span className="mono text-text-3 text-[13px]">{sol(balances.data?.[w.address] ?? w.sol)} SOL</span>
              </label>
            ))}
            {!live.length ? <div className="hint p-2">No wallet — create some in Portfolio.</div> : null}
          </div>
        ) : (
          <div className="input flex items-center gap-2 text-sm">
            <Icon3D name="portfolio" size={18} />
            {active ? (
              <>
                <span className="truncate">{live.find((w) => w.address === active)?.label || short(active)}</span>
                <span className="ml-auto mono text-text-2">{sol(balanceOf(active))} SOL</span>
              </>
            ) : (
              <span className="text-text-3">No active wallet — pick one in Portfolio</span>
            )}
          </div>
        )}
      </Field>

      {side === "buy" ? (
        <Field label="Amount per wallet">
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
              {presets.map((p, i) => (
                <button key={i} type="button" onClick={() => setAmount(p)} className={cx("h-12 rounded-lg border text-[15px] mono font-medium", amount === p ? "border-up bg-up-soft text-up" : "border-line text-text-2 hover:border-line-hover")}>
                  {p} SOL
                </button>
              ))}
            </div>
            <Input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} mono suffix="SOL" aria-label="Custom amount" />
          </div>
        </Field>
      ) : (
        <Field label="Sell how much of each wallet">
          <div className="grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((n) => (
              <button key={n} type="button" onClick={() => setPercent(n)} className={cx("h-12 rounded-lg border text-[15px] mono font-medium", percent === n ? "border-down bg-down-soft text-down" : "border-line text-text-2 hover:border-line-hover")}>
                {n} %
              </button>
            ))}
          </div>
        </Field>
      )}

      <button type="button" className="text-[13px] text-text-2 hover:text-text text-left" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? "▾" : "▸"} Slippage {slippageBps / 100} % · priority {cuPrice || settings.data?.cuPrice || 0} µL · Jito tip {tip || "off"}
      </button>
      {advanced ? (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Slippage">
            <Input type="number" min={0} max={100} value={slippage} onChange={(e) => setSlippage(e.target.value)} placeholder={String((settings.data?.slippageBps ?? 2000) / 100)} mono suffix="%" />
          </Field>
          <Field label="Priority fee">
            <Input type="number" min={0} value={cuPrice} onChange={(e) => setCuPrice(e.target.value)} placeholder={String(settings.data?.cuPrice ?? "")} mono suffix="µL" />
          </Field>
          <Field label="Jito tip">
            <Input type="number" step="0.0001" min={0} value={tip} onChange={(e) => setTip(e.target.value)} placeholder="off" mono suffix="SOL" />
          </Field>
        </div>
      ) : null}

      <CostLine
        rows={
          side === "buy"
            ? [
                { label: `${targets.length || 0} wallet${targets.length !== 1 ? "s" : ""} × ${sol(perWallet)} SOL`, value: `${sol(totalSol)} SOL` },
                { label: "Fees and rent", value: `~${sol(fees, 4)} SOL` },
              ]
            : [
                { label: `Sell ${percent} % on ${targets.length || 0} wallet${targets.length !== 1 ? "s" : ""}`, value: valueSol !== undefined ? `≈ ${sol((valueSol * percent) / 100)} SOL` : "—" },
                { label: "Fees", value: `~${sol(targets.length * TX_FEE, 6)} SOL` },
              ]
        }
        total={side === "buy" ? { label: "Total", value: `${sol(totalSol + fees)} SOL`, tone: shortWallets.length ? "down" : undefined } : undefined}
        note={shortWallets.length ? `${shortWallets.length} wallet${shortWallets.length > 1 ? "s" : ""} short of SOL.` : side === "buy" ? `Slippage ${slippageBps / 100} %. The server re-checks every balance before sending.` : `Slippage ${slippageBps / 100} %. Estimated at the current curve price.`}
      />

      <InlineError>{err}</InlineError>
      {!canSign ? <Note tone="warn">Unlock the vault to trade.</Note> : null}
      <Button variant={side === "buy" ? "up" : "down"} size="lg" busy={busy} disabled={!canSign || !targets.length || (side === "buy" && !(perWallet > 0))} onClick={send} title={!canSign ? "Unlock the vault first" : undefined}>
        {side === "buy" ? `Buy ${symbol ?? ""} for ${sol(totalSol)} SOL` : `Sell ${percent} % of ${symbol ?? "the token"}`}
        {targets.length > 1 ? ` on ${targets.length} wallets` : ""}
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
