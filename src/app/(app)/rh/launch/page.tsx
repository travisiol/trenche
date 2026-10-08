"use client";
/** Robinhood mode › Launch: a Pons V2 token with a dev buy and a bundle — each bundle wallet buys in its own
 *  transaction, fired with the launch and guarded by the sequencer so it lands right behind it (never before). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Rocket, Shuffle, X, Zap } from "lucide-react";
import { api, failureMessage, post, useGet } from "@/lib/api";
import { short } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxCard, BxInput, BxLabel, BxSeg, BxSelect, BxTextarea, cx } from "@/components/bx/ui";
import { Kv, eth, ethNum, squarePng, usdOf, useRhStatus, weiNum, type RhSettings } from "@/components/rh/common";
import { pushRhRecent } from "@/components/rh/recent";

type Meta = { token: string; name: string; symbol: string; logo: string | null; image: string | null; description: string; socials: { twitter: string; telegram: string; discord: string; website: string } };
type Form = { name: string; symbol: string; description: string; twitter: string; telegram: string; website: string; devBuyEth: string; creatorTaxBps: number; dev: string };
type Launched = { token: string; symbol: string; image: string | null; steps: string[]; bundle: { address: string; status: string; error: string | null }[] };

const DRAFT = "donchain.rh.launch";
const PONS_FEE = 0.0005;
/** gas reserve shown per transaction (a buy uses ~103k gas at ~0.02 gwei, the limit is reserved at 3× base fee) */
const GAS_EACH = 0.00002;

function loadDraft(): Partial<Form> & { bundle?: Record<string, string>; image?: string } {
  try {
    return JSON.parse(localStorage.getItem(DRAFT) ?? "{}");
  } catch {
    return {};
  }
}

export default function RhLaunchPage() {
  const settings = useGet<RhSettings>("/api/robinhood/settings", 0);
  // the form mounts once the defaults are read: its state starts from the draft + defaults (no setState in an effect)
  if (!settings.data) return <div className="p-6 text-sm text-text-300">{settings.error ? failureMessage(settings.error) : "Loading…"}</div>;
  return <LaunchForm defaults={settings.data} />;
}

