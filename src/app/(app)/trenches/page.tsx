"use client";
/** Block X /sol/trenches: three columns New · Almost bonded · Migrated, each with keyword box, preset P1-P3, mute, filter. */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Funnel, Pause, Search, Volume2, VolumeX } from "lucide-react";
import { FeedCardView } from "@/components/trenches/FeedCard";
import { publishFeedStatus, useFeedStatus } from "@/components/feed-status";
import { failureMessage, post, useSSE } from "@/lib/api";
import { DEFAULT_PRESETS, readLocalPresets, solPriceRes, useSettings, useVault, useWallets, writeLocalPresets } from "@/lib/store";
import { short } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxInput, BxSwitch, cx } from "@/components/bx/ui";
import type { FeedCard, FeedColumn, FeedMigrate, FeedSnapshot, FeedStatus } from "@/lib/types";

type Cols = Record<FeedColumn, FeedCard[]>;
const EMPTY: Cols = { new: [], almost: [], migrated: [] };
const COLS: { id: FeedColumn; title: string }[] = [
  { id: "new", title: "New" },
  { id: "almost", title: "Almost bonded" },
  { id: "migrated", title: "Migrated" },
];
type Filters = { minMcUsd: string; maxAgeMin: string; hideMayhem: boolean };
const NO_FILTER: Filters = { minMcUsd: "", maxAgeMin: "", hideMayhem: false };
const noop = () => () => {};

