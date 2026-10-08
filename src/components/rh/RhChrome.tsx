"use client";
/** The chain switch, and the Robinhood versions of the Shell's strip, bottom bar, search and Vamp: in Robinhood mode
 *  nothing Solana shows (no SOL price, no Solana RPC, no pump.fun search). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, ChevronDown, History, Search, Settings, SlidersHorizontal, Zap } from "lucide-react";
import { failureMessage, api, useGet } from "@/lib/api";
import { short } from "@/lib/format";
import { BxButton, BxInput, BxModal, cx } from "@/components/bx/ui";
import { RhMark, TokenAvatar, usdOf } from "./common";
import { chainHome, clearRhRecent, rememberChain, useRhRecent, type Chain } from "./recent";

const DOCS_URL = "https://github.com/travisiol/trench#readme";

export function ChainSwitch({ chain }: { chain: Chain }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const go = (c: Chain) => {
    setOpen(false);
    rememberChain(c);
    if (c !== chain) router.push(chainHome(c));
  };
  const items: { id: Chain; label: string; icon: React.ReactNode }[] = [
    {
      id: "solana",
      label: "Solana",
      icon: (
        // eslint-disable-next-line @next/next/no-img-element -- static asset
        <img src="/solana.svg" alt="" width={16} height={16} className="h-4 w-4 object-contain" />
      ),
    },
    { id: "robinhood", label: "Robinhood", icon: <RhMark className="h-4 w-4" /> },
  ];
  const cur = items.find((i) => i.id === chain)!;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={cx("flex h-7 items-center gap-1.5 rounded-md border bg-bg-50 px-2 text-xs text-text-200 transition-colors hover:bg-white/[0.04]", chain === "robinhood" ? "border-[#ccff00]/40" : "border-line-100")} title="Switch chain">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{cur.icon}</span>
        <span>{cur.label}</span>
        <ChevronDown className={cx("h-3 w-3 text-text-300 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[120]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-[130] w-56 rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
            {items.map((i) => (
              <button key={i.id} type="button" onClick={() => go(i.id)} className={cx("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/[0.04]", i.id === chain ? "text-text-100" : "text-text-200")}>
                <span className="flex h-4 w-4 items-center justify-center">{i.icon}</span>
                <span className="flex-1">
                  {i.label}
                  <span className="block text-[11px] text-text-300">{i.id === "solana" ? "pump.fun · SOL" : "Pons V2 · ETH · chain 4663"}</span>
                </span>
                {i.id === chain ? <Check className="h-3.5 w-3.5 text-accent" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function RhRecentStrip() {
  const recent = useRhRecent();
  const [hidden, setHidden] = useState(false);
  return (
    <div className="flex h-7 items-center gap-2 border-t border-line-50 bg-bg-50 px-4 py-[3px]">
      <button type="button" className="inline-flex h-3.5 w-3.5 items-center justify-center text-text-300 transition-colors hover:text-text-100" title="Clear recently viewed" onClick={() => clearRhRecent()}>
        <Settings className="h-3.5 w-3.5" />
      </button>
      <div className="h-3 w-px shrink-0 bg-line-200" />
      <button type="button" onClick={() => setHidden((h) => !h)} className={cx("transition-colors hover:text-text-100", hidden ? "text-text-300" : "text-text-100")} title={hidden ? "Show recently viewed" : "Hide recently viewed"}>
        <History className="h-3 w-3" />
      </button>
      <div className="h-3 w-px shrink-0 bg-line-200" />
      <div className="flex h-[18px] w-[42px] shrink-0 items-center justify-center">
        <RhMark className="h-3.5 w-3.5" />
      </div>
      {!recent.length || hidden ? (
        <div className="flex h-[22px] flex-1 items-center text-xs text-text-300">{hidden ? "Recently viewed hidden" : "No recently viewed Robinhood tokens"}</div>
      ) : (
        <div className="no-scrollbar flex h-[22px] min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {recent.map((t) => (
            <Link key={t.token} href={`/rh/token/${t.token}`} className="flex h-[22px] shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-text-200 transition-colors hover:bg-white/[0.04] hover:text-text-100" title={t.token}>
              {t.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- token image
                <img src={t.image} alt="" className="h-3.5 w-3.5 rounded-[3px] object-cover" />
              ) : null}
              <span className="font-medium">{t.symbol}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type Health = { ok: boolean; head: string | null; latencyMs: number | null; ethUsd: number | null };

export function RhBottomBar() {
  const router = useRouter();
  const h = useGet<Health>("/api/robinhood/health", 10000);
  const [fps, setFps] = useState<number | null>(null);
  const [vamp, setVamp] = useState(false);
  useEffect(() => {
    let alive = true;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        if (alive) setFps(frames);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);
  const latency = h.data?.latencyMs ?? null;
  const stable = latency !== null && latency < 800;
  return (
    <footer className="relative z-[100] flex h-[calc(2.25rem+env(safe-area-inset-bottom))] max-w-full shrink-0 items-center justify-between border-t border-line-100 bg-bg-50 px-1.5 pb-[env(safe-area-inset-bottom)] text-sm font-medium">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <button type="button" onClick={() => router.push("/rh/launch")} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[7px] px-1.5 py-1 text-sm font-normal leading-4 text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100" title="Launch on Robinhood (Pons V2)">
          Quick Launch
        </button>
        <Link href="/rh/settings" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100" title="Launch defaults">
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Link>
        <button type="button" onClick={() => setVamp(true)} title="Vamp: paste a Pons token address, launch its copy" className="ml-0.5 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[7px] px-1.5 py-1 text-sm font-normal leading-4 text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100">
          <Zap className="h-3.5 w-3.5 text-[#ccff00]" /> Vamp
        </button>
        {vamp ? <RhVampDialog onClose={() => setVamp(false)} /> : null}
        <div className="mx-0.5 h-4 w-px shrink-0 bg-line-50" />
        <div className="ml-0.5 hidden shrink-0 items-center gap-1 text-text-100 md:flex" title="ETH price">
          <span className="text-xs text-text-300">ETH</span>
          <span className="text-sm tabular-nums">{h.data?.ethUsd ? usdOf(1, h.data.ethUsd) : "—"}</span>
        </div>
        <span className="ml-3 hidden items-center gap-1.5 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-xs font-normal text-text-200 md:flex" title={h.data?.head ? `Chain head: block ${h.data.head}` : "Robinhood Chain RPC"}>
          <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", h.data?.ok ? "bg-[#ccff00]" : "bg-text-300")} />
          Robinhood Chain {h.data?.head ? `· #${Number(h.data.head).toLocaleString("en-US")}` : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-text-200">
        <div className={cx("hidden items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 md:flex", stable ? "bg-accent/15 text-accent" : latency === null ? "bg-white/[0.04] text-text-300" : "bg-decrease/15 text-decrease")} title="Robinhood Chain RPC latency and UI frame rate">
          <span className="text-xs font-normal leading-4">{latency === null ? (h.error ? "Offline" : "RPC") : stable ? "Stable" : "Unstable"}</span>
          <span className="text-xs font-normal leading-4">{latency === null ? "— MS" : `${latency} MS`}</span>
          <span className="mx-0.5 h-[7px] w-px bg-accent/30" />
          <span className="text-xs font-normal leading-4">{fps === null ? "— FPS" : `${fps} FPS`}</span>
        </div>
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className="flex h-6 items-center gap-1 rounded-[4px] px-2 text-xs font-normal text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100">
          Docs
        </a>
      </div>
    </footer>
  );
}

/** paste a Pons V2 token address → the Launch form opens prefilled with its name, ticker, logo, description, socials */
export function RhVampDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [ca, setCa] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = /^0x[0-9a-fA-F]{40}$/.test(ca.trim());
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/robinhood/meta/${ca.trim()}`);
      onClose();
      router.push(`/rh/launch?vamp=${ca.trim()}`);
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BxModal open onClose={onClose} title="Vamp a Pons token" width={460}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-text-300">Paste a Robinhood Chain token address: its name, ticker, logo, description and links are read from the token itself and copied into the Launch form.</p>
        <BxInput autoFocus value={ca} onChange={(e) => setCa(e.target.value.trim())} placeholder="0x…" onKeyDown={(e) => e.key === "Enter" && ok && void go()} className="font-mono" />
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton variant="primary" disabled={!ok || busy} onClick={() => void go()}>
          {busy ? "Reading the token…" : "Vamp it"}
        </BxButton>
      </div>
    </BxModal>
  );
}

/** Robinhood search: your recent tokens, or any 0x address opens its page */
export function RhSearchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const recent = useRhRecent();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const isCa = /^0x[0-9a-fA-F]{40}$/.test(q.trim());
  const rows = recent.filter((r) => !needle || r.symbol.toLowerCase().includes(needle) || r.token.toLowerCase().includes(needle));
  const go = (t: string) => {
    onClose();
    router.push(`/rh/token/${t}`);
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[10vh]" style={{ background: "var(--modal-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search Robinhood tokens" className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-line-100 bg-bg-50 shadow-2xl">
        <div className="flex h-11 items-center gap-2 border-b border-line-100 px-3">
          <Search className="h-4 w-4 text-text-300" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter") {
                if (isCa) go(q.trim());
                else if (rows[0]) go(rows[0].token);
              }
            }}
            placeholder="Paste a Pons token address (0x…) or filter your recent tokens"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-text-100 outline-none placeholder:text-text-300"
          />
          <button type="button" onClick={onClose} className="rounded border border-line-100 px-1.5 py-0.5 text-[11px] text-text-300 hover:text-text-100">
            Esc
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {isCa ? (
            <li>
              <button type="button" onClick={() => go(q.trim())} className="flex w-full items-center gap-2.5 rounded-md bg-white/[0.04] px-2 py-2 text-left text-sm text-text-100">
                Open {short(q.trim(), 6, 4)}
              </button>
            </li>
          ) : null}
          {rows.map((r) => (
            <li key={r.token}>
              <button type="button" onClick={() => go(r.token)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
                <TokenAvatar src={r.image} symbol={r.symbol} size={28} />
                <span className="flex-1 text-sm font-medium text-text-100">{r.symbol}</span>
                <span className="font-mono text-[11px] text-text-300">{short(r.token, 6, 4)}</span>
              </button>
            </li>
          ))}
          {!rows.length && !isCa ? <li className="px-3 py-6 text-center text-[13px] text-text-300">No recent Robinhood token. Paste an 0x address.</li> : null}
        </ul>
      </div>
    </div>
  );
}
