"use client";
/** Block X /sol/portfolio (BEHAVIOUR.md §5): Developer Wallets / Groups tabs, toolbar, search, filter tabs, draggable
 *  wallet table, Activity (Disperse / Reverse Disperse jobs), right summary with PnL, actions (drawers) and Privacy
 *  funding; Consolidate / Distribute / Transfer turn the summary into the drag-and-drop transfer view.
 *  Marketplace uses AnySwap; Husher handles Mixer. Unwrap, Convert and Swap Stocks have no provider. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, EyeOff, ListOrdered, ArrowDownToLine, ArrowLeftRight, ArrowUpDown, ArrowUpFromLine, Calendar, Check, Copy, Droplet, FolderKanban, FolderPlus, KeyRound, Pencil, Plus, Search, Share2, Shuffle, Trash2, Undo2, Upload, Wallet, X } from "lucide-react";
import type { ActivityResponse, DashboardResponse, JobsListResponse, LaunchesResponse, PositionsResponse, WalletGroup, WalletInfo } from "@/lib/types";
import { del, failureMessage, post, useGet } from "@/lib/api";
import { useBalances, useSettings, useSolPrice, useVault, useWallets, walletsRes } from "@/lib/store";
import { short, sol, usd } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import { BxJob } from "@/components/bx/Job";
import { PnlCalendar, type DayPnl } from "@/components/bx/PnlCalendar";
import { PnlFees } from "@/components/bx/PnlFees";
import { SharePnlButton } from "@/components/bx/SharePnl";
import { AirdropModal, CreateModal, ExportModal, ImportModal, MoveModal, SendModal, type ModalKind } from "@/components/portfolio/BxModals";
import { DepositDrawer, DisperseDrawer, ReverseDisperseDrawer, type DrawerKind } from "@/components/portfolio/Drawers";
import { HusherMixer } from "@/components/portfolio/HusherMixer";
import { PrivateSendModal } from "@/components/portfolio/PrivateSend";
import { TrashModal } from "@/components/portfolio/TrashModal";
import { DRAG_MIME, TransferView, type TransferKind } from "@/components/portfolio/TransferView";

type Win = "1D" | "7D" | "30D" | "All";
const WIN_KEY: Record<Win, "24h" | "7d" | "30d" | "all"> = { "1D": "24h", "7D": "7d", "30D": "30d", All: "all" };
type SortKey = "sol" | "vol" | "tokens" | "launches";

export default function PortfolioPage() {
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const price = useSolPrice();
  const settings = useSettings();
  const [tab, setTab] = useState<"wallets" | "groups">("wallets");
  const [modal, setModal] = useState<ModalKind>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [transfer, setTransfer] = useState<TransferKind | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "archived" | string>("all");
  const [group, setGroup] = useState<string>("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [activityTab, setActivityTab] = useState<"disperse" | "reverse">("disperse");
  const [win, setWin] = useState<Win>("30D");
  const [unit, setUnit] = useState<"USD" | "SOL">("USD");
  const [calendar, setCalendar] = useState(false);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const canSign = vault.data?.unlocked ?? false;
  const all = wallets.data?.wallets ?? [];
  const live = all.filter((w) => !w.archived);
  const groups = wallets.data?.groups ?? [];
  const active = wallets.data?.active ?? null;
  const bal = balances.data ?? null;
  const solUsd = price.data?.usd ?? null;
  const cluster = settings.data?.cluster ?? "mainnet";
  const positions = useGet<PositionsResponse>(live.length ? "/api/positions" : null, 15000);
  const activity = useGet<ActivityResponse>("/api/activity?limit=500", 10000);
  const dash = useGet<DashboardResponse>(live.length ? "/api/dashboard" : null, 30000);
  const jobs = useGet<JobsListResponse>("/api/jobs", 4000);
  const launches = useGet<LaunchesResponse>("/api/dev/launches", 30000);
  const curGroup = tab === "groups" ? (groups.find((g) => g.id === group) ?? groups[0] ?? null) : null;
  /** where Create / Import put new wallets: the group shown on either tab (Groups tab, or a group sub-tab of Developer Wallets) */
  const targetGroup = tab === "groups" ? curGroup?.id : groups.some((g) => g.id === filter) ? filter : undefined;
  const scopeWallets = curGroup ? live.filter((w) => w.group === curGroup.id) : live;
  const scopeLabel = curGroup ? curGroup.name : "Developer Wallets";

  const balanceOf = (a: string) => Number(bal?.[a] ?? all.find((w) => w.address === a)?.sol ?? 0) || 0;
  const totalSol = scopeWallets.reduce((n, w) => n + balanceOf(w.address), 0);
  const tokensOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of positions.data ?? []) if (Number(r.amount) > 0) m.set(r.wallet, (m.get(r.wallet) ?? 0) + 1);
    return m;
  }, [positions.data]);
  /** SOL traded per wallet from the journal: exact for single-wallet entries, split evenly otherwise. */
  const volOf = useMemo(() => {
    const m = new Map<string, { sol: number; approx: boolean }>();
    for (const a of activity.data?.items ?? []) {
      const side = a.data?.side;
      const total = Number(a.data?.solTotal);
      if ((side !== "buy" && side !== "sell") || !Number.isFinite(total) || !a.wallets?.length) continue;
      for (const w of a.wallets) {
        const cur = m.get(w) ?? { sol: 0, approx: false };
        cur.sol += total / a.wallets.length;
        if (a.wallets.length > 1) cur.approx = true;
        m.set(w, cur);
      }
    }
    return m;
  }, [activity.data]);
  /** launches each wallet created as the dev: landed (token exists) + failed attempts */
  const launchesOf = useMemo(() => {
    const m = new Map<string, { ok: number; failed: number }>();
    for (const l of launches.data?.launches ?? []) {
      const cur = m.get(l.dev) ?? { ok: 0, failed: 0 };
      if (l.status === "launched") cur.ok++;
      else if (l.status === "failed") cur.failed++;
      m.set(l.dev, cur);
    }
    return m;
  }, [launches.data]);
  const pnl = dash.data?.pnl[WIN_KEY[win]];
  /** NET of every fee (on-chain ledger, every vault wallet) */
  const realised = pnl ? Number(pnl.netSol) : null;
  const volume = pnl ? Number(pnl.buysSol) + Number(pnl.sellsSol) : null;
  /** current value of the tokens the scoped wallets still hold (their cost is inside the net figure) */
  const unrealised = (positions.data ?? []).filter((r) => Number(r.amount) > 0 && scopeWallets.some((w) => w.address === r.wallet)).reduce((n, r) => n + Number(r.valueSol), 0);
  const openCost = dash.data ? Number(dash.data.openCostSol ?? 0) : 0;
  // null ("—") until the held tokens are read: realized alone would look like the total
  const totalPnl = realised === null || !positions.data ? null : realised + unrealised - openCost;
  const money = (s: number | null) => (s === null ? "—" : unit === "USD" && solUsd ? `${s < 0 ? "-" : ""}${usd(Math.abs(s) * solUsd, 2)}` : `${sol(s)} SOL`);
  const days = new Map<string, DayPnl>((dash.data?.days ?? []).map((x) => [x.date, x]));

  const rows = useMemo(() => {
    let list: WalletInfo[];
    if (tab === "groups") list = filter === "archived" ? all.filter((w) => w.archived && w.group === curGroup?.id) : curGroup ? live.filter((w) => w.group === curGroup.id) : [];
    else list = filter === "archived" ? all.filter((w) => w.archived) : live.filter((w) => filter === "all" || w.group === filter);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((w) => w.label.toLowerCase().includes(needle) || w.address.toLowerCase().includes(needle));
    list = [...list].sort((a, b) => a.order - b.order);
    if (sort) {
      const v = (w: WalletInfo) => (sort.key === "sol" ? balanceOf(w.address) : sort.key === "vol" ? (volOf.get(w.address)?.sol ?? 0) : sort.key === "launches" ? (launchesOf.get(w.address)?.ok ?? 0) : (tokensOf.get(w.address) ?? 0));
      list.sort((a, b) => (v(b) - v(a)) * sort.dir);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- balanceOf closes over bal/all
  }, [all, live, filter, q, sort, volOf, tokensOf, launchesOf, bal, tab, curGroup]);
  const sel = [...selected].filter((a) => all.some((w) => w.address === a));
  const allChecked = rows.length > 0 && rows.every((w) => selected.has(w.address));
  const toggleSort = (key: SortKey) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  const base = { wallets: live, groups, selected: sel, active, balances: bal };
  /** one wallet's key from its row (key icon) */
  const [exportOne, setExportOne] = useState<string | null>(null);
  const relayJobs = (jobs.data?.jobs ?? []).filter((j) => (activityTab === "disperse" ? j.kind === "disperse" || j.kind === "distribute" || j.kind === "transfer" : j.kind === "consolidate"));

  const bulk = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      walletsRes.refresh();
      setSelected(new Set());
      toast(ok, "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const groupAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      walletsRes.refresh();
      toast(ok, "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const openTransfer = (k: TransferKind) => {
    setDrawer(null);
    setCalendar(false);
    setTransfer(k);
  };
  const tabBtn = (on: boolean) => cx("-mb-px flex shrink-0 items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors", on ? "border-accent text-text-100" : "border-line-100 text-text-300 hover:border-line-200 hover:text-text-100");
  const subTab = (on: boolean) => cx("-mb-px shrink-0 border-b-2 px-3 py-2.5 text-xs transition-colors", on ? "border-accent text-text-100" : "border-line-100 text-text-300 hover:border-line-200 hover:text-text-100");
  const tool = "flex shrink-0 items-center gap-1 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ------------------------------------------------ left column */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 overflow-hidden" style={{ height: 388, minHeight: 388 }}>
              <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line-50 px-3 py-2 lg:gap-3 lg:px-4">
                  <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                    <button type="button" onClick={() => { setTab("wallets"); setFilter("all"); setSelected(new Set()); }} className={tabBtn(tab === "wallets")}>
                      <Wallet className="h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4" />
                      <span className="lg:hidden">Developer</span>
                      <span className="hidden lg:inline">Developer Wallets</span>
                    </button>
                    <button type="button" onClick={() => { setTab("groups"); setFilter("all"); setSelected(new Set()); }} className={tabBtn(tab === "groups")}>
                      <FolderKanban className="h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4" />
                      Groups
                    </button>
                    <Link href="/marketplace" className={tabBtn(false)}>Marketplace</Link>
                  </div>
                  <div className="relative z-10 shrink-0 bg-bg-100 pl-1 lg:hidden">
                    <button type="button" onClick={() => setModal("create")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover" aria-label="Wallet actions">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="hidden shrink-0 items-center lg:flex">
                    <div className="flex items-center gap-2 text-xs text-text-300">
                      {/* selection tools: always on Developer Wallets, on Groups as soon as wallets are ticked */}
                      {tab === "wallets" || sel.length > 0 ? (
                        <>
                          <button type="button" disabled={!canSign || !live.length} onClick={() => setModal("export")} className={tool} title={!canSign ? "Unlock the vault" : sel.length ? "Export the private keys of the selection" : "Export the private keys of every wallet"}>
                            <KeyRound className="h-3.5 w-3.5" />
                            Export Keys{sel.length ? ` (${sel.length})` : " (all)"}
                          </button>
                          <button type="button" disabled={!sel.length} onClick={() => setModal("move")} className={tool} title={!sel.length ? "Select wallets first" : "Move the selection into a group"}>
                            <FolderPlus className="h-3.5 w-3.5" />
                            Move
                          </button>
                          <button type="button" disabled={!sel.length} onClick={() => bulk(async () => { for (const a of sel) await post("/api/wallets/update", { address: a, archived: filter !== "archived" }); }, filter === "archived" ? "Unarchived" : "Archived")} className={tool}>
                            <Archive className="h-3.5 w-3.5" />
                            {filter === "archived" ? "Unarchive" : "Archive"}
                          </button>
                          <button
                            type="button"
                            disabled={!sel.length || !canSign}
                            onClick={() => {
                              if (confirm(`Move ${sel.length} wallet${sel.length !== 1 ? "s" : ""} to the trash? Their keys stay encrypted in the vault — restore them any time from Trash.`)) bulk(() => post("/api/wallets/remove", { addresses: sel }), "Moved to the trash");
                            }}
                            className={cx(tool, "hover:text-decrease")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                          <button type="button" disabled={!canSign} onClick={() => setTrashOpen(true)} className={tool} title="Deleted wallets — keys kept, restorable">
                            <Undo2 className="h-3.5 w-3.5" />
                            Trash
                          </button>
                        </>
                      ) : null}
                      <button type="button" disabled={!canSign} onClick={() => setModal("import")} className={tool}>
                        <Upload className="h-3.5 w-3.5" />
                        Import
                      </button>
                      <button type="button" disabled={!canSign} onClick={() => setModal("create")} className={tool}>
                        <Plus className="h-3.5 w-3.5" />
                        Create Wallets
                      </button>
                      {tab === "groups" ? (
                        newGroup === null ? (
                          <button type="button" onClick={() => setNewGroup("")} className="flex items-center gap-1 text-accent hover:text-accent-hover">
                            <Plus className="h-3.5 w-3.5" />
                            New Group
                          </button>
                        ) : (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const name = newGroup.trim();
                              if (!name) return;
                              groupAction(async () => { const r = await post<{ group: WalletGroup }>("/api/groups", { name }); setGroup(r.group.id); }, `Group “${name}” created`).then(() => setNewGroup(null));
                            }}
                          >
                            <input autoFocus value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNewGroup(null)} placeholder="Group name" className="h-7 w-32 rounded-md border border-line-100 bg-input-100 px-2 text-xs text-text-100 outline-none focus:border-accent" />
                            <button type="submit" disabled={!newGroup.trim()} className="h-7 rounded-md bg-accent px-2 text-xs font-medium text-white disabled:opacity-40">
                              Create
                            </button>
                            <button type="button" onClick={() => setNewGroup(null)} className="h-7 px-1 text-text-300 hover:text-text-100" aria-label="Cancel">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        )
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="relative border-b border-line-50 px-3 py-1.5 lg:px-4">
                  <div className="flex h-7 w-full items-center gap-2 rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-300">
                    <Search className="h-3 w-3 shrink-0" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address or name" type="text" className="w-full bg-transparent outline-none placeholder:text-text-300" />
                  </div>
                </div>
                <div className="flex min-w-0 items-stretch overflow-hidden border-b border-line-50">
                  <div className="relative min-w-0 flex-1 overflow-hidden">
                    <div className="no-scrollbar flex h-full w-full min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto overflow-y-hidden px-4">
                      {tab === "wallets" ? (
                        <>
                          <button type="button" onClick={() => setFilter("all")} className={subTab(filter === "all")}>
                            All ({live.length})
                          </button>
                          {groups.map((g) => (
                            <button key={g.id} type="button" onClick={() => setFilter(g.id)} className={subTab(filter === g.id)}>
                              {g.name} ({live.filter((w) => w.group === g.id).length})
                            </button>
                          ))}
                        </>
                      ) : (
                        groups.map((g) => {
                          const on = curGroup?.id === g.id && filter !== "archived";
                          return (
                            <div key={g.id} className="group/tab flex shrink-0 items-center">
                              {renaming === g.id ? (
                                <input
                                  autoFocus
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onBlur={() => {
                                    setRenaming(null);
                                    if (draft.trim() && draft.trim() !== g.name) groupAction(() => post(`/api/groups/${g.id}`, { name: draft.trim() }, "PATCH"), "Group renamed");
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    if (e.key === "Escape") setRenaming(null);
                                  }}
                                  className="mx-1 h-6 w-28 rounded border border-line-100 bg-input-100 px-1.5 text-xs text-text-100 outline-none focus:border-accent"
                                />
                              ) : (
                                <button type="button" onClick={() => { setGroup(g.id); setFilter("all"); setSelected(new Set()); }} className={subTab(on)}>
                                  {g.name} ({live.filter((w) => w.group === g.id).length})
                                </button>
                              )}
                              {on && renaming !== g.id ? (
                                <span className="flex items-center gap-0.5 pr-1">
                                  <button type="button" onClick={() => { setRenaming(g.id); setDraft(g.name); }} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-text-100" title="Rename group" aria-label="Rename group">
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button type="button" onClick={() => confirm(`Rename the wallets of “${g.name}” as ${g.name} 1, ${g.name} 2, ${g.name} 3…?`) && groupAction(() => post(`/api/groups/${g.id}`, { action: "number" }), `Wallets renamed ${g.name} 1, 2, 3…`)} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-text-100" title={`Rename its wallets ${g.name} 1, ${g.name} 2…`} aria-label="Number the wallets after the group">
                                    <ListOrdered className="h-3 w-3" />
                                  </button>
                                  <button type="button" onClick={() => confirm(`Delete group “${g.name}”? Its wallets stay in the vault.`) && groupAction(() => del(`/api/groups/${g.id}`), "Group deleted")} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-decrease" title="Delete group" aria-label="Delete group">
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </span>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0 border-l border-line-50 bg-bg-100 px-4">
                    <button type="button" onClick={() => setFilter("archived")} className={subTab(filter === "archived")}>
                      Archived ({tab === "groups" ? all.filter((w) => w.archived && w.group === curGroup?.id).length : all.length - live.length})
                    </button>
                  </div>
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto">
                  <table className="w-full min-w-[760px] table-fixed border-collapse">
                    <colgroup>
                      <col />
                      <col className="w-24" />
                      <col className="w-28" />
                      <col className="w-28" />
                      <col className="w-28" />
                      <col className="w-32" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-bg-100">
                      <tr className="border-b border-line-50 text-[11px] text-text-300">
                        <th className="px-3 py-2 text-left font-normal">
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1">
                              <input type="checkbox" className="pi-checkbox" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((w) => w.address)) : new Set())} />
                              Select All
                            </label>
                            <button type="button" disabled={!rows.length} onClick={() => balances.refresh()} className="rounded border border-line-100 px-1.5 py-0.5 text-[10px] text-text-300 transition-colors hover:border-line-200 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40" title="Refresh SOL balances">
                              SOL Bal
                            </button>
                            {transfer ? <span className="text-[10px] text-accent">drag rows into the {transfer} zones →</span> : null}
                          </div>
                        </th>
                        <SortTh label="Launches" onClick={() => toggleSort("launches")} on={sort?.key === "launches"} title="Sort by launches made as the dev" />
                        <SortTh label="Vol" onClick={() => toggleSort("vol")} on={sort?.key === "vol"} title="Sort by volume" />
                        <SortTh label="Tokens" onClick={() => toggleSort("tokens")} on={sort?.key === "tokens"} title="Sort by tokens" />
                        <SortTh label="SOL" onClick={() => toggleSort("sol")} on={sort?.key === "sol"} title="Sort by SOL" />
                        <th className="px-2 py-2 text-right font-normal" />
                      </tr>
                    </thead>
                    <tbody>
                      {wallets.error ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-xs text-decrease">
                            {failureMessage(wallets.error)}
                          </td>
                        </tr>
                      ) : !rows.length ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-xs text-text-300">
                            {wallets.loading && !wallets.data ? "Loading wallets…" : tab === "groups" ? (groups.length ? "No wallets in this group yet." : "No groups yet. Create one with New Group.") : filter === "archived" ? "No archived wallet." : q ? "No wallet matches." : "No developer wallets yet. Create one to manage launches."}
                          </td>
                        </tr>
                      ) : (
                        rows.map((w) => (
                          <WalletRow
                            key={w.address}
                            w={w}
                            groups={groups}
                            active={w.address === active}
                            checked={selected.has(w.address)}
                            onCheck={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(w.address); else n.delete(w.address); return n; })}
                            balance={balanceOf(w.address)}
                            tokens={tokensOf.get(w.address) ?? 0}
                            vol={volOf.get(w.address) ?? null}
                            launches={launchesOf.get(w.address) ?? null}
                            canSign={canSign}
                            dragPayload={selected.has(w.address) ? sel.join(",") : w.address}
                            draggable={!!transfer}
                          onExport={setExportOne}
                            />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <div className="group relative z-10 -my-1.5 flex h-[15px] w-full shrink-0 cursor-row-resize items-center justify-center" role="separator" aria-orientation="horizontal" aria-label="Resize wallet list and activity">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-100 transition-colors group-hover:bg-line-200" />
              <div className="relative z-[1] flex h-[3px] w-10 flex-row items-center justify-center gap-[2px] rounded-sm bg-line-100 transition-colors group-hover:bg-line-200" />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-4">
              <div className="mb-2 flex items-center gap-1 border-b border-line-50 pb-2">
                <button type="button" className="rounded bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent">
                  Activity
                </button>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {(["disperse", "reverse"] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setActivityTab(t)} className={cx("rounded border px-2.5 py-1 text-xs font-medium transition-colors", activityTab === t ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200 hover:border-accent/35 hover:text-text-100")}>
                      {t === "disperse" ? "Disperse" : "Reverse Disperse"}
                    </button>
                  ))}
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                  {!relayJobs.length ? <p className="px-1 py-6 text-sm text-text-300">{activityTab === "disperse" ? "No disperse tasks yet. Use Disperse in the summary panel to start one." : "No reverse disperse tasks yet. Use Reverse Disperse in the summary panel to start one."}</p> : relayJobs.map((j) => <div key={j.id} className="rounded-md border border-line-100 bg-bg-50 p-3"><BxJob jobId={j.id} /></div>)}
                </div>
              </div>
            </div>
          </div>

          <div className="group relative z-10 -mx-1.5 flex w-[15px] shrink-0 cursor-col-resize items-center justify-center" role="separator" aria-orientation="vertical" aria-label="Resize wallet summary">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-100 transition-colors group-hover:bg-line-200" />
            <div className="relative z-[1] flex h-10 w-[3px] flex-col items-center justify-center gap-[2px] rounded-sm bg-line-100 transition-colors group-hover:bg-line-200" />
          </div>

          {/* ------------------------------------------------ right summary */}
          <section className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden" style={{ width: 500, minWidth: 500, maxWidth: 500 }}>
            <div className="flex items-center justify-between gap-2 border-b border-line-50 px-3 py-2 sm:gap-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <h2 className="min-w-0 truncate text-sm font-medium text-text-100">
                  {tab === "groups" ? `Groups (${groups.length})` : `Developer Wallets (${live.length})`}
                </h2>
                <div className="flex items-center gap-1">
                  {(["1D", "7D", "30D", "All"] as Win[]).map((w) => (
                    <button key={w} type="button" onClick={() => setWin(w)} className={cx("rounded px-2 py-0.5 text-xs transition-colors", win === w ? "bg-accent-muted text-accent" : "text-text-300 hover:text-text-100")}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => { setCalendar((c) => !c); setTransfer(null); }} className={cx("flex shrink-0 items-center gap-1 text-xs hover:text-text-100", calendar ? "text-accent" : "text-text-300")}>
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">PNL Calendar</span>
                  <span className="sm:hidden">PNL</span>
                </button>
                <SharePnlButton period={win} label className="h-6 text-xs" />
              </div>
            </div>
            {transfer ? (
              <TransferView key={transfer} kind={transfer} wallets={live} balances={bal} onClose={() => setTransfer(null)} onDone={() => jobs.refresh()} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-col overflow-y-auto px-3 pb-4 sm:px-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text-300">Total Balance</span>
                    <button type="button" onClick={() => setUnit((u) => (u === "USD" ? "SOL" : "USD"))} title={unit === "USD" ? "Display SOL" : "Display USDC"} aria-label={`Display total balance in ${unit === "USD" ? "SOL" : "USDC"}`} className="relative flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] text-text-300 hover:bg-white/[0.04] hover:text-text-100">
                      {unit}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                    <div className="mt-1 flex h-9 items-baseline gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
                      <img src="/solana.svg" alt="" width={24} height={24} className="h-6 w-6 shrink-0 self-center object-contain" />
                      <div className="text-[28px] font-semibold leading-9 text-text-100 lg:text-[32px]">{sol(totalSol)}</div>
                      <div className="translate-y-[-1px] text-base font-medium text-text-100">{solUsd ? usd(totalSol * solUsd, 2) : "—"}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-row flex-wrap justify-between gap-y-2">
                    <div className="flex h-[18px] min-w-[calc(50%-16px)] items-center gap-2">
                      <span className="whitespace-nowrap text-sm text-text-300">{win} Total Volume</span>
                      <span className="text-sm font-medium text-text-100">{money(volume)}</span>
                    </div>
                    <div className="flex h-[18px] min-w-[calc(50%-16px)] items-center gap-2">
                      <span className="whitespace-nowrap text-sm text-text-300">{win} Net Realized</span>
                      <span className={cx("text-sm font-medium", realised === null ? "text-text-100" : realised > 0 ? "text-increase" : realised < 0 ? "text-decrease" : "text-text-100")}>{money(realised)}</span>
                    </div>
                    <div className="flex h-[18px] min-w-[calc(50%-16px)] items-center">
                      <span className="whitespace-nowrap text-sm text-text-300">Total PnL</span>
                      <button type="button" onClick={() => setUnit((u) => (u === "USD" ? "SOL" : "USD"))} className="ml-1 flex items-center gap-1 rounded px-1 text-[13px] text-text-300 hover:bg-white/[0.04] hover:text-text-100" title={unit === "USD" ? "Display PnL in SOL" : "Display PnL in USD"}>
                        <span>{unit}</span>
                      </button>
                      <span className={cx("ml-1 whitespace-nowrap text-sm font-medium", totalPnl === null ? "text-text-100" : totalPnl > 0 ? "text-increase" : totalPnl < 0 ? "text-decrease" : "text-text-100")}>{money(totalPnl)}</span>
                    </div>
                    <div className="flex h-[18px] min-w-[calc(50%-16px)] items-center gap-2">
                      <span className="whitespace-nowrap text-sm text-text-300">Holdings value</span>
                      <span className={cx("text-sm font-medium", unrealised > 0 ? "text-increase" : unrealised < 0 ? "text-decrease" : "text-text-100")}>{positions.data ? money(unrealised) : "—"}</span>
                    </div>
                  </div>
                  <PnlFees pnl={pnl} solUsd={solUsd} unit={unit} compact className="mt-2" />
                  <div className="mt-3.5 grid grid-cols-2 gap-2 lg:grid-cols-3">
                    <Action icon={<ArrowDownToLine className="h-4 w-4 shrink-0" />} label="Deposit" onClick={() => setDrawer("deposit")} />
                    <Action icon={<ArrowUpFromLine className="h-4 w-4 shrink-0" />} label="Withdraw" onClick={() => (live.length ? setModal("withdraw") : toast("Create or import a wallet to withdraw funds.", "info"))} disabled={!canSign} />
                    <Action icon={<Shuffle className="h-4 w-4 shrink-0" />} label="Consolidate" onClick={() => openTransfer("consolidate")} disabled={!canSign} />
                    <Action icon={<Share2 className="h-4 w-4 shrink-0" />} label="Distribute" onClick={() => openTransfer("distribute")} disabled={!canSign} />
                    <Action icon={<ArrowLeftRight className="h-4 w-4 shrink-0" />} label="Transfer" onClick={() => openTransfer("transfer")} disabled={!canSign} />
                    {cluster === "devnet" ? <Action icon={<Droplet className="h-4 w-4 shrink-0" />} label="Airdrop" onClick={() => setModal("airdrop")} disabled={!live.length} /> : null}
                  </div>
                  <div className="mt-3.5 border-t border-line-50 pt-3.5">
                    <p className="mb-2 text-[13px] font-medium text-text-100">Privacy funding</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Action icon={<Share2 className="h-4 w-4 shrink-0" />} label="Disperse" onClick={() => setDrawer("disperse")} disabled={!canSign} />
                      <Action icon={<Undo2 className="h-4 w-4 shrink-0" />} label="Reverse Disperse" onClick={() => setDrawer("reverse")} disabled={!canSign} />
                      <div className="col-span-2">
                        <Action icon={<EyeOff className="h-4 w-4 shrink-0" />} label="Private send" onClick={() => (live.length ? setModal("private") : toast("Create or import a wallet first.", "info"))} disabled={!canSign} />
                      </div>
                    </div>
                    <div className="mt-2"><Action icon={<ArrowLeftRight className="h-4 w-4 shrink-0" />} label="Mixer · Husher" onClick={() => setMixerOpen(true)} /></div>
                    <p className="mt-2 text-[11px] leading-snug text-text-300">Random amounts, random delays, random order, one fresh relay wallet per payment. Relays break the direct link only — they stay visible on-chain.</p>
                  </div>
                  {calendar ? (
                    <div className="mt-3.5 flex h-[420px] flex-col border-t border-line-50 pt-2">
                      <PnlCalendar days={days} solUsd={solUsd} unit={unit} />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {modal === "create" ? (
      <CreateModal
        key={`create-${modal === "create" ? "open" : "closed"}-${tab}-${curGroup?.id ?? ""}`}
        open
        onClose={() => setModal(null)}
        groups={groups}
        group={targetGroup}
        fromGroupsTab={tab === "groups"}
        onCreated={({ group: g }) => {
          if (g && tab === "wallets") {
            setFilter(g);
          } else if (g) {
            setGroup(g);
            setFilter("all");
          } else if (tab === "groups") {
            setTab("wallets");
            setFilter("all");
          }
          setSelected(new Set());
        }}
      />
      ) : null}
      {modal === "import" ? <ImportModal open onClose={() => setModal(null)} group={targetGroup} /> : null}
      {modal === "export" ? <ExportModal open onClose={() => setModal(null)} {...base} selected={sel.length ? sel : live.map((w) => w.address)} /> : null}
      {exportOne ? <ExportModal open onClose={() => setExportOne(null)} {...base} selected={[exportOne]} /> : null}
      {modal === "move" ? <MoveModal open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "withdraw" ? <SendModal kind="withdraw" open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "airdrop" ? <AirdropModal open onClose={() => setModal(null)} {...base} /> : null}
      {drawer === "deposit" ? <DepositDrawer onClose={() => setDrawer(null)} wallets={scopeWallets} selected={sel} active={active} balances={bal} /> : null}
      {trashOpen ? <TrashModal open onClose={() => setTrashOpen(false)} /> : null}
      {mixerOpen ? <HusherMixer onClose={() => setMixerOpen(false)} wallets={live} balances={bal} selected={sel} /> : null}
      {modal === "private" ? <PrivateSendModal onClose={() => setModal(null)} wallets={live} balances={bal} selected={sel} active={active} /> : null}
      {drawer === "disperse" ? <DisperseDrawer onClose={() => setDrawer(null)} wallets={live} groups={groups} balances={bal} selected={sel} active={active} scopeLabel={scopeLabel} scopeGroup={curGroup?.id ?? null} viewFilter={!curGroup && filter !== "all" && filter !== "archived" ? filter : null} onHistory={() => { setDrawer(null); setActivityTab("disperse"); }} /> : null}
      {drawer === "reverse" ? <ReverseDisperseDrawer onClose={() => setDrawer(null)} wallets={live} groups={groups} scopeLabel={scopeLabel} scopeGroup={curGroup?.id ?? null} balances={bal} /> : null}
    </div>
  );
}

function SortTh({ label, onClick, on, title }: { label: string; onClick: () => void; on: boolean; title: string }) {
  return (
    <th className="px-2 py-2 text-left font-normal">
      <button type="button" onClick={onClick} className={cx("inline-flex items-center gap-0.5 transition-colors hover:text-text-100", on ? "text-text-100" : "text-text-300")} title={title} aria-label={title}>
        <span>{label}</span>
        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>
    </th>
  );
}

function Action({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-line-100 bg-bg-50 px-2.5 text-[13px] font-medium text-text-200 transition-colors hover:border-accent/35 hover:bg-white/[0.04] hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40">
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function WalletRow({ w, groups, active, checked, onCheck, balance, tokens, vol, launches, canSign, dragPayload, draggable, onExport }: { w: WalletInfo; groups: WalletGroup[]; active: boolean; checked: boolean; onCheck: (v: boolean) => void; balance: number; tokens: number; vol: { sol: number; approx: boolean } | null; launches: { ok: number; failed: number } | null; canSign: boolean; dragPayload: string; draggable: boolean; onExport: (address: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(w.label);
  const [copied, setCopied] = useState(false);
  const group = w.group ? groups.find((g) => g.id === w.group)?.name : null;
  const commit = async () => {
    setEditing(false);
    if (label.trim() === w.label) return;
    try {
      await post("/api/wallets/update", { address: w.address, label: label.trim() });
      walletsRes.refresh();
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  return (
    <tr
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, dragPayload);
        e.dataTransfer.setData("text/plain", dragPayload);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={cx("border-b border-line-50 text-xs transition-colors hover:bg-hover-100", checked ? "bg-accent-muted/40" : "", draggable ? "cursor-grab active:cursor-grabbing" : "")}
      title={draggable ? "Drag into a Source / Target zone" : undefined}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <input type="checkbox" className="pi-checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${w.label}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {editing ? (
                <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setLabel(w.label); setEditing(false); } }} className="h-6 w-36 rounded border border-line-100 bg-input-100 px-1.5 text-xs text-text-100 outline-none focus:border-accent" />
              ) : (
                <button type="button" onClick={() => setEditing(true)} className="group/name inline-flex items-center gap-1 truncate font-medium text-text-100 hover:text-accent" title="Rename">
                  {w.label || short(w.address)}
                  <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/name:opacity-100" />
                </button>
              )}
              {group ? <span className="rounded border border-line-100 px-1 text-[10px] text-text-300">{group}</span> : null}
              {w.archived ? <span className="rounded border border-line-100 px-1 text-[10px] text-text-300">archived</span> : null}
            </div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(w.address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1000)))} className="inline-flex items-center gap-1 font-mono text-[11px] text-text-300 hover:text-text-100" title="Copy address">
              {short(w.address, 6, 6)} {copied ? <Check className="h-3 w-3 text-green-100" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 font-mono tabular-nums text-text-200" title={launches ? `${launches.ok} token(s) launched as the dev${launches.failed ? ` · ${launches.failed} failed attempt(s)` : ""}` : "No launch as the dev"}>
        {launches?.ok ? launches.ok : "—"}
        {launches?.failed ? <span className="ml-1 text-[10px] text-text-300">+{launches.failed} failed</span> : null}
      </td>
      <td className="px-2 py-2 font-mono tabular-nums text-text-200">{vol ? `${vol.approx ? "≈" : ""}${sol(vol.sol)}` : "—"}</td>
      <td className="px-2 py-2 font-mono tabular-nums text-text-200">{tokens}</td>
      <td className="px-2 py-2 font-mono tabular-nums text-text-100">{sol(balance)}</td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <button type="button" disabled={!canSign} onClick={() => onExport(w.address)} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100 disabled:opacity-40" title={canSign ? "Export this wallet's private key" : "Unlock the vault"}>
            <KeyRound className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => post("/api/wallets/update", { address: w.address, archived: !w.archived }).then(() => walletsRes.refresh()).catch((e) => toast(failureMessage(e), "err"))} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100" title={w.archived ? "Unarchive" : "Archive"}>
            <Archive className="h-3 w-3" />
          </button>
          <button type="button" disabled={!canSign} onClick={() => confirm(`Move ${w.label || short(w.address)} to the trash? Its key stays encrypted in the vault — restore it any time from Trash.`) && post("/api/wallets/remove", { addresses: [w.address] }).then(() => walletsRes.refresh()).catch((e) => toast(failureMessage(e), "err"))} className="flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-decrease disabled:opacity-40" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}
