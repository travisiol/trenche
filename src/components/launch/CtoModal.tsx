"use client";
/** Block X "New CTO" dialog (design/blockx/launch-cto.html): run tasks on a token someone else deploys.
 *  POST /api/cto { address, addressIs, name, presetId } → { cto } (contract CtoCreateRequest / CtoResponse); the
 *  caller then opens the workspace on the CTO. A token that isn't created yet (dev wallet) is watched for 1 hour. */
import { useState } from "react";
import { Flag, X } from "lucide-react";
import type { CtoCreateRequest, CtoResponse, LaunchPreset } from "@/lib/types";
import { failureMessage, post } from "@/lib/api";
import { isMint } from "@/lib/format";
import { cx } from "@/components/bx/ui";

export function CtoModal({ open, onClose, presets, onCreated }: { open: boolean; onClose: () => void; presets: LaunchPreset[]; onCreated: (r: CtoResponse) => void }) {
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState<"token" | "dev">("token");
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;
  const valid = !address.trim() || isMint(address);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: CtoCreateRequest = { address: address.trim() || undefined, addressIs: address.trim() ? kind : undefined, name: name.trim() || undefined, presetId: preset || undefined };
      const r = await post<CtoResponse>("/api/cto", body);
      onCreated(r);
      setAddress("");
      setName("");
      setPreset("");
      onClose();
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "var(--modal-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="cto-dialog-title" className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line-100 bg-bg-50 shadow-[0_24px_90px_-25px_rgba(0,0,0,0.7)]">
        <div className="flex items-start justify-between gap-4 border-b border-line-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-accent" />
              <h2 id="cto-dialog-title" className="text-sm font-semibold text-text-100">
                New CTO
              </h2>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-300">Run tasks on a token someone else deploys. Nothing is deployed. Add the address now or later — a token that isn&apos;t created yet is watched for 1 hour, and tasks with Auto start fire the moment it&apos;s created.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-text-300 transition-colors hover:bg-white/[0.06] hover:text-text-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="cto-address" className="text-[11px] font-medium text-text-300">
                Token address (optional)
              </label>
              <div role="radiogroup" aria-label="Address is a" className="flex overflow-hidden rounded-md border border-line-100 bg-bg-100 text-[11px] font-medium">
                {(["token", "dev"] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cx("px-2 py-0.5 transition-colors", kind === k ? "bg-accent/15 text-accent" : "text-text-300 hover:text-text-100")}>
                    {k === "token" ? "Token" : "Dev wallet"}
                  </button>
                ))}
              </div>
            </div>
            <input id="cto-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Paste a token / mint address, or add it later" autoComplete="off" spellCheck={false} autoFocus className={cx("h-9 w-full rounded-md border bg-bg-100 px-3 font-mono text-xs text-text-100 outline-none placeholder:font-sans placeholder:text-text-300 focus-visible:ring-2 focus-visible:ring-accent/40", !valid ? "border-decrease/50" : "border-line-100")} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cto-name" className="text-[11px] font-medium text-text-300">
              Name (optional)
            </label>
            <input id="cto-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New CTO — replaced by the token's name once it's known" maxLength={64} autoComplete="off" className="h-9 w-full rounded-md border border-line-100 bg-bg-100 px-3 text-xs text-text-100 outline-none placeholder:text-text-300 focus-visible:ring-2 focus-visible:ring-accent/40" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cto-preset" className="text-[11px] font-medium text-text-300">
              Global Preset (optional)
            </label>
            <select id="cto-preset" value={preset} onChange={(e) => setPreset(e.target.value)} className="h-9 w-full rounded-md border border-line-100 bg-bg-100 px-2 text-xs text-text-100 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <option value="">No preset — add tasks after</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-line-100 bg-bg-100 px-3 text-xs font-medium text-text-200 transition-colors hover:bg-white/[0.04] disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={create} disabled={!valid || busy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
            <Flag className="h-3.5 w-3.5" />
            {busy ? "Creating…" : "Create CTO"}
          </button>
        </div>
      </section>
    </div>
  );
}
