"use client";
/** Robinhood Chain: the dev wallet DONCHAIN made for it (own folder, encrypted with the vault passphrase), the
 *  Solana → Robinhood bridge (Relay: SOL from a vault wallet arrives as ETH), launches on Pons V2 and their trades. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Check, Copy, ExternalLink, FolderOpen, Gift, ImagePlus, KeyRound, Rocket, Send, X } from "lucide-react";
import { failureMessage, post, useGet } from "@/lib/api";
import { useBalances, useWallets } from "@/lib/store";
import { age, short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxCard, BxInput, BxLabel, BxModal, BxSelect, BxTextarea, cx } from "@/components/bx/ui";
import { TxLink } from "@/components/bx/Job";

type Bridge = {
  id: string;
  at: number;
  from: string;
  to: string;
  inLamports: string;
  outWei: string;
  status: "sending" | "deposited" | "pending" | "success" | "failure" | "refunded";
  solSignature: string | null;
  destTxs: string[];
  error: string | null;
  doneAt: number | null;
};
type Quote = { inLamports: string; outWei: string; minOutWei: string; outUsd: number | null; inUsd: number | null; feeLamports: string; impactPct: number | null; seconds: number };
type Position = {
  token: string;
  curve: string;
  name: string;
  symbol: string;
  image: string | null;
  txHash: string;
  at: number;
  devBuyWei: string;
  spentWei: string;
  receivedWei: string;
  balance: string;
  priceEth: number | null;
  mcapEth: number | null;
  valueEth: number | null;
  progress: number | null;
  graduated: boolean | null;
  pnlEth: number | null;
};
type Status = {
  address: string;
  balanceWei: string;
  escrowWei: string | null;
  ethUsd: number | null;
  positions: Position[];
  chainId: number;
  explorer: string;
  folder: string;
  keystore: string;
  bridges: Bridge[];
};

const eth = (wei: string | number | bigint | null | undefined, dp = 5) => {
  if (wei === null || wei === undefined) return "—";
  const n = Number(wei) / 1e18;
  return n === 0 ? "0" : n < 10 ** -dp ? n.toExponential(2) : n.toFixed(dp).replace(/\.?0+$/, "");
};
const ethNum = (n: number | null, dp = 5) => (n === null ? "—" : n === 0 ? "0" : Math.abs(n) < 10 ** -dp ? n.toExponential(2) : n.toFixed(dp).replace(/\.?0+$/, ""));
const PONS_PAGE = (t: string) => `https://www.ponsfamily.com/launchpad/${t}`;

function EthMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2 5 12.2 12 16.4l7-4.2L12 2Z" fill="currentColor" opacity=".9" />
      <path d="m5 13.6 7 9.4 7-9.4-7 4.2-7-4.2Z" fill="currentColor" opacity=".6" />
    </svg>
  );
}

function Copyable({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-text-200 hover:text-text-100"
      title="Copy"
    >
      <span className="truncate">{label ?? text}</span>
      {ok ? <Check className="h-3 w-3 shrink-0 text-increase" /> : <Copy className="h-3 w-3 shrink-0 text-text-300" />}
    </button>
  );
}

function EvmTx({ hash, explorer }: { hash: string; explorer: string }) {
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[11px] text-accent hover:underline">
      {short(hash, 4, 4)}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export default function RobinhoodPage() {
  const status = useGet<Status>("/api/robinhood", 6000);
  const s = status.data;
  const refresh = status.refresh;
  const [modal, setModal] = useState<"export" | "withdraw" | null>(null);
  const usdOf = (ethAmount: number | null) => (ethAmount !== null && s?.ethUsd ? usd(ethAmount * s.ethUsd, 2) : "—");
  const inFlight = (s?.bridges ?? []).some((b) => b.status === "sending" || b.status === "deposited" || b.status === "pending");
  // faster refresh while a bridge is filling
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => refresh(), 2000);
    return () => clearInterval(t);
  }, [inFlight, refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-[#ccff00]">
              <EthMark className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-text-100">Robinhood Chain</h1>
              <p className="text-xs text-text-300">Bridge SOL from your vault, launch on Pons V2 · chain id 4663 · gas in ETH</p>
            </div>
          </div>
        </div>

        {status.error && !s ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-sm text-decrease">{failureMessage(status.error)}</p> : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <BxCard title="Robinhood wallet" icon={<KeyRound className="h-4 w-4 text-text-300" />} bodyClassName="px-5 pb-5">
              {s ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <EthMark className="h-5 w-5 self-center text-text-200" />
                    <span className="text-[28px] font-semibold leading-9 text-text-100">{eth(s.balanceWei, 6)}</span>
                    <span className="text-sm text-text-300">ETH</span>
                    <span className="text-base font-medium text-text-100">{usdOf(Number(s.balanceWei) / 1e18)}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-text-300">Address</span>
                      <span className="flex min-w-0 items-center gap-2">
                        <Copyable text={s.address} label={short(s.address, 6, 6)} />
                        <a href={`${s.explorer}/address/${s.address}`} target="_blank" rel="noreferrer" className="text-text-300 hover:text-text-100" title="Explorer">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-text-300">Folder</span>
                      <span className="min-w-0 truncate font-mono text-[11px] text-text-200" title={s.folder}>
                        {s.folder}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-text-300">Key file</span>
                      <span className="font-mono text-[11px] text-text-200">eth-wallet.enc.json · encrypted with your vault passphrase</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <BxButton
                      onClick={async () => {
                        try {
                          await post("/api/robinhood/open-folder", {});
                        } catch (e) {
                          toast(failureMessage(e), "err");
                        }
                      }}
                    >
                      <FolderOpen className="h-4 w-4" /> Folder
                    </BxButton>
                    <BxButton onClick={() => setModal("export")}>
                      <KeyRound className="h-4 w-4" /> Export key
                    </BxButton>
                    <BxButton onClick={() => setModal("withdraw")}>
                      <Send className="h-4 w-4" /> Withdraw
                    </BxButton>
                  </div>
                </div>
              ) : (
                <p className="py-4 text-sm text-text-300">{status.loading ? "Opening the Robinhood wallet…" : "—"}</p>
              )}
            </BxCard>

            <BridgeCard status={s} onDone={() => status.refresh()} />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <LaunchCard status={s} onDone={() => status.refresh()} />
            <LaunchesCard status={s} onDone={() => status.refresh()} usdOf={usdOf} />
          </div>
        </div>
      </div>
      {modal === "export" && s ? <ExportModal onClose={() => setModal(null)} /> : null}
      {modal === "withdraw" && s ? <WithdrawModal onClose={() => setModal(null)} balanceWei={s.balanceWei} onDone={() => status.refresh()} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ bridge */

