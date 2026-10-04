"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Icon3D } from "@/components/Icon3D";
import { Button, Empty, Kbd, Segmented, Spinner, cx, toast } from "@/components/ui";
import { FeedCardView } from "@/components/trenches/FeedCard";
import { publishFeedStatus, useFeedStatus } from "@/components/feed-status";
import { failureMessage, post, useSSE } from "@/lib/api";
import { DEFAULT_PRESETS, readLocalPresets, solPriceRes, useSettings, useVault, useWallets, writeLocalPresets } from "@/lib/store";
import { short } from "@/lib/format";
import type { FeedCard, FeedColumn, FeedMigrate, FeedSnapshot, FeedStatus } from "@/lib/ui-types";

type Cols = Record<FeedColumn, FeedCard[]>;
const EMPTY: Cols = { new: [], almost: [], migrated: [] };
const COLS: { id: FeedColumn; title: string; blurb: string }[] = [
  { id: "new", title: "New", blurb: "Created in the last 30 min, under 85 % bonded" },
  { id: "almost", title: "Almost bonded", blurb: "85 % and above, not migrated" },
  { id: "migrated", title: "Migrated", blurb: "Curve complete, trading on the AMM" },
];
const noop = () => () => {};

export default function TrenchesPage() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [cols, setCols] = useState<Cols>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [streamErr, setStreamErr] = useState(false);
  const status = useFeedStatus();
  const [query, setQuery] = useState<Record<FeedColumn, string>>({ new: "", almost: "", migrated: "" });
  const [muted, setMuted] = useState<Record<FeedColumn, boolean>>({ new: false, almost: false, migrated: false });
  /** column whose order is frozen while hovered, with the order captured at hover time */
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
  const [editPreset, setEditPreset] = useState<number | null>(null);

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
  // presets: local edit > settings > localStorage > defaults
  const presets: [string, string, string] = presetOverride ?? settings.data?.presets ?? (hydrated ? readLocalPresets() : null) ?? DEFAULT_PRESETS;
  const preset = presets[presetIdx];

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
        toast(`P${idx + 1}: buying ${presets[idx]} SOL of ${short(hovered)}`, "info");
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
    if (q) list = list.filter((c) => (c.symbol ?? "").toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q) || c.mint.toLowerCase().includes(q));
    if (frozen?.col === id) {
      const byMint = new Map(list.map((c) => [c.mint, c]));
      const kept = frozen.order.map((m) => byMint.get(m)).filter((c): c is FeedCard => !!c);
      const fresh = list.filter((c) => !frozen.order.includes(c.mint));
      list = [...kept, ...fresh];
    }
    return list;
  };

  const feedDown = !connected && (streamErr || !!status.error);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-4 h-11 border-b border-line text-[11px] text-text-3 shrink-0">
        <Icon3D name="trenches" size={20} />
        <span className="font-semibold text-text text-xs">Trenches</span>
        <span className={cx("flex items-center gap-1.5", status.connected ? "text-up" : "")}>
          <span className={cx("w-1.5 h-1.5 rounded-full", status.connected ? "bg-up pulse" : feedDown ? "bg-down" : "bg-text-3")} />
          {status.connected ? `PumpPortal live · ${status.tracked} curves polled${status.tradesLive ? " · real trades" : " · volume ≈ curve deltas"}` : feedDown ? "Feed stream unreachable" : "Connecting…"}
        </span>
        {status.error ? <span className="text-down truncate">{status.error}</span> : null}
        <span className="ml-auto hidden md:flex items-center gap-2">
          Quick buy on hovered card: <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> · <Kbd>Esc</Kbd> clears
        </span>
        <span className="md:hidden">
          <Segmented size="xs" value={mobileCol} onChange={setMobileCol} options={COLS.map((c) => ({ value: c.id, label: c.title }))} />
        </span>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 min-h-0">
        {COLS.map((c) => {
          const list = visible(c.id);
          return (
            <section key={c.id} className={cx("panel flex flex-col min-h-0", c.id !== mobileCol ? "hidden md:flex" : "flex")} onMouseEnter={() => setFrozen({ col: c.id, order: colsRef.current[c.id].map((x) => x.mint) })} onMouseLeave={() => setFrozen((f) => (f?.col === c.id ? null : f))}>
              <header className="flex items-center gap-1.5 px-2 h-11 border-b border-line shrink-0">
                <h2 className="text-xs font-semibold px-1" title={c.blurb}>
                  {c.title}
                </h2>
                <span className="mono text-[10px] text-text-3">{cols[c.id].length}</span>
                <input value={query[c.id]} onChange={(e) => setQuery((q) => ({ ...q, [c.id]: e.target.value }))} placeholder="Keyword…" className="input h-7 text-[11px] flex-1 min-w-0 mx-1" />
                <span className="flex items-center gap-0.5">
                  {presets.map((p, i) =>
                    editPreset === i ? (
                      <input
                        key={i}
                        autoFocus
                        defaultValue={p}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (Number(v) > 0) {
                            const next = [...presets] as [string, string, string];
                            next[i] = v;
                            setPresetOverride(next);
                            writeLocalPresets(next);
                          }
                          setEditPreset(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        className="input h-6 w-14 text-[10px] mono px-1"
                      />
                    ) : (
                      <button
                        key={i}
                        onClick={() => setPresetIdx(i)}
                        onDoubleClick={() => setEditPreset(i)}
                        title={`P${i + 1} = ${p} SOL (double-click to edit)`}
                        className={cx("h-6 px-1.5 rounded text-[10px] mono", presetIdx === i ? "bg-accent-soft text-accent" : "text-text-3 hover:text-text-2")}
                      >
                        P{i + 1}
                      </button>
                    ),
                  )}
                </span>
                <button onClick={() => setMuted((m) => ({ ...m, [c.id]: !m[c.id] }))} title={muted[c.id] ? "Resume updates" : "Mute: stop re-rendering this column"} className={cx("w-6 h-6 rounded flex items-center justify-center", muted[c.id] ? "text-warn" : "text-text-3 hover:text-text-2")}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z" />{muted[c.id] ? <path d="m23 9-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />}</svg>
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                {!hydrated || (!connected && !feedDown && !list.length) ? (
                  <div className="flex items-center gap-2 text-xs text-text-3 p-3">
                    <Spinner size={14} /> Waiting for the feed snapshot…
                  </div>
                ) : feedDown && !list.length ? (
                  <Empty title="Feed stream unreachable">
                    /api/feed/stream did not answer. The server keeps one PumpPortal socket; check it is running.
                  </Empty>
                ) : !list.length ? (
                  <Empty title={query[c.id] ? "No match" : "Nothing here yet"}>{query[c.id] ? "Try another keyword." : `${c.blurb}. Cards appear as the feed sees them.`}</Empty>
                ) : (
                  (muted[c.id] ? list.slice(0, 100) : list).map((card) => <FeedCardView key={card.mint} card={card} now={now} preset={preset} hovered={hovered === card.mint} onHover={setHovered} />)
                )}
              </div>
              {frozen?.col === c.id ? <div className="h-6 shrink-0 flex items-center justify-center text-[10px] text-text-3 border-t border-line">order frozen while hovering · numbers keep updating</div> : null}
            </section>
          );
        })}
      </div>
      {hovered ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 h-9 rounded-lg bg-card border border-line shadow-xl text-[11px] fade-in">
          <span className="mono text-text-2">{short(hovered)}</span>
          {presets.map((p, i) => (
            <span key={i} className="flex items-center gap-1 text-text-3">
              <Kbd>{i + 1}</Kbd> {p}
            </span>
          ))}
          <Button size="xs" variant="ghost" onClick={() => router.push(`/trade/${hovered}`)}>
            Open
          </Button>
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
