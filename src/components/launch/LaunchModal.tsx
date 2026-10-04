"use client";
/** Block X "Launch Token" modal, 1:1 from design/blockx/launch-token-modal.html + BEHAVIOUR.md §4.6, bound to a LaunchForm draft.
 *  Omitted on purpose (not supported by this server): Global Fee toggle, the X "Post" composer, the ASCII image generator,
 *  pump.fun option chips Holder rewards / Off-chain / UsePaid / Fee sharing, and every launchpad but Pump.fun. */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardPaste, Copy, Crop, Hash, KeyRound, Plus, Save, Trash2, Upload, Wallet, X } from "lucide-react";
import type { JobCreated, TokenInfo, WalletInfo, WalletsGenerateResponse } from "@/lib/types";
import { failureMessage, get, isApiFailure, post, waitJob } from "@/lib/api";
import { refreshVaultDependents } from "@/lib/store";
import { isMint, short, sol } from "@/lib/format";
import { mintAddressOfSecret } from "@/lib/base58";
import { toast } from "@/components/ui";
import { BxButton, BxModal, BxSwitch, cx } from "@/components/bx/ui";
import { CropModal, urlToDataUrl } from "./ImageCrop";
import { useLaunchCalc } from "./calc";
import { EMPTY_FORM, taskBuyFor, taskWallets, type LaunchForm } from "./model";

const input = "flex h-10 w-full px-3 py-2 text-sm text-text-100 disabled:cursor-not-allowed disabled:opacity-50 rounded-md border border-line-100 bg-bg-50 outline-none placeholder:text-text-300 focus:border-accent";
const PADS: { name: string; file: string }[] = [
  { name: "Bonk", file: "bonk" },
  { name: "StonkFun", file: "stonkfun" },
  { name: "Bags", file: "bags" },
  { name: "AGENCY", file: "agency" },
  { name: "OTC", file: "otc" },
];
const HIDE_UNDER = 0.01;

type Props = {
  open: boolean;
  /** called on ✕, Escape, backdrop and Save — the caller autosaves the draft */
  onClose: () => void;
  form: LaunchForm;
  onChange: (f: LaunchForm) => void;
  wallets: WalletInfo[];
  balances: Record<string, string | null> | null;
};

export function LaunchModal(props: Props) {
  if (!props.open) return null;
  return <LaunchModalBody {...props} />;
}

