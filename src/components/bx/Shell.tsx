"use client";
/**
 * Block X chrome: 60px top bar (wordmark, nav, search with "/" shortcut, chain pill, user pill),
 * 28px "recently viewed" strip, scrolling main, 36px bottom bar (Quick Launch, SOL price, latency, links).
 * Markup mirrors design/blockx/dashboard.html.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Bell, BookOpen, ChevronDown, History, Menu, Search, Settings, SlidersHorizontal } from "lucide-react";
import { useRecent, clearRecent } from "./recent";
import { VaultPill } from "./vault";
import { cx } from "./ui";
import { useSolPrice, useSettings } from "@/lib/store";
import { useGet } from "@/lib/api";
import { usd } from "@/lib/format";
import type { LaunchesResponse, PresetsResponse } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/launch", label: "Launch" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/rewards", label: "Rewards" },
  { href: "/settings", label: "Settings" },
];

export const DOCS_URL = "https://github.com/travisiol/trench#readme";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("select-none text-[17px] font-extrabold leading-none tracking-[-0.04em]", className)} aria-label="DONCHAIN">
      <span className="text-text-100">DON</span>
      <span className="text-accent">CHAIN</span>
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="flex h-[var(--app-height,100svh)] max-h-[var(--app-height,100svh)] min-h-0 flex-col overflow-hidden bg-bg-100">
      <div className="shrink-0 border-b border-line-100">
        <header className="relative z-[110] flex h-[60px] shrink-0 items-center justify-between gap-3 bg-bg-50 px-3 sm:gap-4 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center overflow-hidden">
            <div className="flex items-center gap-3 sm:gap-6">
              <Link href="/dashboard" className="flex shrink-0 items-center gap-1.5" aria-label="DONCHAIN">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-accent text-[13px] font-extrabold text-white">D</span>
                <Wordmark />
              </Link>
              <nav className="hidden min-w-0 items-center gap-0.5 min-[1600px]:gap-1 xl:flex">
                {NAV.map((n) => {
                  const on = path === n.href || path.startsWith(n.href + "/") || (n.href === "/dashboard" && path.startsWith("/trade/"));
                  return (
                    <Link key={n.href} href={n.href} className={cx("rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.04] min-[1600px]:px-2.5", on ? "text-accent" : "text-text-200 hover:text-text-100")}>
                      {n.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div>
              <button type="button" onClick={() => setSearchOpen(true)} className="hidden h-8 w-[280px] items-center gap-2 rounded-md border border-line-100 bg-bg-50 px-3 text-left text-sm text-text-300 lg:flex">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Search name, ticker, CA</span>
                <span className="shrink-0 text-text-300">/</span>
              </button>
              <button type="button" onClick={() => setSearchOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-md border border-line-100 bg-bg-50 text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100 lg:hidden" aria-label="Search name, ticker, CA">
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="relative">
              <button type="button" className="flex h-7 items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-200 transition-colors hover:bg-white/[0.04]" title="Solana — the only chain for now">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                  <img src="/solana.svg" alt="Solana" width={16} height={16} className="h-full w-full object-contain" />
                </span>
                <span>Solana</span>
                <ChevronDown className="h-3 w-3 text-text-300 transition-transform" />
              </button>
            </div>
            <VaultPill />
            <div className="relative xl:hidden">
              <button type="button" onClick={() => setMenu((m) => !m)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-200 transition-colors hover:bg-white/[0.04] hover:text-text-100" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </button>
              {menu ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 top-10 z-20 flex w-44 flex-col rounded-md border border-line-100 bg-bg-50 p-1 shadow-xl">
                    {NAV.map((n) => (
                      <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className={cx("rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-white/[0.04]", path.startsWith(n.href) ? "text-accent" : "text-text-200")}>
                        {n.label}
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>
        <RecentStrip />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-100">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
          </main>
        </div>
      </div>
      <BottomBar />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function RecentStrip() {
  const recent = useRecent();
  const [hidden, setHidden] = useState(false);
  return (
    <div className="flex h-7 items-center gap-2 border-t border-line-50 bg-bg-50 px-4 py-[3px]">
      <div className="relative flex shrink-0 items-center">
        <button type="button" className="inline-flex h-3.5 w-3.5 items-center justify-center text-text-300 transition-colors hover:text-text-100" aria-label="Holdings strip settings" title="Recently viewed strip" onClick={() => clearRecent()}>
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="h-3 w-px shrink-0 bg-line-200" />
      <div className="flex shrink-0 items-center gap-3">
        <button type="button" onClick={() => setHidden((h) => !h)} className={cx("transition-colors hover:text-text-100", hidden ? "text-text-300" : "text-text-100")} aria-label="Hide recently viewed" title={hidden ? "Show recently viewed" : "Hide recently viewed"}>
          <History className="h-3 w-3" />
        </button>
      </div>
      <div className="h-3 w-px shrink-0 bg-line-200" />
      <div className="flex h-[18px] w-[42px] shrink-0 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
        <img src="/solana.svg" alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
      </div>
      {!recent.length || hidden ? (
        <div className="flex h-[22px] flex-1 items-center text-xs text-text-300">{hidden ? "Recently viewed hidden" : "No recently viewed tokens"}</div>
      ) : (
        <div className="no-scrollbar flex h-[22px] min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {recent.map((t) => (
            <Link key={t.mint} href={`/trade/${t.mint}`} className="flex h-[22px] shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-text-200 transition-colors hover:bg-white/[0.04] hover:text-text-100" title={t.mint}>
              {t.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- token image
                <img src={t.image} alt="" className="h-3.5 w-3.5 rounded-[3px] object-cover" />
              ) : null}
              <span className="font-medium">{t.symbol ?? t.mint.slice(0, 4)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Real numbers only: SOL price from the server, latency = round-trip of GET /api/vault every 10 s, FPS from rAF. */
