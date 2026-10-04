"use client";
/** Block X "Global Task Presets" dialog (Tasks panel → Presets): CURRENT TASKS, select a preset, Save as / Update /
 *  Delete preset / Close / Load preset. Presets are /api/presets entries (snapshot without image; Load takes only the tasks). */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LaunchPreset, WalletInfo } from "@/lib/types";
import { BxModal, cx } from "@/components/bx/ui";
import { TASK_META, taskSentence, type LaunchForm } from "./model";

export function GlobalPresetsDialog({ open, onClose, form, wallets, presets, onPreset }: { open: boolean; onClose: () => void; form: LaunchForm; wallets: WalletInfo[]; presets: LaunchPreset[]; onPreset: (action: "load" | "save" | "update" | "delete", preset?: LaunchPreset, name?: string) => Promise<string | void> | void }) {
  const [sel, setSel] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const global = presets.filter((p) => !p.id.startsWith("task:"));
  const chosen = global.find((p) => p.id === sel) ?? null;
  const hasTasks = form.tasks.length > 0;
  /** Save as: the new preset stays selected, like Block X */
  const saveAs = async (name: string) => {
    setNaming(null);
    const id = await onPreset("save", undefined, name);
    if (typeof id === "string") setSel(id);
  };
  return (
    <BxModal open={open} onClose={onClose} title="Global Task Presets" width={520}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[11px] leading-relaxed text-text-300">Load replaces only the tasks on this launch. Launchpad, quote, buy amount, wallet, and fees stay as they are. Quick Launch still applies the saved snapshot.</p>
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-300">Current tasks</p>
          {!hasTasks ? (
            <p className="rounded-md border border-line-100 bg-bg-50 px-3 py-3 text-xs text-text-300">No tasks yet</p>
          ) : (
            <ul className="flex flex-col gap-1 rounded-md border border-line-100 bg-bg-50 p-2">
              {form.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <span className="shrink-0 font-medium text-text-100">{TASK_META[t.type].label}</span>
                  <span className="truncate text-text-300">{taskSentence(t, wallets)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="relative">
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="h-9 w-full appearance-none rounded-md border border-line-100 bg-input-100 px-3 pr-8 text-sm text-text-100 outline-none focus:border-accent" aria-label="Select global task preset">
            <option value="">{global.length ? "Select global task preset" : "No presets"}</option>
            {global.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {Array.isArray((p.data as { tasks?: unknown[] }).tasks) ? ((p.data as { tasks: unknown[] }).tasks.length ?? 0) : 0} task(s)
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-300" />
        </div>
        {naming !== null ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && naming.trim()) saveAs(naming.trim()); if (e.key === "Escape") setNaming(null); }} placeholder="Preset name" className="h-8 min-w-0 flex-1 rounded-md border border-line-100 bg-input-100 px-2 text-xs text-text-100 outline-none focus:border-accent" />
            <button type="button" disabled={!naming.trim()} onClick={() => saveAs(naming.trim())} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white disabled:opacity-40">
              Save
            </button>
            <button type="button" onClick={() => setNaming(null)} className="h-8 rounded-md border border-line-100 px-3 text-xs text-text-200">
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-50 px-4 py-3">
        <Btn disabled={!hasTasks} onClick={() => setNaming("")}>Save as</Btn>
        <Btn disabled={!chosen || !hasTasks} onClick={() => chosen && onPreset("update", chosen)}>Update</Btn>
        <Btn disabled={!chosen} onClick={() => { if (chosen && window.confirm(`Delete preset “${chosen.name}”?`)) { onPreset("delete", chosen); setSel(""); } }} danger>Delete preset</Btn>
        <Btn onClick={onClose}>Close</Btn>
        <Btn disabled={!chosen} primary onClick={() => { if (chosen) { onPreset("load", chosen); onClose(); } }}>Load preset</Btn>
      </div>
    </BxModal>
  );
}

function Btn({ children, onClick, disabled, primary, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cx("h-8 rounded-md px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40", primary ? "bg-accent text-white hover:bg-accent-hover" : danger ? "border border-decrease/40 text-decrease hover:bg-decrease/10" : "border border-line-100 bg-bg-50 text-text-200 hover:bg-white/[0.04] hover:text-text-100")}>
      {children}
    </button>
  );
}