function LaunchModalBody({ onClose, form, onChange, wallets, balances }: Props) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const [clone, setClone] = useState("");
  const [cloneBusy, setCloneBusy] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [hideSmall, setHideSmall] = useState(true);
  const [creating, setCreating] = useState(false);
  const [crop, setCrop] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [secretErr, setSecretErr] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** latest form for async handlers (the mint grind can take minutes: apply its result on what the user typed meanwhile) */
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => onChange({ ...form, [k]: v });
  const dev = wallets.find((w) => w.address === form.devWallet) ?? null;
  const balOf = (a: string) => Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0;
  const bundleSols = form.tasks.filter((t) => t.type === "bundle").flatMap((t) => taskWallets(t, wallets).map((a) => taskBuyFor(t, a)));
  const calc = useLaunchCalc(Number(form.devBuySol) || 0, bundleSols);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cloneOpen || crop) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, cloneOpen, crop]);

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
      onChange({ ...form, name: t.name ?? form.name, symbol: t.symbol ?? form.symbol, description: t.description ?? "", twitter: t.twitter ?? "", telegram: t.telegram ?? "", website: t.website ?? "", imageDataUrl: img });
      toast("Cloned from Pump.fun", "ok");
      setCloneOpen(false);
      setClone("");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setCloneBusy(false);
    }
  };
  const createDevWallet = async () => {
    setCreating(true);
    try {
      const r = await post<WalletsGenerateResponse>("/api/wallets/generate", { count: 1, label: "Dev" });
      refreshVaultDependents();
      const a = r.addresses?.[0];
      if (a) set("devWallet", a);
      setWalletOpen(false);
      toast("Developer wallet created", "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setCreating(false);
    }
  };
  /** "Fetch mint address": POST /api/launch/mint grinds and reserves a …pump address (job); while that route is not
   *  served the suffix is searched at launch time by /api/launch/prepare instead. Clicking again releases it. */
  const fetchMint = async () => {
    if (form.reservedMint) {
      post(`/api/launch/mint/${form.reservedMint}/release`, {}).catch(() => {});
      onChange({ ...form, reservedMint: "", mintAddress: "", vanity: "" });
      return;
    }
    if (form.vanity) return set("vanity", "");
    setFetching(true);
    try {
      // pump.fun vanity mints end in lowercase "pump": the grind is case-sensitive (≈ 58⁴ keys, well under a minute on a desktop)
      const r = await post<JobCreated>("/api/launch/mint", { suffix: "pump", caseSensitive: true, timeoutMs: 600_000 });
      toast("Reserving a …pump address — grinding keypairs", "info");
      const job = await waitJob(r.jobId, 610_000);
      const mint = typeof job.extra?.mint === "string" ? job.extra.mint : null;
      if (job.error || !mint) throw new Error(job.error ?? (job.done ? "No mint address came back" : "Still grinding — try again in a moment"));
      const cur = formRef.current;
      if (cur.mintSecret) {
        // a keypair was imported while grinding: keep it, hand the address back to the pool
        post(`/api/launch/mint/${mint}/release`, {}).catch(() => {});
        return toast(`Reserved ${short(mint, 6, 6)} released — this draft launches on the imported keypair`, "info");
      }
      onChange({ ...cur, reservedMint: mint, mintAddress: mint, vanity: "" });
      toast(`Reserved ${short(mint, 6, 6)}`, "ok");
    } catch (e) {
      if (isApiFailure(e) && (e.kind === "missing" || e.status === 404 || e.status === 405)) {
        set("vanity", "pump");
        toast("Mint pool not served yet — a …pump address will be searched when you launch", "info");
      } else toast(failureMessage(e), "err");
    } finally {
      setFetching(false);
    }
  };
  const applyMintSecret = () => {
    try {
      const address = mintAddressOfSecret(secret);
      onChange({ ...form, mintSecret: secret.trim(), mintAddress: address, vanity: "" });
      setSecret("");
      setSecretErr(null);
      setImportOpen(false);
    } catch (e) {
      setSecretErr(e instanceof Error ? e.message : String(e));
    }
  };
  const caseBtn = (m: "AB" | "ab" | "Ab") => set("symbol", m === "AB" ? form.symbol.toUpperCase() : m === "ab" ? form.symbol.toLowerCase() : form.symbol.charAt(0).toUpperCase() + form.symbol.slice(1).toLowerCase());
  const listed = wallets.filter((w) => !hideSmall || balOf(w.address) >= HIDE_UNDER || w.address === form.devWallet);

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0" style={{ background: "var(--modal-overlay)" }} aria-label="Save and close launch dialog" onClick={onClose} />
      <div className="relative z-[201] flex w-full sm:max-w-[90vw] md:max-w-[620px]">
        <div role="dialog" aria-modal="true" aria-labelledby="launch-token-title" className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border border-x-0 border-b-0 border-line-100 bg-bg-100 shadow-lg sm:h-auto sm:max-h-[90vh] sm:rounded-lg sm:border">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-50 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <h2 id="launch-token-title" className="text-base font-semibold text-text-100">
                Launch<span className="hidden sm:inline"> Token</span>
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" aria-label="Clone metadata" title="Clone metadata" onClick={() => setCloneOpen(true)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-2.5 text-xs font-medium text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100">
                <Copy className="h-3.5 w-3.5" />
                Clone
              </button>
              <div className="relative">
                <button type="button" title="Select developer wallet" onClick={() => setWalletOpen((o) => !o)} className={cx("inline-flex h-8 items-center gap-1.5 rounded-md border bg-bg-50 px-2.5 text-xs transition-colors hover:bg-white/[0.04]", dev ? "border-accent/40" : "border-line-100")}>
                  <Wallet className="h-3.5 w-3.5 shrink-0 text-text-300" />
                  <span className={cx("max-w-28 truncate", dev ? "text-text-100" : "text-text-300")}>{dev ? dev.label || short(dev.address) : "No wallet"}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-text-300" />
                </button>
                {walletOpen ? (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setWalletOpen(false)} />
                    <div className="absolute right-0 top-9 z-20 w-72 rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
                      <button type="button" disabled={creating} onClick={createDevWallet} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-accent hover:bg-hover-100 disabled:opacity-50">
                        <Plus className="h-3.5 w-3.5" /> {creating ? "Creating…" : "Create new developer wallet"}
                      </button>
                      <div className="my-1 h-px bg-line-50" />
                      <div className="max-h-56 overflow-y-auto">
                        {!listed.length ? <p className="px-2 py-3 text-xs text-text-300">{wallets.length ? `No wallets above ${HIDE_UNDER} SOL` : "No wallets yet"}</p> : null}
                        {listed.map((w) => (
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
                            <span className="ml-auto shrink-0 font-mono text-text-300">{sol(balOf(w.address))} SOL</span>
                          </button>
                        ))}
                      </div>
                      <div className="my-1 h-px bg-line-50" />
                      <label className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-text-300">
                        <input type="checkbox" className="pi-checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} />
                        Hide under {HIDE_UNDER} SOL
                      </label>
                    </div>
                  </>
                ) : null}
              </div>
              <button type="button" aria-label="Clear form" title="Clear form" onClick={() => onChange({ ...EMPTY_FORM, id: form.id, devWallet: form.devWallet, tipSol: form.tipSol, presetIndex: form.presetIndex, updatedAt: Date.now() })} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label="Save and close" title="Save and close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
              <div className="mx-auto w-full max-w-3xl px-3 py-2">
                <div className="flex gap-2 pb-2.5">
                  <div className="min-w-0 flex-[6]">
                    <label htmlFor="launch-token-name" className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                      <span>Name</span>
                    </label>
                    <input id="launch-token-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Token name" maxLength={32} className={input} type="text" />
                  </div>
                  <div className="min-w-0 flex-[4]">
                    <label htmlFor="launch-token-symbol" className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                      <span>Symbol</span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-flex overflow-hidden rounded border border-line-100">
                          {(["AB", "ab", "Ab"] as const).map((m) => (
                            <button key={m} type="button" disabled={!form.symbol} onClick={() => caseBtn(m)} title={m === "AB" ? "Uppercase" : m === "ab" ? "Lowercase" : "Capitalize first letter"} className="h-5 border-l border-line-100 px-1.5 text-[10px] font-medium leading-none text-text-300 first:border-l-0 hover:bg-white/[0.04] hover:text-text-100 disabled:opacity-40">
                              {m}
                            </button>
                          ))}
                        </span>
                      </span>
                    </label>
                    <input id="launch-token-symbol" value={form.symbol} onChange={(e) => set("symbol", e.target.value)} placeholder="Symbol" maxLength={10} className={input} type="text" />
                  </div>
                </div>
                <div className="pb-2.5">
                  <label htmlFor="launch-token-description" className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                    <span>Description</span>
                  </label>
                  <textarea id="launch-token-description" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Token description" rows={form.description.length > 80 ? 3 : 1} className={cx(input, "h-auto min-h-10 resize-none")} />
                </div>
                <div className="pb-2.5">
                  <label htmlFor="launch-website" className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                    <span>Website</span>
                  </label>
                  <input id="launch-website" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://example.com" className={input} type="url" />
                </div>
                <div className="flex gap-2 pb-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 pb-0.5">
                      <label htmlFor="launch-post" className="text-sm text-text-100">
                        X (Twitter)
                      </label>
                    </div>
                    <input id="launch-post" value={form.twitter} onChange={(e) => set("twitter", e.target.value)} placeholder="https://x.com/" className={input} type="text" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label htmlFor="launch-telegram" className="flex items-center justify-between gap-2 pb-0.5 text-sm text-text-100">
                      <span>Telegram</span>
                    </label>
                    <input id="launch-telegram" value={form.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="https://t.me/" className={input} type="text" />
                  </div>
                </div>

                <div className="rounded-md pb-1.5 transition-colors">
                  <div className="pb-1 text-sm text-text-100">Select Image</div>
                  <div className="relative w-full overflow-hidden">
                    <div
                      tabIndex={0}
                      onClick={() => !form.imageDataUrl && fileRef.current?.click()}
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
                      className={cx("flex h-16 w-full items-center justify-center gap-3 rounded-md border border-dashed px-3 text-xs", dragOver ? "border-accent text-text-100" : form.imageDataUrl ? "border-line-100 text-text-200" : "cursor-pointer border-line-100 text-text-300")}
                    >
                      {form.imageDataUrl ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                          <img src={form.imageDataUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                          <span className="truncate">Drag &amp; drop another image to replace it, or Ctrl+V</span>
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
                  <button type="button" onClick={paste} title="Paste image (Ctrl+V)" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3 text-xs text-text-200 hover:bg-white/[0.04]">
                    <ClipboardPaste className="h-4 w-4" />
                    Paste
                  </button>
                  {form.imageDataUrl ? (
                    <>
                      <button type="button" onClick={() => setCrop(form.imageDataUrl)} title="Crop the image" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3 text-xs text-text-200 hover:bg-white/[0.04]">
                        <Crop className="h-4 w-4" />
                        Crop
                      </button>
                      <button type="button" onClick={() => set("imageDataUrl", "")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3 text-xs text-text-200 hover:bg-white/[0.04]">
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>

                <div className="pb-2.5">
                  <div className="w-full rounded-lg border border-line-100 bg-bg-50 p-1">
                    <div className="flex items-stretch gap-1.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex gap-1.5">
                          <button type="button" title="Pump.fun" className="relative min-w-0 flex-1 rounded-md border px-2 py-1.5 ring-1 ring-offset-0 transition-all" style={{ borderColor: "rgba(82, 212, 143, 0.4)", backgroundColor: "rgba(82, 212, 143, 0.1)" }}>
                            <span className="flex items-center justify-center gap-1.5 text-xs">
                              <span className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[3px]">
                                {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                                <img src="/launchpads/pumpfun.svg" alt="" draggable={false} className="size-full object-contain object-center" title="Pump.fun" />
                              </span>
                              <span className="truncate font-medium text-text-100">Pump.fun</span>
                            </span>
                          </button>
                          {PADS.slice(0, 3).map((p) => (
                            <PadChip key={p.name} pad={p} />
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          {PADS.slice(3).map((p) => (
                            <PadChip key={p.name} pad={p} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pb-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className={cx("inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-xs transition-colors", form.cashback ? "border-accent/40 bg-accent/15 text-text-100" : "border-line-100 bg-bg-50 text-text-200 hover:bg-white/[0.04]")} title="Sets pump.fun's creator cashback flag on the token — the only launch option this server supports">
                      <input type="checkbox" className="pi-checkbox" checked={form.cashback} onChange={(e) => set("cashback", e.target.checked)} />
                      Cashback
                    </label>
                  </div>
                </div>

                <div className="pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button type="button" disabled={!!form.mintSecret || fetching} onClick={fetchMint} className={cx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40", form.vanity || form.reservedMint ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200")}>
                      <Hash className="h-3.5 w-3.5 shrink-0" />
                      {fetching ? "Reserving…" : form.reservedMint ? "Release mint address" : "Fetch mint address"}
                    </button>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-300" title={form.reservedMint || form.mintAddress || undefined}>{form.mintSecret ? `Launches on ${form.mintAddress} (imported keypair)` : form.reservedMint ? form.reservedMint : form.vanity ? "A …pump address is searched when you launch" : "Reserves a …pump address from the pool"}</span>
                    {form.mintSecret ? (
                      <button type="button" title="Forget the imported mint keypair" onClick={() => onChange({ ...form, mintSecret: "", mintAddress: "" })} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-2.5 text-xs text-text-200 transition-colors hover:bg-white/[0.04]">
                        <X className="h-3.5 w-3.5 shrink-0" />
                        <span className="hidden sm:inline">Remove</span>
                      </button>
                    ) : (
                      <button type="button" title="Import your own mint keypair" onClick={() => setImportOpen((o) => !o)} className={cx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors hover:bg-white/[0.04]", importOpen ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200")}>
                        <KeyRound className="h-3.5 w-3.5 shrink-0" />
                        <span className="hidden sm:inline">Import</span>
                      </button>
                    )}
                  </div>
                  {importOpen && !form.mintSecret ? (
                    <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-50 p-2">
                      <label htmlFor="launch-mint-secret" className="text-[11px] text-text-300">
                        Mint private key
                      </label>
                      <div className="flex gap-1.5">
                        <input id="launch-mint-secret" type="password" autoComplete="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyMintSecret()} placeholder="Base58 secret key or [1,2,3,…]" className={cx(input, "h-8 font-mono text-xs")} />
                        <button type="button" disabled={!secret.trim()} onClick={applyMintSecret} className="inline-flex h-8 shrink-0 items-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
                          Use mint
                        </button>
                      </div>
                      {secretErr ? <p className="text-[11px] text-decrease">{secretErr}</p> : null}
                      <p className="text-[11px] text-text-300">The mint keypair is saved with this draft on this machine and signs the create transaction — this launch will use its address instead of a generated one.</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-line-50 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="mb-1.5 flex min-h-8 flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5" title="Dump all wallets when net external volume reaches this SOL amount">
                  <label htmlFor="launch-auto-dump-threshold" className="shrink-0 text-[11px] text-text-300">
                    Auto Dump
                  </label>
                  <BxSwitch checked={form.sellOnExternalEnabled} onChange={(v) => set("sellOnExternalEnabled", v)} />
                  {form.sellOnExternalEnabled ? (
                    <div className="relative">
                      <input id="launch-auto-dump-threshold" inputMode="decimal" value={form.sellOnExternalThreshold} onChange={(e) => set("sellOnExternalThreshold", e.target.value)} placeholder="0" className="h-7 w-24 rounded-md border border-line-100 bg-bg-50 px-2 pr-9 font-mono text-[11px] text-text-100 outline-none focus:border-accent" />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-300">SOL</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-end gap-1.5" title={form.autoDevSellMode === "ms" ? "Sell 100% of the developer wallet this many milliseconds after the token goes live" : "Sell 100% of the developer wallet when the market cap reaches this USD value"}>
                  <label htmlFor="launch-auto-dev-sell-value" className="shrink-0 text-[11px] text-text-300">
                    Auto Dev Sell
                  </label>
                  <BxSwitch checked={form.autoDevSellEnabled} onChange={(v) => set("autoDevSellEnabled", v)} />
                  {form.autoDevSellEnabled ? (
                    <>
                      <div className="flex h-7 items-center gap-0.5 rounded-md border border-line-100 bg-input-100 p-0.5">
                        {(["ms", "mc"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => set("autoDevSellMode", m)} className={cx("h-full rounded px-2 text-[10px] font-medium uppercase transition-colors", form.autoDevSellMode === m ? "bg-btn-secondary text-accent" : "text-text-300 hover:text-text-100")}>
                            {m}
                          </button>
                        ))}
                      </div>
                      <div className="relative">
                        <input id="launch-auto-dev-sell-value" inputMode="decimal" value={form.autoDevSellValue} onChange={(e) => set("autoDevSellValue", e.target.value)} placeholder={form.autoDevSellMode === "ms" ? "1000" : "50000"} className="h-7 w-24 rounded-md border border-line-100 bg-bg-50 px-2 pr-7 font-mono text-[11px] text-text-100 outline-none focus:border-accent" />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-300">{form.autoDevSellMode === "ms" ? "ms" : "$"}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 items-end gap-1.5 sm:grid-cols-3">
                <div className="flex min-w-0 flex-col">
                  <label htmlFor="launch-buy-amount" className="mb-0.5 flex h-4 items-center text-left text-[11px] text-text-300">
                    Buy Amount
                    <span className="ml-auto tabular-nums text-text-200" title={`Share of total supply this dev buy gets on the bonding curve${calc.source === "local" ? " (fresh-curve formula)" : ""}`}>
                      {calc.dev.supplyPct.toFixed(2)}% supply
                    </span>
                  </label>
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                    <img src="/solana.svg" alt="" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 object-contain" />
                    <input id="launch-buy-amount" inputMode="decimal" title="Buy amount in SOL" placeholder="0" value={form.devBuySol} onChange={(e) => set("devBuySol", e.target.value.replace(/[^0-9.]/g, ""))} className="flex h-8 w-full min-w-0 rounded-md border border-line-100 bg-bg-50 py-1 pl-7 pr-10 text-xs text-text-100 outline-none [appearance:textfield] focus:border-accent" type="text" />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-300">SOL</span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col">
                  <p className="mb-0.5 flex h-4 items-center text-left text-[11px] text-text-300">Quote</p>
                  <div className="relative min-w-0">
                    <button id="launch-quote" type="button" aria-haspopup="listbox" aria-expanded={false} aria-label="Launch quote token" title="SOL is the only quote on pump.fun" className="inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-2 text-xs font-medium text-text-100 transition-colors hover:border-line-200">
                      {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                      <img src="/solana.svg" alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                      <span className="min-w-0 truncate">SOL</span>
                      <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-text-300 transition-transform" />
                    </button>
                  </div>
                </div>
                <div className="col-span-2 flex min-w-0 flex-col sm:col-span-1">
                  <div className="mb-0.5 hidden h-4 sm:block" aria-hidden="true" />
                  <button type="button" onClick={onClose} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:h-8">
                    <Save className="h-3.5 w-3.5 shrink-0" />
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BxModal open={cloneOpen} onClose={() => setCloneOpen(false)} title="Clone token metadata" width={440}>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-text-300">Paste a contract address — name, symbol, image, and socials.</p>
          <input value={clone} onChange={(e) => setClone(e.target.value)} placeholder="So1…" autoFocus spellCheck={false} className={cx(input, "h-9 font-mono text-xs")} onKeyDown={(e) => e.key === "Enter" && doClone()} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line-50 px-4 py-3">
          <BxButton onClick={() => setCloneOpen(false)}>Cancel</BxButton>
          <BxButton variant="primary" disabled={!clone.trim() || cloneBusy} onClick={doClone}>
            {cloneBusy ? "Cloning…" : "Clone"}
          </BxButton>
        </div>
      </BxModal>

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

/** Launchpads Block X offers that this server does not: same chip, disabled, no icon asset shipped. */
function PadChip({ pad }: { pad: { name: string; file: string } }) {
  return (
    <button type="button" disabled title={`${pad.name} — not available in DONCHAIN (Pump.fun only)`} className="relative min-w-0 flex-1 cursor-not-allowed rounded-md border border-line-100 px-2 py-1.5 opacity-40 transition-all">
      <span className="flex items-center justify-center gap-1.5 text-xs">
        <span className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-line-200 text-[9px] font-semibold text-text-200">{pad.name.slice(0, 1)}</span>
        <span className="truncate font-medium text-text-100">{pad.name}</span>
      </span>
    </button>
  );
}
