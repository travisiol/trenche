"use client";
/** Pieces shared by the Mixer's two modes (split: many From → many To in one order; pairs: one order per From → To). */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, ChevronDown, RefreshCw, X } from "lucide-react";
import { cx } from "@/components/bx/ui";
import { HUSHER_PROVIDERS, parseHusherSol, providerLabel } from "@/lib/husher";

export const fieldBase = "border border-line-100 bg-bg-50 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent disabled:opacity-50";
export const field = `w-full ${fieldBase}`;
export const smallBtn = "shrink-0 rounded border border-line-100 bg-bg-50 px-3 text-xs font-medium text-text-100 hover:border-accent/35 hover:text-accent disabled:opacity-45";
export const primary = "h-9 w-full rounded border border-accent/40 bg-accent/15 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50";
export const solid = "h-10 w-full rounded bg-accent text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50";
export const card = "rounded-[10px] border border-line-100";
export const external = "inline underline text-accent";
/** SOL kept for the deposit transaction fee when listing wallets that can pay. */
export const PAY_FEE_LAM = BigInt(10_000);
export const FINAL = ["Complete", "Failed", "Refunded"];

export function lamOf(v: string | null | undefined): bigint {
  try { return parseHusherSol(String(v ?? "")); } catch { return BigInt(0); }
}

export function ProviderMark({ provider }: { provider: string }) {
  const p = HUSHER_PROVIDERS[provider];
  return <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold text-black" style={{ background: p?.color ?? "#888" }}>{(p?.label ?? provider).slice(0, 1)}</span>;
}

export function useQr(text: string | null) {
  const [qr, setQr] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: 164, color: { dark: "#000000", light: "#ffffff" } }).then((url) => alive && setQr({ text, url }));
    return () => { alive = false; };
  }, [text]);
  return qr && qr.text === text ? qr.url : null;
}

export type StepState = "done" | "active" | "todo" | "failed";
/** One line of the From-wallets progress: Order created → Deposit sent → Received by Husher → Sent to wallets. */
export function Step({ state, title, detail, last }: { state: StepState; title: string; detail?: React.ReactNode; last?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
          state === "done" ? "border-green-100 bg-green-100/15 text-green-100" : state === "active" ? "border-accent bg-accent/15 text-accent" : state === "failed" ? "border-decrease bg-decrease/15 text-decrease" : "border-line-100 text-text-300")}>
          {state === "done" ? <Check className="h-3.5 w-3.5" /> : state === "active" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : state === "failed" ? <X className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-line-100" />}
        </span>
        {!last ? <span className={cx("my-1 w-px flex-1", state === "done" ? "bg-green-100/40" : "bg-line-100")} /> : null}
      </div>
      <div className={cx("min-w-0 pb-4", last && "pb-0")}>
        <p className={cx("text-sm font-medium", state === "todo" ? "text-text-300" : "text-text-100")}>{title}</p>
        {detail ? <div className="mt-0.5 text-[11px] leading-relaxed text-text-300">{detail}</div> : null}
      </div>
    </div>
  );
}

export function QrImage({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side
  return <img src={src} alt="Deposit address QR code" width={164} height={164} className="rounded-lg bg-white p-1.5" />;
}

/** Block X's provider dropdown: logo · name · ~receive, list sorted best first. */
export function ProviderSelect({ value, options, onChange, disabled }: { value: string; options: { provider: string; receiveSol: string }[]; onChange: (p: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.provider === value) ?? options[0];
  return (
    <div className="relative min-w-0 flex-1">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={cx(fieldBase, "flex h-9 w-full items-center gap-2 text-left")}>
        <ProviderMark provider={cur.provider} />
        <span className="min-w-0 flex-1 truncate">{providerLabel(cur.provider)} · ~{cur.receiveSol} SOL</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-300" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[1]" onMouseDown={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-[2] mt-1 overflow-hidden rounded border border-line-100 bg-bg-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            {options.map((o) => (
              <button key={o.provider} type="button" onClick={() => { onChange(o.provider); setOpen(false); }} className={cx("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-white/[0.04]", o.provider === cur.provider ? "bg-accent/10 text-accent" : "text-text-100")}>
                <ProviderMark provider={o.provider} />
                <span className="flex-1">{providerLabel(o.provider)}</span>
                <span className="text-xs text-text-300">~{o.receiveSol} SOL</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function MinutesInput({ value, onChange, disabled, className }: { value: string; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  return (
    <div className={cx("relative shrink-0", className)}>
      <input inputMode="numeric" placeholder="0" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))} className={cx(fieldBase, "h-9 w-full pr-10 text-right font-mono")} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-300">min</span>
    </div>
  );
}

export function browserMeta() {
  let timezone = "";
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* unknown */ }
  return { timezone, language: navigator.language || "", userAgent: navigator.userAgent || "" };
}

