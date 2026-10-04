"use client";
/**
 * Block X chrome: 60px top bar (wordmark, nav, search with "/" shortcut, chain pill, user pill),
 * 28px "recently viewed" strip, scrolling main, 36px bottom bar (Quick Launch, SOL price, latency, links).
 * Markup mirrors design/blockx/dashboard.html.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Bell, BookOpen, Check, ChevronDown, Copy, History, Menu, Search, Settings, SlidersHorizontal } from "lucide-react";
import { useRecent, clearRecent } from "./recent";
import { VaultPill } from "./vault";
import { PadAvatar, cx } from "./ui";
import { useSolPrice, useSettings } from "@/lib/store";
import { failureMessage, useGet } from "@/lib/api";
import { age, short, usd } from "@/lib/format";
import type { PresetsResponse, SearchResponse, SearchSort } from "@/lib/types";

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
    try {
      const f = localStorage.getItem("donchain.font");
      if (f) document.documentElement.dataset.font = f;
    } catch {
      /* ignore */
    }
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

/** "Search tokens" dialog (BEHAVIOUR.md §0.1): pad chips, input, History (n) from /api/recent, Tokens (n) from
 *  GET /api/search?q=&sort= (300 ms debounce), sort Market cap · Age · Volume, a full mint opens its own row. */
function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <SearchBody onClose={onClose} />;
}
type Pad = "pump" | "bonk" | "stonkfun" | "bags" | "graduated";
const PAD_CHIPS: { id: Pad; label: string; enabled: boolean }[] = [
  { id: "pump", label: "Pump", enabled: true },
  { id: "bonk", label: "Bonk", enabled: false },
  { id: "stonkfun", label: "StonkFun", enabled: false },
  { id: "bags", label: "Bags", enabled: false },
  { id: "graduated", label: "Graduated", enabled: true },
];
function SearchBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const recent = useRecent();
  const price = useSolPrice();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<SearchSort>("mc");
  const [pads, setPads] = useState<Set<Pad>>(new Set(["pump"]));
  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const search = useGet<SearchResponse>(debounced ? `/api/search?q=${encodeURIComponent(debounced)}&sort=${sort}&limit=30` : null, 0);
  const solUsd = price.data?.usd ?? null;
  const graduatedOnly = pads.has("graduated") && !pads.has("pump");
  const results = (search.data?.results ?? []).filter((r) => !graduatedOnly || (r.progress ?? 0) >= 100);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const copy = (mint: string) => navigator.clipboard?.writeText(mint).then(() => (setCopied(mint), setTimeout(() => setCopied(null), 1000)));
  const mc = (r: { marketCapUsd: number | null; marketCapSol: number | null }) => (r.marketCapUsd !== null ? usd(r.marketCapUsd) : r.marketCapSol !== null ? (solUsd ? usd(r.marketCapSol * solUsd) : `${r.marketCapSol.toFixed(1)} SOL`) : "—");
  const rows = debounced ? results : recent.map((r) => ({ kind: "recent" as const, mint: r.mint, id: null, name: r.name, symbol: r.symbol, image: r.image, marketCapSol: null, marketCapUsd: null, ageSec: null, volumeSol: null, progress: null, href: `/trade/${r.mint}`, matched: [] }));
  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[10vh]" style={{ background: "var(--modal-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search tokens" className="flex max-h-[76vh] w-full max-w-[800px] flex-col overflow-hidden rounded-lg border border-line-100 bg-bg-50 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-line-50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            {PAD_CHIPS.map((p) => {
              const on = pads.has(p.id);
              return (
                <button key={p.id} type="button" disabled={!p.enabled} onClick={() => setPads((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} className={cx("h-7 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40", on ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-100 text-text-200 hover:text-text-100")} title={p.enabled ? undefined : `${p.label} — not available in DONCHAIN (Pump.fun only)`}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onClose} className="rounded border border-line-100 px-1.5 py-0.5 text-[11px] text-text-300 hover:text-text-100">
            Esc
          </button>
        </div>
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
              if (e.key === "ArrowDown") setIdx((i) => Math.min(rows.length - 1, i + 1));
              if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
              if (e.key === "Enter" && rows[idx]) go(rows[idx].href);
            }}
            placeholder="Search by name, ticker, or CA"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-text-100 outline-none placeholder:text-text-300"
          />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-text-300">
          <span className="font-medium">{debounced ? `Tokens (${rows.length})` : `History (${rows.length})`}</span>
          {debounced ? (
            <span className="flex items-center gap-1">
              {(["mc", "age", "volume"] as SearchSort[]).map((s) => (
                <button key={s} type="button" onClick={() => setSort(s)} className={cx("rounded px-1.5 py-0.5 transition-colors", sort === s ? "bg-accent-muted text-accent" : "hover:text-text-100")} title={s === "mc" ? "Sort by market cap" : s === "age" ? "Sort by age" : "Sort by volume"}>
                  {s === "mc" ? "Market cap" : s === "age" ? "Age" : "Volume"}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {rows.map((r, i) => (
            <li key={`${r.kind}-${r.mint ?? r.id}`}>
              <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => go(r.href)} className={cx("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors", i === idx ? "bg-white/[0.04]" : "")}>
                <PadAvatar src={r.image} alt={r.symbol ?? r.mint?.slice(0, 2) ?? "?"} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium text-text-100">{r.symbol ?? (r.mint ? short(r.mint, 4, 4) : "—")}</span>
                    <span className="truncate text-[12px] text-text-300">{r.name ?? ""}</span>
                    {r.mint ? (
                      <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); copy(r.mint!); }} className="text-text-300 hover:text-text-100" title="Copy address">
                        {copied === r.mint ? <Check className="h-3 w-3 text-green-100" /> : <Copy className="h-3 w-3" />}
                      </span>
                    ) : null}
                    {r.ageSec !== null ? <span className="text-[11px] text-green-100">{age(openedAt - r.ageSec * 1000, openedAt)}</span> : null}
                    <span className="rounded border border-line-100 px-1 text-[10px] uppercase text-text-300">{r.kind}</span>
                  </span>
                </span>
                {debounced ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px]">
                    {[
                      ["MC", mc(r)],
                      ["ATH", "—"],
                      ["V", r.volumeSol !== null ? (solUsd ? usd(r.volumeSol * solUsd) : `${r.volumeSol.toFixed(2)} SOL`) : "—"],
                      ["L", "—"],
                    ].map(([k, v]) => (
                      <span key={k} className="rounded border border-line-100 bg-bg-100 px-1.5 py-0.5 text-text-200">
                        <span className="text-text-300">{k} </span>
                        {v}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-text-300">{r.mint ? short(r.mint, 4, 4) : ""}</span>
                )}
              </button>
            </li>
          ))}
          {!rows.length ? <li className="px-3 py-6 text-center text-[13px] text-text-300">{search.error ? failureMessage(search.error) : debounced ? (search.loading ? "Searching…" : "No token matches.") : "No recently viewed tokens yet."}</li> : null}
        </ul>
      </div>
    </div>
  );
}