const BRIDGE_KEEP = 0.001;

function BridgeCard({ status, onDone }: { status: Status | null | undefined; onDone: () => void }) {
  const wallets = useWallets();
  const balances = useBalances();
  const live = useMemo(() => (wallets.data?.wallets ?? []).filter((w) => !w.archived), [wallets.data]);
  const balOf = (a: string) => Number(balances.data?.[a] ?? live.find((w) => w.address === a)?.sol ?? 0);
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const source = from || [...live].sort((a, b) => balOf(b.address) - balOf(a.address))[0]?.address || "";
  const amt = Number(amount.replace(",", "."));
  const seq = useRef(0);

  useEffect(() => {
    if (!source || !(amt > 0)) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const q = await post<Quote>("/api/robinhood/bridge/quote", { from: source, sol: amount.replace(",", ".") });
        if (my === seq.current) {
          setQuote(q);
          setQErr(null);
        }
      } catch (e) {
        if (my === seq.current) {
          setQuote(null);
          setQErr(failureMessage(e));
        }
      } finally {
        if (my === seq.current) setQuoting(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [source, amount, amt]);

  const bal = source ? balOf(source) : 0;
  const tooMuch = amt > 0 && amt + BRIDGE_KEEP > bal + 1e-12;
  const shownQuote = amt > 0 ? quote : null;

  const run = async () => {
    if (!shownQuote) return;
    setBusy(true);
    try {
      await post("/api/robinhood/bridge", { from: source, sol: amount.replace(",", "."), seenOutWei: shownQuote.outWei });
      toast(`Deposit confirmed on Solana — ETH arriving on Robinhood (~${shownQuote.seconds}s).`, "ok");
      setAmount("");
      setQuote(null);
      onDone();
      balances.refresh();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BxCard title="Bridge from Solana" icon={<ArrowRightLeft className="h-4 w-4 text-text-300" />} right={<span className="text-[11px] text-text-300">via Relay</span>} bodyClassName="px-5 pb-5">
      <div className="flex flex-col gap-3">
        <div>
          <BxLabel>From (vault wallet)</BxLabel>
          <BxSelect value={source} onChange={(e) => setFrom(e.target.value)}>
            {!live.length ? <option value="">No wallet in the vault</option> : null}
            {live.map((w) => (
              <option key={w.address} value={w.address}>
                {w.label || short(w.address)} — {sol(balOf(w.address))} SOL
              </option>
            ))}
          </BxSelect>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <BxLabel className="mb-0">Amount (SOL)</BxLabel>
            <div className="flex items-center gap-1">
              {[0.25, 0.5, 1].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(Math.max(0, Math.floor((p === 1 ? bal - BRIDGE_KEEP - 0.0002 : bal * p) * 1e6) / 1e6).toString())}
                  className="rounded px-1.5 py-0.5 text-[11px] text-text-300 hover:bg-white/[0.04] hover:text-text-100"
                >
                  {p === 1 ? "Max" : `${p * 100}%`}
                </button>
              ))}
            </div>
          </div>
          <BxInput inputMode="decimal" placeholder="0.1" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs">
          <Row k="To" v={status ? short(status.address, 6, 6) + " (Robinhood wallet)" : "—"} />
          <Row k="You receive" v={shownQuote ? `${eth(shownQuote.outWei, 6)} ETH${shownQuote.outUsd !== null ? ` · ${usd(shownQuote.outUsd, 2)}` : ""}` : quoting ? "quoting…" : "—"} strong />
          <Row k="Minimum" v={shownQuote ? `${eth(shownQuote.minOutWei, 6)} ETH` : "—"} />
          <Row k="Cost" v={shownQuote ? `${shownQuote.impactPct !== null ? `${Math.abs(shownQuote.impactPct).toFixed(2)} %` : "—"} · ~${shownQuote.seconds}s` : "—"} />
        </div>
        {tooMuch ? <p className="text-xs text-decrease">The wallet holds {sol(bal)} SOL; {BRIDGE_KEEP} SOL stays on it (rent + fee).</p> : null}
        {qErr && amt > 0 ? <p className="text-xs text-decrease">{qErr}</p> : null}
        <BxButton variant="primary" disabled={!shownQuote || busy || tooMuch || !source} onClick={run}>
          {busy ? "Depositing on Solana…" : `Bridge ${amt > 0 ? amt : ""} SOL → ETH`}
        </BxButton>
        <p className="text-[11px] leading-snug text-text-300">One way, direct: the vault wallet deposits to Relay, Relay pays the ETH to your Robinhood wallet. A failed fill is refunded in SOL by Relay.</p>

        {status?.bridges.length ? (
          <div className="mt-1 flex flex-col gap-1.5 border-t border-line-50 pt-3">
            <p className="text-[13px] font-medium text-text-100">History</p>
            {status.bridges.slice(0, 8).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line-100 bg-bg-100 px-3 py-2 text-xs">
                <span className="flex items-center gap-2">
                  <StatusPill s={b.status} />
                  <span className="font-mono text-text-100">{sol(Number(b.inLamports) / 1e9)} SOL</span>
                  <span className="text-text-300">→</span>
                  <span className="font-mono text-text-100">{eth(b.outWei, 5)} ETH</span>
                </span>
                <span className="flex items-center gap-2">
                  {b.solSignature ? <TxLink sig={b.solSignature} /> : null}
                  {b.destTxs[0] && status ? <EvmTx hash={b.destTxs[0]} explorer={status.explorer} /> : null}
                  <span className="text-text-300">{age(b.at)}</span>
                </span>
                {b.error ? <span className="w-full text-[11px] text-decrease">{b.error}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </BxCard>
  );
}

function StatusPill({ s }: { s: Bridge["status"] }) {
  const map: Record<Bridge["status"], [string, string]> = {
    sending: ["Sending", "bg-white/[0.06] text-text-200"],
    deposited: ["Deposited", "bg-accent/15 text-accent"],
    pending: ["Filling", "bg-accent/15 text-accent"],
    success: ["Arrived", "bg-increase/15 text-increase"],
    failure: ["Failed", "bg-decrease/15 text-decrease"],
    refunded: ["Refunded", "bg-white/[0.06] text-text-200"],
  };
  const [label, cls] = map[s];
  return <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{label}</span>;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-300">{k}</span>
      <span className={cx("font-mono tabular-nums", strong ? "text-text-100" : "text-text-200")}>{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ launch */

/** a dropped / chosen image, center-cropped to a 512×512 PNG */
async function squarePng(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Not an image."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LaunchCard({ status, onDone }: { status: Status | null | undefined; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", devBuyEth: "0.01", creatorTaxBps: 0 });
  const [image, setImage] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      setImage(await squarePng(f));
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const dev = Number(form.devBuyEth.replace(",", ".")) || 0;
  const bal = status ? Number(status.balanceWei) / 1e18 : 0;
  const need = 0.0005 + dev;
  const launch = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ token: string; symbol: string }>("/api/robinhood/launch", { ...form, imageDataUrl: image });
      toast(`$${r.symbol} launched on Robinhood: ${short(r.token, 6, 4)}`, "ok");
      setForm((f) => ({ ...f, name: "", symbol: "", description: "" }));
      setImage("");
      onDone();
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BxCard title="Launch on Robinhood" icon={<Rocket className="h-4 w-4 text-text-300" />} right={<span className="text-[11px] text-text-300">Pons V2</span>} bodyClassName="px-5 pb-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
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
            className={cx("relative flex aspect-square w-full max-w-[160px] items-center justify-center overflow-hidden rounded-md border text-text-300 transition-colors", drag ? "border-accent" : image ? "border-line-100" : "border-dashed border-line-100 hover:border-accent/50")}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL
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
            <button type="button" onClick={() => setImage("")} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-text-300 hover:text-text-100">
              <X className="h-3 w-3" /> Remove
            </button>
          ) : null}
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
          <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs">
            <Row k="Pons launch fee" v="0.0005 ETH" />
            <Row k="Dev buy" v={`${ethNum(dev, 6)} ETH (in the launch tx, no snipe tax)`} />
            <Row k="Needed (+ gas)" v={`${ethNum(need, 6)} ETH · wallet ${ethNum(bal, 6)}`} strong />
          </div>
          {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
          <BxButton variant="primary" disabled={busy || !form.name.trim() || !form.symbol.trim() || !image || !status} onClick={launch}>
            {busy ? "Launching…" : bal < need ? "Launch (bridge ETH first)" : "Launch on Robinhood"}
          </BxButton>
        </div>
      </div>
    </BxCard>
  );
}

/* ------------------------------------------------------------------ launches */

function LaunchesCard({ status, onDone, usdOf }: { status: Status | null | undefined; onDone: () => void; usdOf: (e: number | null) => string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [buyAmt, setBuyAmt] = useState<Record<string, string>>({});
  const escrow = status?.escrowWei ? Number(status.escrowWei) / 1e18 : 0;
  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast(await fn(), "ok");
      onDone();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  const positions = status?.positions ?? [];
  return (
    <BxCard
      title="Robinhood launches"
      icon={<Rocket className="h-4 w-4 text-text-300" />}
      right={
        <span className="flex items-center gap-2 text-xs">
          <span className="text-text-300">Creator fees</span>
          <span className="font-mono text-text-100">{ethNum(escrow, 6)} ETH</span>
          <BxButton size="sm" disabled={!(escrow > 0) || busy === "claim"} onClick={() => act("claim", async () => `Claimed ${eth((await post<{ amountWei: string }>("/api/robinhood/claim", {})).amountWei, 6)} ETH`)}>
            <Gift className="h-3.5 w-3.5" /> Claim
          </BxButton>
        </span>
      }
      bodyClassName="px-5 pb-5"
    >
      {!positions.length ? (
        <p className="py-6 text-sm text-text-300">No Robinhood launch yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {positions.map((p) => {
            const held = Number(p.balance) / 1e18;
            return (
              <div key={p.token} className="flex flex-col gap-2 rounded-md border border-line-100 bg-bg-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-[#ccff00]/40 bg-bg-50">
                      {/* eslint-disable-next-line @next/next/no-img-element -- ipfs */}
                      {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-text-100">{p.name}</span>
                        <span className="text-xs text-text-300">${p.symbol}</span>
                        {p.graduated ? <span className="rounded bg-increase/15 px-1 text-[10px] text-increase">graduated</span> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Copyable text={p.token} label={short(p.token, 6, 4)} />
                        <span className="text-[11px] text-text-300">{age(p.at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <a href={PONS_PAGE(p.token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-200 hover:text-text-100">
                      Pons <ExternalLink className="h-3 w-3" />
                    </a>
                    {status ? <EvmTx hash={p.txHash} explorer={status.explorer} /> : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <Stat k="MC" v={`${ethNum(p.mcapEth, 3)} ETH`} sub={usdOf(p.mcapEth)} />
                  <Stat k="Holding" v={held ? `${(held / 1e6).toFixed(2)}M` : "0"} sub={`${ethNum(p.valueEth, 5)} ETH`} />
                  <Stat k="PnL" v={`${p.pnlEth !== null && p.pnlEth > 0 ? "+" : ""}${ethNum(p.pnlEth, 5)} ETH`} sub={usdOf(p.pnlEth)} tone={p.pnlEth === null ? undefined : p.pnlEth >= 0 ? "up" : "down"} />
                  <div className="flex flex-col gap-1">
                    <span className="text-text-300">Curve</span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-[#ccff00]" style={{ width: `${Math.round((p.progress ?? 0) * 100)}%` }} />
                    </div>
                    <span className="text-[11px] text-text-300">{p.progress !== null ? `${(p.progress * 100).toFixed(1)} %` : "—"}</span>
                  </div>
                </div>
                {!p.graduated ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line-50 pt-2">
                    <BxInput className="h-7 w-24 text-xs" inputMode="decimal" placeholder="0.01" value={buyAmt[p.token] ?? ""} onChange={(e) => setBuyAmt((m) => ({ ...m, [p.token]: e.target.value }))} />
                    <BxButton size="sm" variant="primary" disabled={!!busy || !(Number((buyAmt[p.token] ?? "").replace(",", ".")) > 0)} onClick={() => act(`buy-${p.token}`, async () => (await post("/api/robinhood/trade", { token: p.token, side: "buy", eth: (buyAmt[p.token] ?? "").replace(",", ".") }), `Bought $${p.symbol}`))}>
                      Buy ETH
                    </BxButton>
                    <span className="mx-1 h-4 w-px bg-line-100" />
                    {[25, 50, 100].map((pct) => (
                      <BxButton key={pct} size="sm" variant={pct === 100 ? "danger" : "secondary"} disabled={!!busy || !(held > 0)} onClick={() => act(`sell-${p.token}-${pct}`, async () => `Sold ${pct} % → ${eth((await post<{ ethOut: string }>("/api/robinhood/trade", { token: p.token, side: "sell", percent: pct })).ethOut, 6)} ETH`)}>
                        Sell {pct} %
                      </BxButton>
                    ))}
                    {busy?.endsWith(p.token) || busy?.includes(p.token) ? <span className="text-[11px] text-text-300">sending…</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </BxCard>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="flex flex-col">
      <span className="text-text-300">{k}</span>
      <span className={cx("font-mono", tone === "up" ? "text-increase" : tone === "down" ? "text-decrease" : "text-text-100")}>{v}</span>
      {sub ? <span className="text-[11px] text-text-300">{sub}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ modals */

function ExportModal({ onClose }: { onClose: () => void }) {
  const [pass, setPass] = useState("");
  const [key, setKey] = useState<{ address: string; privateKey: string; path: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <BxModal open onClose={onClose} title="Export Robinhood key" width={480}>
      <div className="flex flex-col gap-3 p-4">
        {!key ? (
          <>
            <p className="text-xs text-text-300">Your vault passphrase decrypts the key. Anyone with it controls the wallet.</p>
            <BxInput type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Vault passphrase" onKeyDown={(e) => e.key === "Enter" && pass && document.getElementById("rh-export-go")?.click()} />
            {err ? <p className="text-xs text-decrease">{err}</p> : null}
            <BxButton
              id="rh-export-go"
              variant="primary"
              disabled={!pass || busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  setKey(await post("/api/robinhood/export", { passphrase: pass }));
                } catch (e) {
                  setErr(failureMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reveal key
            </BxButton>
          </>
        ) : (
          <>
            <BxLabel>Address</BxLabel>
            <Copyable text={key.address} />
            <BxLabel>Private key</BxLabel>
            <div className="rounded-md border border-line-100 bg-bg-100 px-3 py-2 break-all">
              <Copyable text={key.privateKey} />
            </div>
            <p className="text-[11px] text-text-300">Imports into MetaMask / Rabby as a private key. Encrypted copy: {key.path}</p>
          </>
        )}
      </div>
    </BxModal>
  );
}

function WithdrawModal({ onClose, balanceWei, onDone }: { onClose: () => void; balanceWei: string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <BxModal open onClose={onClose} title="Withdraw ETH (Robinhood Chain)" width={480}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>To (0x address on Robinhood Chain)</BxLabel>
          <BxInput value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <BxLabel className="mb-0">Amount (ETH)</BxLabel>
            <button type="button" onClick={() => setAmount("max")} className="text-[11px] text-text-300 hover:text-text-100">
              Max ({eth(balanceWei, 6)})
            </button>
          </div>
          <BxInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01" />
        </div>
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton
          variant="primary"
          disabled={!/^0x[0-9a-fA-F]{40}$/.test(to) || !amount || busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await post<{ valueWei: string }>("/api/robinhood/withdraw", { to, amount });
              toast(`Sent ${eth(r.valueWei, 6)} ETH`, "ok");
              onDone();
              onClose();
            } catch (e) {
              setErr(failureMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : "Send"}
        </BxButton>
      </div>
    </BxModal>
  );
}
