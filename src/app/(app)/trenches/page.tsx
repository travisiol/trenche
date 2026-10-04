"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Icon3D } from "@/components/Icon3D";
import { Icon } from "@/components/icons";
import { Button, Dot, Empty, Field, Input, Kbd, Loading, Popover, Segmented, Toggle, cx, toast } from "@/components/ui";
import { FeedCardView } from "@/components/trenches/FeedCard";
import { publishFeedStatus, useFeedStatus } from "@/components/feed-status";
import { failureMessage, post, useSSE } from "@/lib/api";
import { DEFAULT_PRESETS, readLocalPresets, solPriceRes, useSettings, useVault, useWallets, writeLocalPresets } from "@/lib/store";
import { short } from "@/lib/format";
import type { FeedCard, FeedColumn, FeedMigrate, FeedSnapshot, FeedStatus } from "@/lib/types";

type Cols = Record<FeedColumn, FeedCard[]>;
const EMPTY: Cols = { new: [], almost: [], migrated: [] };
const COLS: { id: FeedColumn; title: string; blurb: string }[] = [
  { id: "new", title: "New", blurb: "Created in the last 30 minutes, under 85 % bonded" },
  { id: "almost", title: "Almost bonded", blurb: "85 % and above, not migrated yet" },
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
  const feedWord = status.connected ? `Live · ${status.tracked} curves polled${status.tradesLive ? " · real trade events" : " · volume estimated from curve polling"}` : feedDown ? "Feed stream unreachable" : "Connecting…";

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full">
      {/* compact page header: this page is full height */}
      <div className="flex items-center gap-3 px-4 md:px-6 min-h-14 py-2 border-b border-line shrink-0 flex-wrap">
        <Icon3D name="trenches" size={28} glow />
        <div className="min-w-0">
          <h1 className="text-[17px] leading-6 font-semibold tracking-tight">Trenches</h1>
          <p className="text-[13px] text-text-2 flex items-center gap-2">
            <Dot tone={status.connected ? "up" : feedDown ? "down" : "muted"} pulse={status.connected} />
            {feedWord}
            {status.error ? <span className="text-down truncate">· {status.error}</span> : null}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <span className="hidden lg:flex items-center gap-2 text-[13px] text-text-2">
            Hover a card, press <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> to buy its preset · <Kbd>Esc</Kbd> clears
          </span>
          <Segmented
            size="xs"
            value={String(presetIdx) as "0" | "1" | "2"}
            onChange={(v) => setPresetIdx(Number(v))}
            options={presets.map((p, i) => ({ value: String(i) as "0", label: `${p} SOL` }))}
          />
          <span className="md:hidden">
            <Segmented size="xs" value={mobileCol} onChange={setMobileCol} options={COLS.map((c) => ({ value: c.id, label: c.title }))} />
          </span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 md:p-6 min-h-0">
        {COLS.map((c) => {
          const list = visible(c.id);
          const filtered = !!query[c.id] || muted[c.id];
          return (
            <section key={c.id} className={cx("panel flex flex-col min-h-0", c.id !== mobileCol ? "hidden md:flex" : "flex")} onMouseEnter={() => setFrozen({ col: c.id, order: colsRef.current[c.id].map((x) => x.mint) })} onMouseLeave={() => setFrozen((f) => (f?.col === c.id ? null : f))}>
              <header className="flex items-center gap-2 px-4 min-h-14 border-b border-line shrink-0">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold">
                    {c.title} <span className="mono text-[13px] text-text-3 font-normal">{cols[c.id].length}</span>
                  </h2>
                  <p className="hint truncate">{c.blurb}</p>
                </div>
                <Popover
                  width={300}
                  trigger={(open) => (
                    <Button size="sm" icon="filter" className={cx(open || filtered ? "border-accent text-accent" : "")} aria-label={`Filters for ${c.title}`}>
                      Filters
                    </Button>
                  )}
                >
                  <div className="flex flex-col gap-4">
                    <Field label="Keyword" hint="Symbol, name or mint.">
                      <Input value={query[c.id]} onChange={(e) => setQuery((q) => ({ ...q, [c.id]: e.target.value }))} placeholder="Search this column…" className="h-9 text-[13px]" />
                    </Field>
                    <Field label="Quick-buy presets" hint="Used by the Buy button and keys 1, 2, 3. Saved on this machine.">
                      <div className="grid grid-cols-3 gap-2">
                        {presets.map((p, i) => (
                          <Input key={i} type="number" step="0.01" min={0} defaultValue={p} onBlur={(e) => setPresetValue(i, e.target.value.trim())} mono suffix="SOL" className="h-9 text-[13px]" aria-label={`Preset ${i + 1}`} />
                        ))}
                      </div>
                    </Field>
                    <Toggle checked={muted[c.id]} onChange={(v) => setMuted((m) => ({ ...m, [c.id]: v }))} label="Mute this column (keeps the first 100 cards, stops re-rendering)" />
                  </div>
                </Popover>
              </header>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                {!hydrated || (!connected && !feedDown && !list.length) ? (
                  <Loading>Waiting for the feed snapshot…</Loading>
                ) : feedDown && !list.length ? (
                  <Empty title="Feed stream unreachable">/api/feed/stream did not answer. The server keeps one PumpPortal socket; check that it is running and reload.</Empty>
                ) : !list.length ? (
                  <Empty title={query[c.id] ? "No match" : "Nothing here yet"}>{query[c.id] ? "Try another keyword or clear the filter." : `${c.blurb}. Cards appear as the feed sees them.`}</Empty>
                ) : (
                  (muted[c.id] ? list.slice(0, 100) : list).map((card) => <FeedCardView key={card.mint} card={card} now={now} preset={preset} hovered={hovered === card.mint} onHover={setHovered} />)
                )}
              </div>
              {frozen?.col === c.id ? (
                <div className="min-h-8 shrink-0 flex items-center justify-center gap-2 text-[13px] text-text-3 border-t border-line">
                  <Icon name="eye" size={13} /> Order frozen while you hover · numbers keep updating
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {hovered ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 h-11 rounded-lg bg-card border border-line shadow-xl text-[13px] fade-in">
          <span className="mono text-text-2">{short(hovered)}</span>
          {presets.map((p, i) => (
            <span key={i} className="flex items-center gap-1.5 text-text-2">
              <Kbd>{i + 1}</Kbd> {p} SOL
            </span>
          ))}
          <Button size="xs" variant="ghost" onClick={() => router.push(`/trade/${hovered}`)} icon="arrowRight">
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
