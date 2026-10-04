"use client";
/** Block X "Launch Token" modal (design/blockx/launch-modal.html) bound to our LaunchForm draft. */
import { useRef, useState } from "react";
import { ChevronDown, ClipboardPaste, Copy, Hash, Save, Trash2, Upload, Wallet, X } from "lucide-react";
import type { TokenInfo, WalletInfo } from "@/lib/types";
import { failureMessage, get } from "@/lib/api";
import { isMint, short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxSwitch, cx } from "@/components/bx/ui";
import { CropModal, urlToDataUrl } from "./ImageCrop";
import { EMPTY_FORM, supplyPctForSol, type LaunchForm } from "./model";

const input = "flex h-10 w-full rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent disabled:cursor-not-allowed disabled:opacity-50";
const PADS = ["Bonk", "StonkFun", "Bags", "AGENCY", "OTC"];

export function LaunchModal({ open, onClose, form, onChange, wallets, balances }: { open: boolean; onClose: () => void; form: LaunchForm; onChange: (f: LaunchForm) => void; wallets: WalletInfo[]; balances: Record<string, string | null> | null }) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const [clone, setClone] = useState("");
  const [cloneBusy, setCloneBusy] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [crop, setCrop] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;
  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => onChange({ ...form, [k]: v });
  const dev = wallets.find((w) => w.address === form.devWallet) ?? null;
  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => setCrop(String(r.result));
    r.readAsDataURL(file);
  };
  const paste = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await it.getType(type);
          readFile(new File([blob], "paste", { type }));
          return;
        }
      }
      toast("No image in the clipboard", "err");
    } catch {
      toast("Clipboard not readable — press Ctrl+V on the drop zone instead", "err");
    }
  };
  const doClone = async () => {
    if (!isMint(clone)) return toast("Paste a valid mint address", "err");
    setCloneBusy(true);
    try {
      const t = await get<TokenInfo>(`/api/token/${clone.trim()}`);
      let img = form.imageDataUrl;
      if (t.image) {
        try {
          img = await urlToDataUrl(t.image);
        } catch {
          toast("Metadata copied; the image host blocked the download — upload it by hand", "info");
        }
      }
      onChange({ ...form, name: t.name ?? form.name, symbol: t.symbol ?? form.symbol, description: t.description ?? form.description, twitter: t.twitter ?? "", telegram: t.telegram ?? "", website: t.website ?? "", imageDataUrl: img });
      toast(`Cloned ${t.symbol ?? short(clone)}`, "ok");
      setCloneOpen(false);
      setClone("");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setCloneBusy(false);
    }
  };
  const pct = supplyPctForSol(Number(form.devBuySol) || 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0" style={{ background: "var(--modal-overlay)" }} aria-label="Save and close launch dialog" onClick={onClose} />
      <div className="relative z-[201] flex w-full sm:max-w-[90vw] md:max-w-[620px]">
        <div className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border border-x-0 border-b-0 border-line-100 bg-bg-100 shadow-lg sm:h-auto sm:max-h-[90vh] sm:rounded-lg sm:border" role="dialog">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-50 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="text-base font-semibold text-text-100">
                Launch <span className="hidden sm:inline">Token</span>
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <div className="relative">
                <button type="button" onClick={() => setCloneOpen((o) => !o)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-2.5 text-xs font-medium text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100" aria-label="Clone a token">
                  <Copy className="h-3.5 w-3.5" />
                  Clone
                </button>
                {cloneOpen ? (
                  <div className="absolute right-0 top-9 z-10 flex w-[320px] gap-1.5 rounded-md border border-line-100 bg-bg-50 p-2 shadow-xl">
                    <input value={clone} onChange={(e) => setClone(e.target.value)} placeholder="Mint address to clone" className="h-8 min-w-0 flex-1 rounded-md border border-line-100 bg-input-100 px-2 font-mono text-xs text-text-100 outline-none focus:border-accent" onKeyDown={(e) => e.key === "Enter" && doClone()} autoFocus />
                    <button type="button" onClick={doClone} disabled={cloneBusy} className="h-8 rounded-md bg-accent px-2.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">
                      Clone
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <button type="button" onClick={() => setWalletOpen((o) => !o)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-2.5 text-xs transition-colors hover:bg-white/[0.04]" title="Select developer wallet">
                  <Wallet className="h-3.5 w-3.5 shrink-0 text-text-300" />
                  <span className={cx("max-w-28 truncate", dev ? "text-text-100" : "text-text-300")}>{dev ? dev.label || short(dev.address) : "No wallet"}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-text-300" />
                </button>
                {walletOpen ? (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setWalletOpen(false)} />
                    <div className="absolute right-0 top-9 z-20 max-h-64 w-64 overflow-y-auto rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
                      {!wallets.length ? <p className="px-2 py-3 text-xs text-text-300">No wallet — create one in Portfolio.</p> : null}
                      {wallets.map((w) => (
                        <button
                          key={w.address}
                          type="button"
                          onClick={() => {
                            set("devWallet", w.address);
                            setWalletOpen(false);
                          }}
                          className={cx("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hover-100", w.address === form.devWallet ? "bg-accent-muted text-text-100" : "text-text-200")}
                        >
                          <span className="truncate">{w.label || short(w.address)}</span>
                          <span className="ml-auto font-mono text-text-300">{sol(balances?.[w.address] ?? w.sol)} SOL</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
              <button type="button" onClick={() => onChange({ ...EMPTY_FORM, devWallet: form.devWallet, tipSol: form.tipSol })} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100" aria-label="Clear form" title="Clear form">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100" aria-label="Save and close" title="Save and close">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
              <div className="mx-auto w-full max-w-3xl px-3 py-2">
                <div className="flex gap-2 pb-2.5">
                  <div className="min-w-0 flex-[6]">
                    <label className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                      <span>Name</span>
                    </label>
                    <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Token name" maxLength={32} className={input} />
                  </div>
                  <div className="min-w-0 flex-[4]">
                    <label className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                      <span>Symbol</span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-flex overflow-hidden rounded border border-line-100">
                          {(["AB", "ab", "Ab"] as const).map((m) => (
                            <button key={m} type="button" onClick={() => set("symbol", m === "AB" ? form.symbol.toUpperCase() : m === "ab" ? form.symbol.toLowerCase() : form.symbol.charAt(0).toUpperCase() + form.symbol.slice(1).toLowerCase())} className="h-5 border-l border-line-100 px-1.5 text-[10px] font-medium leading-none text-text-300 first:border-l-0 hover:bg-white/[0.04] hover:text-text-100" title={m === "AB" ? "Uppercase" : m === "ab" ? "Lowercase" : "Capitalize first letter"}>
                              {m}
                            </button>
                          ))}
                        </span>
                      </span>
                    </label>
                    <input value={form.symbol} onChange={(e) => set("symbol", e.target.value)} placeholder="Symbol" maxLength={10} className={input} />
                  </div>
                </div>
                <div className="pb-2.5">
                  <label className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                    <span>Description</span>
                  </label>
                  <textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Token description" rows={2} className={cx(input, "h-auto resize-none")} />
                </div>
                <div className="pb-2.5">
                  <label className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                    <span>Website</span>
                  </label>
                  <input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://example.com" className={input} />
                </div>
                <div className="flex gap-2 pb-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 pb-0.5">
                      <label className="text-sm text-text-100">X (Twitter)</label>
                    </div>
                    <input value={form.twitter} onChange={(e) => set("twitter", e.target.value)} placeholder="https://x.com/" className={input} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                      <span>Telegram</span>
                    </label>
                    <input value={form.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="https://t.me/" className={input} />
                  </div>
                </div>
                <div className="rounded-md pb-1.5 transition-colors">
                  <div className="pb-1 text-sm text-text-100">Select Image</div>
                  <div className="relative w-full overflow-hidden">
                    <div
                      tabIndex={0}
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) readFile(f);
                      }}
                      onPaste={(e) => {
                        const f = Array.from(e.clipboardData.files)[0];
                        if (f) readFile(f);
                      }}
                      className={cx("flex h-16 w-full cursor-pointer items-center justify-center gap-3 rounded-md border border-dashed px-3 text-xs", dragOver ? "border-accent text-text-100" : form.imageDataUrl ? "border-line-100 text-text-200" : "border-line-100 text-text-300")}
                    >
                      {form.imageDataUrl ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                          <img src={form.imageDataUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                          <span>Image ready — drop another to replace</span>
                        </>
                      ) : (
                        "Drag & drop an image here, or Ctrl+V"
                      )}
                    </div>
                  </div>
                </div>
                <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                  <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3 text-xs text-text-200 hover:bg-white/[0.04]">
                    <Upload className="h-4 w-4" />
                    Upload
                  </button>
                  <button type="button" onClick={paste} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3 text-xs text-text-200 hover:bg-white/[0.04]" title="Paste image (Ctrl+V)">
                    <ClipboardPaste className="h-4 w-4" />
                    Paste
                  </button>
                  {form.imageDataUrl ? (
                    <button type="button" onClick={() => set("imageDataUrl", "")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3 text-xs text-text-200 hover:bg-white/[0.04]">
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="pb-2.5">
                  <div className="w-full rounded-lg border border-line-100 bg-bg-50 p-1">
                    <div className="flex items-stretch gap-1.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex gap-1.5">
                          <button type="button" className="relative min-w-0 flex-1 rounded-md border px-2 py-1.5 ring-1 ring-offset-0 transition-all" style={{ borderColor: "rgba(82, 212, 143, 0.4)", backgroundColor: "rgba(82, 212, 143, 0.1)" }} title="Pump.fun">
                            <span className="flex items-center justify-center gap-1.5 text-xs">
                              <span className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[3px]">
                                {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                                <img src="/launchpads/pumpfun.svg" alt="" className="size-full object-contain object-center" />
                              </span>
                              <span className="truncate font-medium text-text-100">Pump.fun</span>
                            </span>
                          </button>
                          {PADS.slice(0, 3).map((p) => (
                            <button key={p} type="button" disabled className="relative min-w-0 flex-1 cursor-not-allowed rounded-md border border-line-100 px-2 py-1.5 opacity-40" title={`${p} — not available in DONCHAIN`}>
                              <span className="flex items-center justify-center gap-1.5 text-xs">
                                <span className="truncate font-medium text-text-100">{p}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          {PADS.slice(3).map((p) => (
                            <button key={p} type="button" disabled className="relative min-w-0 flex-1 cursor-not-allowed rounded-md border border-line-100 px-2 py-1.5 opacity-40" title={`${p} — not available in DONCHAIN`}>
                              <span className="flex items-center justify-center gap-1.5 text-xs">
                                <span className="truncate font-medium text-text-100">{p}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button type="button" onClick={() => set("vanity", form.vanity ? "" : "pump")} className={cx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors hover:bg-white/[0.04]", form.vanity ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200")}>
                      <Hash className="h-3.5 w-3.5 shrink-0" />
                      Fetch mint address
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-text-300">{form.vanity ? `A …${form.vanity} address is searched when you launch (slower).` : "Reserves a …pump address at launch"}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="shrink-0 border-t border-line-50 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="mb-1.5 flex h-8 items-center justify-between gap-2">
                <div className="flex items-center gap-1.5" title="Sets pump.fun's creator cashback flag on the token">
                  <label className="shrink-0 text-[11px] text-text-300">Cashback</label>
                  <BxSwitch checked={form.cashback} onChange={(v) => set("cashback", v)} />
                </div>
                <div className="flex items-center gap-1.5" title="Dump all wallets when net external volume reaches this SOL amount">
                  <label className="shrink-0 text-[11px] text-text-300">Auto Dump</label>
                  <BxSwitch checked={form.sellOnExternalEnabled} onChange={(v) => set("sellOnExternalEnabled", v)} />
                  {form.sellOnExternalEnabled ? <input type="number" min={0} step="0.5" value={form.sellOnExternalThreshold} onChange={(e) => set("sellOnExternalThreshold", e.target.value)} className="h-6 w-16 rounded border border-line-100 bg-input-100 px-1.5 font-mono text-[11px] text-text-100 outline-none focus:border-accent" title="External volume threshold (SOL)" /> : null}
                </div>
                <div className="flex items-center justify-end gap-1.5" title="Sell the developer wallet when the market cap or a delay is reached">
                  <label className="shrink-0 text-[11px] text-text-300">Auto Dev Sell</label>
                  <BxSwitch checked={form.autoDumpEnabled} onChange={(v) => set("autoDumpEnabled", v)} />
                </div>
              </div>
              {form.autoDumpEnabled ? (
                <div className="mb-1.5 grid grid-cols-3 gap-1.5">
                  <label className="flex flex-col text-[11px] text-text-300">
                    Sell %
                    <input type="number" min={1} max={100} value={form.autoDumpPercent} onChange={(e) => set("autoDumpPercent", Number(e.target.value))} className="h-7 rounded border border-line-100 bg-input-100 px-2 font-mono text-xs text-text-100 outline-none focus:border-accent" />
                  </label>
                  <label className="flex flex-col text-[11px] text-text-300">
                    At MC (USD)
                    <input type="number" min={0} value={form.autoDumpMcUsd} onChange={(e) => set("autoDumpMcUsd", e.target.value)} placeholder="—" className="h-7 rounded border border-line-100 bg-input-100 px-2 font-mono text-xs text-text-100 outline-none focus:border-accent" />
                  </label>
                  <label className="flex flex-col text-[11px] text-text-300">
                    Or after (s)
                    <input type="number" min={0} value={form.autoDumpAfterSec} onChange={(e) => set("autoDumpAfterSec", e.target.value)} placeholder="—" className="h-7 rounded border border-line-100 bg-input-100 px-2 font-mono text-xs text-text-100 outline-none focus:border-accent" />
                  </label>
                </div>
              ) : null}
              <div className="grid grid-cols-2 items-end gap-1.5 sm:grid-cols-3">
                <div className="flex min-w-0 flex-col">
                  <label className="mb-0.5 flex h-4 items-center text-left text-[11px] text-text-300">
                    Buy Amount
                    <span className="ml-auto tabular-nums text-text-200" title="Share of total supply this dev buy gets on the bonding curve">
                      {pct.toFixed(2)}% supply
                    </span>
                  </label>
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                    <img src="/solana.svg" alt="" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 object-contain" />
                    <input type="number" step="0.01" min={0} value={form.devBuySol} onChange={(e) => set("devBuySol", e.target.value)} className="flex h-8 w-full min-w-0 rounded-md border border-line-100 bg-bg-50 py-1 pl-7 pr-10 font-mono text-xs text-text-100 outline-none [appearance:textfield] focus:border-accent" />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-300">SOL</span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col">
                  <p className="mb-0.5 flex h-4 items-center text-left text-[11px] text-text-300">Quote</p>
                  <div className="relative min-w-0">
                    <button type="button" className="inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-2 text-xs font-medium text-text-100 transition-colors hover:border-line-200" aria-label="Launch quote token" title="SOL is the only quote on pump.fun">
                      {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                      <img src="/solana.svg" alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                      <span className="min-w-0 truncate">SOL</span>
                      <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-text-300" />
                    </button>
                  </div>
                </div>
                <div className="col-span-2 flex min-w-0 flex-col sm:col-span-1">
                  <div className="mb-0.5 hidden h-4 sm:block" />
                  <button type="button" onClick={onClose} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover sm:h-8">
                    <Save className="h-3.5 w-3.5 shrink-0" />
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {crop ? (
        <CropModal
          src={crop}
          onClose={() => setCrop(null)}
          onDone={(d) => {
            set("imageDataUrl", d);
            setCrop(null);
          }}
        />
      ) : null}
    </div>
  );
}