export default function TrenchesPage() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [cols, setCols] = useState<Cols>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [streamErr, setStreamErr] = useState(false);
  const status = useFeedStatus();
  const [query, setQuery] = useState<Record<FeedColumn, string>>({ new: "", almost: "", migrated: "" });
  const [muted, setMuted] = useState<Record<FeedColumn, boolean>>({ new: false, almost: false, migrated: false });
  const [filters, setFilters] = useState<Record<FeedColumn, Filters>>({ new: NO_FILTER, almost: NO_FILTER, migrated: NO_FILTER });
  const [filterOpen, setFilterOpen] = useState<FeedColumn | null>(null);
  const [paused, setPaused] = useState<Record<FeedColumn, boolean>>({ new: false, almost: false, migrated: false });
  const [frozen, setFrozen] = useState<{ col: FeedColumn; order: string[] } | null>(null);
  const colsRef = useRef(cols);
  useEffect(() => {
    colsRef.current = cols;
  }, [cols]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [mobileCol, setMobileCol] = useState<FeedColumn>("new");
  const [now, setNow] = useState(() => Date.now());
  const settings = useSettings();
  const vault = useVault();
  const wallets = useWallets();
  const router = useRouter();
  const [presetOverride, setPresetOverride] = useState<[string, string, string] | null>(null);
  const [presetIdx, setPresetIdx] = useState(0);

  useSSE("/api/feed/stream", {
    snapshot: (d) => {
      const s = d as FeedSnapshot;
      setCols(s.columns);
      publishFeedStatus(s.status);
      if (s.solPrice) solPriceRes.mutate({ usd: s.solPrice, at: Date.now(), source: "jupiter" });
      setConnected(true);
      setStreamErr(false);
    },
    create: (d) => upsert(setCols, [d as FeedCard]),
    update: (d) => upsert(setCols, d as FeedCard[]),
    migrate: (d) => {
      const m = d as FeedMigrate;
      if (m.card) upsert(setCols, [m.card]);
    },
    status: (d) => publishFeedStatus(d as FeedStatus),
    solPrice: (d) => solPriceRes.mutate({ usd: (d as { usd: number }).usd, at: Date.now(), source: "jupiter" }),
    onOpen: () => setStreamErr(false),
    onError: () => setStreamErr(true),
  });
  useEffect(() => () => publishFeedStatus(null), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const presets: [string, string, string] = presetOverride ?? settings.data?.presets ?? (hydrated ? readLocalPresets() : null) ?? DEFAULT_PRESETS;
  const preset = presets[presetIdx];
  const setPresetValue = (i: number, v: string) => {
    if (!(Number(v) > 0)) return;
    const next = [...presets] as [string, string, string];
    next[i] = v;
    setPresetOverride(next);
    writeLocalPresets(next);
  };

  // keyboard: 1/2/3 quick-buy on the hovered card, Esc clears
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") return setHovered(null);
      const idx = ["1", "2", "3"].indexOf(e.key);
      if (idx < 0 || !hovered) return;
      const active = wallets.data?.active;
      if (!vault.data?.unlocked || !active) return toast("Unlock the vault and pick an active wallet", "err");
      try {
        await post("/api/trade/buy", { mint: hovered, wallets: [active], sol: presets[idx], slippageBps: settings.data?.slippageBps ?? 2000 });
        toast(`Buying ${presets[idx]} SOL of ${short(hovered)}`, "info");
      } catch (err) {
        toast(failureMessage(err), "err");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hovered, presets, wallets.data?.active, vault.data?.unlocked, settings.data?.slippageBps]);

  const visible = (id: FeedColumn) => {
    let list = cols[id];
    const q = query[id].trim().toLowerCase();
    const f = filters[id];
    if (q) list = list.filter((c) => (c.symbol ?? "").toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q) || c.mint.toLowerCase().includes(q));
    if (Number(f.minMcUsd) > 0) list = list.filter((c) => (c.marketCapUsd ?? 0) >= Number(f.minMcUsd));
    if (Number(f.maxAgeMin) > 0) list = list.filter((c) => now - c.createdAt <= Number(f.maxAgeMin) * 60_000);
    if (f.hideMayhem) list = list.filter((c) => !c.isMayhem);
    if (frozen?.col === id || paused[id]) {
      const order = frozen?.col === id ? frozen.order : list.map((c) => c.mint);
      const byMint = new Map(list.map((c) => [c.mint, c]));
      const kept = order.map((m) => byMint.get(m)).filter((c): c is FeedCard => !!c);
      const fresh = list.filter((c) => !order.includes(c.mint));
      list = [...kept, ...fresh];
    }
    return list;
  };
  const feedDown = !connected && (streamErr || !!status.error);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-2">
      <div className="mb-1.5 grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-line-100 bg-bg-50 p-0.5 lg:hidden" role="tablist" aria-label="Trenches categories">
        {COLS.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={mobileCol === c.id} onClick={() => setMobileCol(c.id)} className={cx("rounded-md px-1.5 py-1 text-center text-[12px] font-medium leading-4 transition-colors", mobileCol === c.id ? "bg-accent/15 text-accent" : "text-text-300 hover:bg-white/[0.04] hover:text-text-100")}>
            {c.title}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[10px] border border-line-100">
        {COLS.map((c, ci) => {
          const list = visible(c.id);
          const f = filters[c.id];
          const active = Number(f.minMcUsd) > 0 || Number(f.maxAgeMin) > 0 || f.hideMayhem;
          return (
            <div
              key={c.id}
              className={cx("min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-100", c.id !== mobileCol ? "hidden lg:flex" : "flex", ci < 2 ? "lg:border-r lg:border-line-100" : "")}
              onMouseEnter={() => setFrozen({ col: c.id, order: colsRef.current[c.id].map((x) => x.mint) })}
              onMouseLeave={() => setFrozen((fr) => (fr?.col === c.id ? null : fr))}
            >
              <div className="relative flex h-12 w-full items-center justify-between border-b border-line-100 px-2 text-sm font-medium sm:px-3">
                <div className="hidden items-center gap-2 whitespace-nowrap text-[14px] font-medium text-text-100 lg:flex" title="Hover column to pause list moves (adds / reorders)">
                  {c.title}
                  <span className="text-[12px] font-normal tabular-nums text-text-300">{cols[c.id].length}</span>
                  {!status.connected ? <span className={cx("text-[11px] font-normal", feedDown ? "text-decrease" : "text-text-300")}>{feedDown ? "· feed unreachable" : "· connecting…"}</span> : null}
                </div>
                <div className="flex h-full min-w-0 flex-1 items-center lg:absolute lg:right-3 lg:top-0 lg:w-auto lg:flex-none lg:justify-end">
                  <div className="flex h-full w-full min-w-0 items-center gap-1 bg-bg-100 lg:w-fit lg:pl-1">
                    <div className="flex min-w-0 flex-1 items-center lg:w-[108px] lg:flex-none">
                      <div className="flex h-6 w-full items-center gap-1.5 rounded bg-input-200 px-2">
                        <Search className="h-3 w-3 shrink-0 text-text-300" />
                        <input value={query[c.id]} onChange={(e) => setQuery((q) => ({ ...q, [c.id]: e.target.value }))} placeholder="Keyword…" type="text" className="min-w-0 flex-1 bg-transparent text-[12px] text-text-100 outline-none placeholder:text-text-300" />
                      </div>
                    </div>
                    <button type="button" onClick={() => setPaused((p) => ({ ...p, [c.id]: !p[c.id] }))} className={cx("flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors lg:hidden", paused[c.id] ? "text-accent" : "text-text-300 hover:bg-hover-200 hover:text-text-100")} aria-label="Pause list moves" title="Pause — freeze list order">
                      <Pause className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex h-6 shrink-0 items-center gap-1">
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                        <img src="/solana.svg" alt="" width={12} height={12} className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 object-contain" />
                        <input
                          key={`${presetIdx}-${preset}`}
                          type="number"
                          step="0.01"
                          min={0}
                          defaultValue={preset}
                          onBlur={(e) => setPresetValue(presetIdx, e.target.value.trim())}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          className="h-6 w-[52px] rounded border border-transparent bg-input-100 py-0 pl-6 pr-1 text-sm leading-6 text-text-100 outline-none [appearance:textfield] placeholder:text-text-300 hover:border-line-200 focus:border-line-200"
                          aria-label={`Preset ${presetIdx + 1} amount in SOL`}
                          title={`P${presetIdx + 1} = ${preset} SOL — edit to change`}
                        />
                      </div>
                      <div className="flex h-6 items-center gap-0.5 rounded bg-input-100 p-0.5">
                        {[0, 1, 2].map((i) => (
                          <button key={i} type="button" onClick={() => setPresetIdx(i)} className={cx("flex h-full flex-1 cursor-pointer items-center justify-center truncate rounded px-1.5 text-[12px] transition-colors", presetIdx === i ? "bg-btn-secondary text-accent hover:bg-hover-300" : "text-text-300 hover:bg-hover-300 hover:text-text-100")} title={`P${i + 1} = ${presets[i]} SOL`}>
                            P{i + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => setMuted((m) => ({ ...m, [c.id]: !m[c.id] }))} className={cx("flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-hover-200 hover:text-text-100", muted[c.id] ? "text-accent" : "text-text-300")} aria-label={muted[c.id] ? "Unmute" : "Mute"} title={muted[c.id] ? "Muted: first 100 cards, no re-render" : "Mute this column"}>
                      {muted[c.id] ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    <div className="relative">
                      <button type="button" onClick={() => setFilterOpen((o) => (o === c.id ? null : c.id))} className={cx("group relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center transition-colors hover:text-text-100", active || filterOpen === c.id ? "text-accent" : "text-text-300")} aria-label="Filter">
                        <Funnel className="h-3.5 w-3.5 group-hover:text-text-100" />
                      </button>
                      {filterOpen === c.id ? (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setFilterOpen(null)} />
                          <div className="absolute right-0 top-7 z-30 w-[260px] rounded-lg border border-line-100 bg-bg-50 p-3 shadow-2xl">
                            <div className="mb-2 text-[13px] font-medium text-text-100">Filters · {c.title}</div>
                            <div className="flex flex-col gap-2.5">
                              <label className="flex flex-col gap-1 text-[12px] text-text-300">
                                Min market cap (USD)
                                <BxInput type="number" min={0} value={f.minMcUsd} onChange={(e) => setFilters((s) => ({ ...s, [c.id]: { ...s[c.id], minMcUsd: e.target.value } }))} placeholder="0" className="h-8 text-[13px]" />
                              </label>
                              <label className="flex flex-col gap-1 text-[12px] text-text-300">
                                Max age (minutes)
                                <BxInput type="number" min={0} value={f.maxAgeMin} onChange={(e) => setFilters((s) => ({ ...s, [c.id]: { ...s[c.id], maxAgeMin: e.target.value } }))} placeholder="any" className="h-8 text-[13px]" />
                              </label>
                              <label className="flex items-center justify-between text-[12px] text-text-200">
                                Hide mayhem tokens
                                <BxSwitch checked={f.hideMayhem} onChange={(v) => setFilters((s) => ({ ...s, [c.id]: { ...s[c.id], hideMayhem: v } }))} />
                              </label>
                              <button type="button" onClick={() => setFilters((s) => ({ ...s, [c.id]: NO_FILTER }))} className="self-end text-[12px] text-text-300 hover:text-text-100">
                                Reset
                              </button>
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {!hydrated || (!connected && !feedDown && !list.length) ? (
                  <p className="p-4 text-[13px] text-text-300">Waiting for the feed snapshot…</p>
                ) : feedDown && !list.length ? (
                  <p className="p-4 text-[13px] text-text-300">The feed stream did not answer. The server keeps one PumpPortal socket — check that it is running, then reload.</p>
                ) : !list.length ? (
                  <p className="p-4 text-[13px] text-text-300">{query[c.id] || active ? "No token matches this keyword or filter." : "Nothing here yet — cards appear as the feed sees them."}</p>
                ) : (
                  (muted[c.id] ? list.slice(0, 100) : list).map((card) => <FeedCardView key={card.mint} card={card} now={now} preset={preset} hovered={hovered === card.mint} onHover={setHovered} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
      {hovered ? (
        <div className="pointer-events-none fixed bottom-12 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md border border-line-100 bg-bg-50 px-3 py-1.5 text-[12px] text-text-300 shadow-xl">
          <span className="font-mono text-text-200">{short(hovered)}</span>
          {presets.map((p, i) => (
            <span key={i}>
              <kbd className="rounded border border-line-100 px-1 text-[11px] text-text-200">{i + 1}</kbd> {p} SOL
            </span>
          ))}
          <button type="button" className="pointer-events-auto text-accent hover:underline" onClick={() => router.push(`/trade/${hovered}`)}>
            Open
          </button>
        </div>
      ) : null}
    </div>
  );
}

function upsert(set: React.Dispatch<React.SetStateAction<Cols>>, cards: FeedCard[]) {
  set((prev) => {
    const next: Cols = { new: [...prev.new], almost: [...prev.almost], migrated: [...prev.migrated] };
    for (const card of cards) {
      for (const k of Object.keys(next) as FeedColumn[]) {
        const i = next[k].findIndex((c) => c.mint === card.mint);
        if (i >= 0) next[k].splice(i, 1);
      }
      next[card.column].unshift(card);
    }
    for (const k of Object.keys(next) as FeedColumn[]) {
      next[k].sort((a, b) => (k === "new" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt));
      next[k] = next[k].slice(0, 100);
    }
    return next;
  });
}