function LaunchForm({ defaults }: { defaults: RhSettings }) {
  const router = useRouter();
  const status = useRhStatus(8000);
  const wallets = useMemo(() => status.data?.wallets ?? [], [status.data]);
  const groups = status.data?.groups ?? [];
  const ethUsd = status.data?.ethUsd ?? null;
  const [draft] = useState(loadDraft);
  const [form, setForm] = useState<Form>(() => ({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", dev: "", ...draft, devBuyEth: draft.devBuyEth ?? defaults.devBuyEth, creatorTaxBps: draft.creatorTaxBps ?? defaults.creatorTaxBps }));
  const [image, setImage] = useState(draft.image ?? "");
  const [presetLogo, setPresetLogo] = useState<string | null>(null);
  const [vampOf, setVampOf] = useState<string | null>(null);
  const [bundle, setBundle] = useState<Record<string, string>>(draft.bundle ?? {});
  const [filter, setFilter] = useState("all");
  const [each, setEach] = useState(defaults.bundleEth);
  const [range, setRange] = useState({ min: defaults.bundleEth, max: defaults.bundleEth });
  const [amountMode, setAmountMode] = useState<"each" | "range">("each");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Launched | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ?vamp=0x… (read from location: useSearchParams would empty the static page)
  useEffect(() => {
    const vamp = new URLSearchParams(window.location.search).get("vamp");
    if (vamp && /^0x[0-9a-fA-F]{40}$/.test(vamp)) {
      api<Meta>(`/api/robinhood/meta/${vamp}`)
        .then((m) => {
          setForm((f) => ({ ...f, name: m.name, symbol: m.symbol, description: m.description, twitter: m.socials.twitter, telegram: m.socials.telegram, website: m.socials.website }));
          setPresetLogo(m.logo && /^ipfs:\/\//.test(m.logo) ? m.logo : null);
          setImage(m.image ?? "");
          setVampOf(m.token);
          toast(`Vamped $${m.symbol}: name, logo, links copied`, "ok");
        })
        .catch((e) => toast(failureMessage(e), "err"));
    }
  }, []);
  // keep the draft (the image only when it is our own upload, not a vamped logo)
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ ...form, bundle, image: presetLogo ? undefined : image || undefined }));
    } catch {
      /* storage full: the draft is a convenience */
    }
  }, [form, bundle, image, presetLogo]);

  const set = (k: keyof Form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const dev = wallets.find((w) => w.address === form.dev) ?? wallets.find((w) => w.main);
  const candidates = wallets.filter((w) => w.address !== dev?.address && (filter === "all" || (filter === "none" ? !w.group : w.group === filter)));
  const picked = Object.entries(bundle).filter(([a]) => a !== dev?.address && wallets.some((w) => w.address === a));
  const num = (s: string) => Number(String(s).replace(",", "."));
  const devBuy = num(form.devBuyEth) || 0;
  const bundleTotal = picked.reduce((t, [, v]) => t + (num(v) || 0), 0);
  const devBal = weiNum(dev?.balanceWei);
  const devNeed = PONS_FEE + devBuy + GAS_EACH * 10;
  const short_ = picked.filter(([a, v]) => weiNum(wallets.find((w) => w.address === a)?.balanceWei) < (num(v) || 0) + GAS_EACH * 3);
  const badAmount = picked.some(([, v]) => !(num(v) > 0));

  const amountFor = () => {
    if (amountMode === "each") return each;
    const lo = num(range.min), hi = num(range.max);
    if (!(lo > 0) || !(hi >= lo)) return each;
    return String(Math.floor((lo + (hi - lo) * Math.random()) * 1e6) / 1e6 || lo);
  };
  const toggle = (a: string) =>
    setBundle((b) => {
      const n = { ...b };
      if (a in n) delete n[a];
      else n[a] = amountFor();
      return n;
    });
  const addShown = () =>
    setBundle((b) => {
      const n = { ...b };
      candidates.forEach((w) => {
        if (!(w.address in n) && Object.keys(n).length < 30) n[w.address] = amountFor();
      });
      return n;
    });
  const applyAmounts = () => setBundle((b) => Object.fromEntries(Object.keys(b).map((a) => [a, amountFor()])));

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      setImage(await squarePng(f));
      setPresetLogo(null);
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };

  const ready = !!form.name.trim() && !!form.symbol.trim() && !!image && !!dev && !badAmount && devBal >= devNeed && !short_.length && picked.length <= 30;
  const launch = async () => {
    if (!dev) return;
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const r = await post<Launched>("/api/robinhood/launch", {
        name: form.name,
        symbol: form.symbol,
        description: form.description,
        twitter: form.twitter,
        telegram: form.telegram,
        website: form.website,
        devBuyEth: form.devBuyEth,
        creatorTaxBps: form.creatorTaxBps,
        wallet: dev.address,
        ...(presetLogo ? { logo: presetLogo } : { imageDataUrl: image }),
        bundle: picked.map(([address, v]) => ({ address, eth: v.replace(",", ".") })),
      });
      setDone(r);
      pushRhRecent({ token: r.token, symbol: r.symbol, image: r.image });
      const landed = r.bundle.filter((b) => b.status === "landed" || b.status === "sent").length;
      toast(`$${r.symbol} launched${r.bundle.length ? ` · bundle ${landed}/${r.bundle.length}` : ""}`, "ok");
      setForm((f) => ({ ...f, name: "", symbol: "", description: "" }));
      setImage("");
      setPresetLogo(null);
      setVampOf(null);
      status.refresh();
      router.push(`/rh/token/${r.token}`);
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-text-100">Launch</h1>
            <p className="text-xs text-text-300">Pons V2 · Robinhood Chain · dev buy in the launch transaction, one transaction per bundle wallet</p>
          </div>
          {vampOf ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#ccff00]/30 bg-[#ccff00]/10 px-2 py-1 text-xs text-[#ccff00]">
              <Zap className="h-3.5 w-3.5" /> Vamp of {short(vampOf, 6, 4)}
              <button type="button" onClick={() => (setVampOf(null), setPresetLogo(null))} className="text-[#ccff00]/70 hover:text-[#ccff00]" title="Forget the source">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* ------------------------------------------------ token */}
          <BxCard title="Token" icon={<Rocket className="h-4 w-4 text-text-300" />} bodyClassName="px-5 pb-5">
            <div className="grid gap-4 md:grid-cols-[150px_minmax(0,1fr)]">
              <div>
                <BxLabel>Image</BxLabel>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    void pick(e.dataTransfer.files?.[0]);
                  }}
                  className={cx("relative flex aspect-square w-full max-w-[150px] items-center justify-center overflow-hidden rounded-md border text-text-300 transition-colors", drag ? "border-[#ccff00]" : image ? "border-line-100" : "border-dashed border-line-100 hover:border-[#ccff00]/50")}
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local data URL / ipfs gateway
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-xs">
                      <ImagePlus className="h-5 w-5" />
                      Drop or choose
                    </span>
                  )}
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
                {image ? (
                  <button type="button" onClick={() => (setImage(""), setPresetLogo(null))} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-text-300 hover:text-text-100">
                    <X className="h-3 w-3" /> Remove
                  </button>
                ) : null}
                {presetLogo ? <p className="mt-1 text-[10px] text-text-300">Same IPFS logo as the source</p> : null}
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
                  <div>
                    <BxLabel>Name</BxLabel>
                    <BxInput maxLength={34} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Token name" />
                  </div>
                  <div>
                    <BxLabel>Ticker</BxLabel>
                    <BxInput maxLength={11} value={form.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="TICKER" />
                  </div>
                </div>
                <div>
                  <BxLabel>Description</BxLabel>
                  <BxTextarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <BxInput value={form.twitter} onChange={(e) => set("twitter", e.target.value)} placeholder="X / Twitter link" />
                  <BxInput value={form.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="Telegram link" />
                  <BxInput value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="Website" />
                </div>
                <div>
                  <BxLabel>Dev wallet (launches, receives the creator fees)</BxLabel>
                  <BxSelect value={dev?.address ?? ""} onChange={(e) => set("dev", e.target.value)}>
                    {wallets.map((w) => (
                      <option key={w.address} value={w.address}>
                        {w.label} — {eth(w.balanceWei, 5)} ETH{w.main ? " · main" : ""}
                      </option>
                    ))}
                  </BxSelect>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <BxLabel>Dev buy (ETH)</BxLabel>
                    <BxInput inputMode="decimal" value={form.devBuyEth} onChange={(e) => set("devBuyEth", e.target.value)} placeholder="0.01" />
                  </div>
                  <div>
                    <BxLabel>Creator tax</BxLabel>
                    <BxSelect value={form.creatorTaxBps} onChange={(e) => set("creatorTaxBps", Number(e.target.value))}>
                      {[0, 100, 200, 300, 500, 1000].map((b) => (
                        <option key={b} value={b}>
                          {b / 100} %
                        </option>
                      ))}
                    </BxSelect>
                  </div>
                </div>
              </div>
            </div>
          </BxCard>

          {/* ------------------------------------------------ bundle */}
          <BxCard
            title={`Bundle · ${picked.length} wallet${picked.length === 1 ? "" : "s"}`}
            right={<span className="text-[11px] text-text-300">each its own transaction · max 30</span>}
            bodyClassName="px-5 pb-5"
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1">
                {[{ id: "all", name: "All" }, ...groups, { id: "none", name: "No group" }].map((g) => (
                  <button key={g.id} type="button" onClick={() => setFilter(g.id)} className={cx("rounded border px-2 py-1 text-[11px] transition-colors", filter === g.id ? "border-[#ccff00]/40 bg-[#ccff00]/10 text-[#ccff00]" : "border-line-100 text-text-300 hover:text-text-100")}>
                    {g.name}
                  </button>
                ))}
                <span className="flex-1" />
                <button type="button" onClick={addShown} className="rounded px-1.5 py-1 text-[11px] text-text-300 hover:bg-white/[0.04] hover:text-text-100">
                  Add shown
                </button>
                <button type="button" onClick={() => setBundle({})} className="rounded px-1.5 py-1 text-[11px] text-text-300 hover:bg-white/[0.04] hover:text-text-100">
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-line-100 bg-bg-100 px-3 py-2">
                <BxSeg
                  value={amountMode}
                  onChange={setAmountMode}
                  options={[
                    { value: "each", label: "Same each" },
                    { value: "range", label: "Random range" },
                  ]}
                />
                {amountMode === "each" ? (
                  <BxInput className="h-8 w-28" inputMode="decimal" value={each} onChange={(e) => setEach(e.target.value)} placeholder="ETH" />
                ) : (
                  <span className="flex items-center gap-1">
                    <BxInput className="h-8 w-24" inputMode="decimal" value={range.min} onChange={(e) => setRange((r) => ({ ...r, min: e.target.value }))} placeholder="Min" />
                    <span className="text-text-300">–</span>
                    <BxInput className="h-8 w-24" inputMode="decimal" value={range.max} onChange={(e) => setRange((r) => ({ ...r, max: e.target.value }))} placeholder="Max" />
                  </span>
                )}
                <BxButton size="sm" onClick={applyAmounts} disabled={!picked.length} title="Set this amount on every bundle wallet">
                  {amountMode === "range" ? <Shuffle className="h-3.5 w-3.5" /> : null} Apply to all
                </BxButton>
              </div>
              <div className="max-h-[330px] overflow-y-auto rounded-md border border-line-100 bg-bg-100">
                {!candidates.length ? <p className="px-3 py-3 text-xs text-text-300">{wallets.length <= 1 ? "Create bundle wallets in Portfolio first." : "No wallet in this group."}</p> : null}
                {candidates.map((w) => {
                  const on = w.address in bundle;
                  const v = bundle[w.address] ?? "";
                  const lacks = on && weiNum(w.balanceWei) < (num(v) || 0) + GAS_EACH * 3;
                  return (
                    <div key={w.address} className={cx("flex items-center gap-3 border-b border-line-50 px-3 py-1.5 text-xs last:border-b-0", on && "bg-[#ccff00]/[0.04]")}>
                      <input type="checkbox" className="pi-checkbox" checked={on} onChange={() => toggle(w.address)} aria-label={`Bundle ${w.label}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-text-100">{w.label}</span>
                        <span className="font-mono text-[10px] text-text-300">{short(w.address, 4, 4)}</span>
                      </span>
                      <span className={cx("w-24 text-right font-mono", lacks ? "text-decrease" : "text-text-300")} title={lacks ? "Not enough ETH for this buy + gas" : "Balance"}>
                        {eth(w.balanceWei, 5)}
                      </span>
                      {on ? (
                        <BxInput className="h-7 w-24 text-right text-xs" inputMode="decimal" value={v} onChange={(e) => setBundle((b) => ({ ...b, [w.address]: e.target.value }))} />
                      ) : (
                        <span className="w-24 text-right text-text-300">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs">
                <Kv k="Pons launch fee" v={`${PONS_FEE} ETH`} />
                <Kv k="Dev buy" v={`${ethNum(devBuy, 6)} ETH · in the launch tx`} />
                <Kv k={`Bundle (${picked.length})`} v={`${ethNum(bundleTotal, 6)} ETH · exempt from the snipe tax`} />
                <Kv k="Total" v={`${ethNum(PONS_FEE + devBuy + bundleTotal, 6)} ETH · ${usdOf(PONS_FEE + devBuy + bundleTotal, ethUsd)}`} strong />
                <Kv k="Dev wallet" v={<span className={devBal < devNeed ? "text-decrease" : undefined}>{`${ethNum(devBal, 6)} ETH${devBal < devNeed ? ` · needs ${ethNum(devNeed, 6)}` : ""}`}</span>} />
                {short_.length ? <p className="text-decrease">Not enough ETH on {short_.map(([a]) => wallets.find((w) => w.address === a)?.label ?? short(a)).join(", ")} — fund them from Portfolio › Disperse.</p> : null}
              </div>
              {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
              <BxButton variant="primary" disabled={busy || !ready} onClick={() => void launch()} className="h-10">
                {busy ? "Launching… (launch + bundle)" : `Launch $${form.symbol || "TICKER"}${picked.length ? ` + ${picked.length} wallet${picked.length === 1 ? "" : "s"}` : ""}`}
              </BxButton>
              <p className="text-[11px] leading-snug text-text-300">
                The token and curve addresses are known before sending (simulation). Every bundle buy is signed against that curve and sent with the launch as a conditional transaction: the sequencer only takes it once the curve exists, so it lands right behind the launch and never alone. If the launch fails, no buy is accepted and nothing is spent. Min-out = your other wallets land first, minus {defaults.slippagePct} % slippage.
              </p>
              {done ? (
                <div className="rounded-md border border-line-100 bg-bg-100 px-3 py-2 text-[11px] text-text-200">
                  {done.steps.map((s) => (
                    <p key={s}>{s}</p>
                  ))}
                </div>
              ) : null}
            </div>
          </BxCard>
        </div>
      </div>
    </div>
  );
}