function BottomBar() {
  const price = useSolPrice();
  const router = useRouter();
  const presets = useGet<PresetsResponse>("/api/presets", 0);
  const [latency, setLatency] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const settings = useSettings();
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      const t0 = performance.now();
      try {
        await fetch("/api/vault", { cache: "no-store" });
        if (alive) setLatency(Math.round(performance.now() - t0));
      } catch {
        if (alive) setLatency(null);
      }
    };
    ping();
    const t = setInterval(ping, 10000);
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
      clearInterval(t);
      cancelAnimationFrame(raf);
    };
  }, []);
  const quick = presets.data?.presets[0] ?? null;
  const stable = latency !== null && latency < 400;
  const cluster = settings.data?.cluster ?? "mainnet";
  return (
    <footer className="relative z-[100] flex h-[calc(2.25rem+env(safe-area-inset-bottom))] max-w-full shrink-0 items-center justify-between border-t border-line-100 bg-bg-50 px-1.5 pb-[env(safe-area-inset-bottom)] text-sm font-medium">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => router.push(quick ? `/launch?quick=${encodeURIComponent(quick.id)}` : "/launch")}
            className="flex min-w-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-[7px] border-[0.5px] border-transparent px-1.5 py-1 text-sm font-normal leading-4 text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100"
            aria-label="Quick Launch 1"
            title={quick ? `Quick Launch: preset “${quick.name}”` : "Quick Launch: save a preset on the Launch page first"}
          >
            Quick Launch
            <span className="tabular-nums text-text-200">{quick ? "1" : "0"}</span>
          </button>
          <Link href="/launch" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-text-300 transition-colors duration-150 ease-in-out hover:bg-hover-200 hover:text-text-100" aria-label="Quick Launch settings" title="Quick Launch settings">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-line-50" />
        <div className="hidden md:contents">
          <div className="ml-0.5 flex shrink-0 items-center gap-1 text-[#9945FF]" title={price.data ? `SOL ${usd(price.data.usd, 2)}` : "SOL price"}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
            <img src="/solana.svg" alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
            <span className="text-sm tabular-nums">{price.data ? usd(price.data.usd, 2) : "—"}</span>
          </div>
          {cluster === "devnet" ? <span className="ml-3 rounded-md bg-yellow-100/15 px-1.5 py-0.5 text-xs text-yellow-100">devnet</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-text-200">
        <div className="hidden md:contents">
          <div className={cx("flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1", stable ? "bg-accent/15 text-accent" : latency === null ? "bg-white/[0.04] text-text-300" : "bg-decrease/15 text-decrease")} title="Server round-trip (GET /api/vault every 10 s) and UI frame rate">
            <span className={cx("flex h-3 w-3 shrink-0 items-center justify-center rounded-full", stable ? "bg-accent/25" : "bg-decrease/25")}>
              <span className={cx("h-2 w-2 rounded-full", stable ? "bg-accent" : latency === null ? "bg-text-300" : "bg-decrease")} />
            </span>
            <span className="text-xs font-normal leading-4">{latency === null ? "Offline" : stable ? "Stable" : "Unstable"}</span>
            <span className="text-xs font-normal leading-4">{latency === null ? "— MS" : `${latency} MS`}</span>
            <span className="mx-0.5 h-[7px] w-px bg-accent/30" />
            <span className="text-xs font-normal leading-4">{fps === null ? "— FPS" : `${fps} FPS`}</span>
          </div>
          <div className="mx-0.5 hidden h-5 w-px shrink-0 bg-line-50 sm:block" />
        </div>
        <div className="flex items-center gap-1 text-text-300">
          <Link href="/settings?tab=notifications" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-text-300 transition-colors duration-150 ease-in-out hover:bg-hover-200 hover:text-text-100" aria-label="Notifications" title="Notifications">
            <Bell className="h-4 w-4" />
          </Link>
        </div>
        <div className="mx-0.5 hidden h-5 w-px shrink-0 bg-line-50 sm:block" />
        <div className="flex items-center gap-1 text-text-300">
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="flex h-6 items-center gap-1 rounded-[4px] px-2 text-text-300 transition-colors hover:bg-hover-200 hover:text-text-100" aria-label="Docs" title="Docs">
            <BookOpen className="h-4 w-4" />
            <span className="hidden text-xs font-normal leading-4 sm:inline">Docs</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

/** "/" search: paste a mint address (opens its trade page) or pick one of your launches / recently viewed tokens. */
function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <SearchBody onClose={onClose} />;
}
function SearchBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const launches = useGet<LaunchesResponse>("/api/dev/launches", 0);
  const recent = useRecent();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const needle = q.trim().toLowerCase();
  const isCa = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim());
  const pool = [
    ...(launches.data?.launches ?? []).map((l) => ({ mint: l.mint, symbol: l.symbol, name: l.name, image: l.image, kind: "launch" as const })),
    ...recent.filter((r) => !(launches.data?.launches ?? []).some((l) => l.mint === r.mint)).map((r) => ({ mint: r.mint, symbol: r.symbol, name: r.name, image: r.image, kind: "recent" as const })),
  ];
  const hits = needle ? pool.filter((c) => c.mint.toLowerCase().includes(needle) || (c.symbol ?? "").toLowerCase().includes(needle) || (c.name ?? "").toLowerCase().includes(needle)).slice(0, 8) : pool.slice(0, 8);
  const go = (mint: string) => {
    onClose();
    router.push(`/trade/${mint}`);
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[12vh]" style={{ background: "var(--modal-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[560px] overflow-hidden rounded-lg border border-line-100 bg-bg-50 shadow-2xl">
        <div className="flex h-11 items-center gap-2 border-b border-line-100 px-3">
          <Search className="h-4 w-4 text-text-300" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") setIdx((i) => Math.min(hits.length - 1, i + 1));
              if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
              if (e.key === "Enter") {
                if (isCa) go(q.trim());
                else if (hits[idx]) go(hits[idx].mint);
              }
            }}
            placeholder="Search name, ticker, CA"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-text-100 outline-none placeholder:text-text-300"
          />
          <kbd className="rounded border border-line-100 px-1.5 text-[11px] text-text-300">Esc</kbd>
        </div>
        <ul className="max-h-[360px] overflow-y-auto p-1">
          {isCa ? (
            <li>
              <button type="button" onClick={() => go(q.trim())} className="flex w-full items-center gap-2.5 rounded-md bg-white/[0.04] px-2 py-1.5 text-left text-sm text-text-200">
                Open <span className="font-mono text-text-100">{q.trim().slice(0, 6)}…{q.trim().slice(-6)}</span> <span className="ml-auto text-[11px] text-text-300">Enter</span>
              </button>
            </li>
          ) : null}
          {hits.map((c, i) => (
            <li key={c.mint}>
              <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => go(c.mint)} className={cx("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors", i === idx && !isCa ? "bg-white/[0.04]" : "")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- token image */}
                {c.image ? <img src={c.image} alt="" className="h-7 w-7 rounded-md object-cover" /> : <span className="h-7 w-7 rounded-md border border-line-100 bg-bg-100" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-text-100">{c.symbol ?? c.mint.slice(0, 6)}</span>
                  <span className="block truncate text-[12px] text-text-300">{c.name}</span>
                </span>
                <span className="text-[11px] text-text-300">{c.kind === "launch" ? "your launch" : "recent"}</span>
                <span className="font-mono text-[12px] text-text-300">
                  {c.mint.slice(0, 4)}…{c.mint.slice(-4)}
                </span>
              </button>
            </li>
          ))}
          {!hits.length && !isCa ? <li className="px-3 py-6 text-center text-[13px] text-text-300">{needle ? "No launch or recent token matches. Paste a full mint address to open it." : "Paste a mint address, or type the name of one of your launches."}</li> : null}
        </ul>
      </div>
    </div>
  );
}
