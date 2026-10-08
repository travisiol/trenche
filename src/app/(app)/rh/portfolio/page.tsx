"use client";
/** Robinhood mode › Portfolio: the Robinhood wallets (groups, create / import / export / move / remove, main = default
 *  dev), totals, creator fees, and the funding actions (Disperse one → many, Consolidate many → one, Send, Bridge). */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ArrowUpFromLine, FolderPlus, Gift, KeyRound, ListOrdered, Pencil, Plus, Search, Share2, Shuffle, Star, Trash2, Upload, Wallet, X } from "lucide-react";
import { failureMessage, post, useGet } from "@/lib/api";
import { age, short } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "@/components/bx/ui";
import type { ActivityResponse } from "@/lib/types";
import { Copyable, EthMark, ethNum, usdOf, useRhStatus, weiNum, type RhGroup, type RhWallet } from "@/components/rh/common";
import { RhConsolidateModal, RhCreateModal, RhDisperseModal, RhExportModal, RhImportModal, RhMoveModal, RhSendModal } from "@/components/rh/WalletModals";

type Modal = { kind: "create" | "import" | "move" | "disperse" | "consolidate" } | { kind: "send" | "export"; address: string } | null;

export default function RhPortfolioPage() {
  const status = useRhStatus(8000);
  const activity = useGet<ActivityResponse>("/api/activity?chain=robinhood&limit=120", 10000);
  const s = status.data;
  const wallets = useMemo(() => s?.wallets ?? [], [s]);
  const groups = s?.groups ?? [];
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [claiming, setClaiming] = useState(false);
  const refresh = () => status.refresh();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return wallets.filter((w) => (filter === "all" || (filter === "none" ? !w.group : w.group === filter)) && (!needle || w.label.toLowerCase().includes(needle) || w.address.toLowerCase().includes(needle)));
  }, [wallets, filter, q]);
  const sel = [...selected].filter((a) => wallets.some((w) => w.address === a));
  const allChecked = rows.length > 0 && rows.every((w) => selected.has(w.address));
  const total = weiNum(s?.totalWei);
  const fees = weiNum(s?.totalEscrowWei);
  const scopeTotal = rows.reduce((t, w) => t + weiNum(w.balanceWei), 0);
  const groupOf = filter !== "all" && filter !== "none" ? filter : "";

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      refresh();
      toast(ok, "ok");
    } catch (e) {
      toast(failureMessage(e), "err");
    }
  };
  const wpost = (body: Record<string, unknown>) => post("/api/robinhood/wallets", body);
  const claimAll = async () => {
    setClaiming(true);
    let got = 0;
    for (const w of wallets.filter((x) => weiNum(x.escrowWei) > 0)) {
      try {
        got += weiNum((await post<{ amountWei: string }>("/api/robinhood/claim", { wallet: w.address })).amountWei);
      } catch (e) {
        toast(`${w.label}: ${failureMessage(e)}`, "err");
      }
    }
    setClaiming(false);
    if (got) toast(`Claimed ${ethNum(got, 6)} ETH of creator fees`, "ok");
    refresh();
  };
  const sub = (on: boolean) => cx("-mb-px shrink-0 border-b-2 px-3 py-2.5 text-xs transition-colors", on ? "border-[#ccff00] text-text-100" : "border-line-100 text-text-300 hover:border-line-200 hover:text-text-100");
  const tool = "flex shrink-0 items-center gap-1 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ------------------------------------------------ wallets */}
        <section className="flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
          <div className="flex items-center gap-2 border-b border-line-50 px-3 py-2 lg:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Wallet className="h-4 w-4 text-text-300" />
              <span className="text-sm font-medium text-text-100">Robinhood Wallets</span>
              <span className="text-xs text-text-300">{wallets.length}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-text-300">
              <button type="button" disabled={!sel.length} onClick={() => setModal({ kind: "move" })} className={tool} title={sel.length ? "Move the selection into a group" : "Select wallets first"}>
                <FolderPlus className="h-3.5 w-3.5" /> Move{sel.length ? ` (${sel.length})` : ""}
              </button>
              <button type="button" onClick={() => setModal({ kind: "import" })} className={tool}>
                <Upload className="h-3.5 w-3.5" /> Import
              </button>
              <button type="button" onClick={() => setModal({ kind: "create" })} className={tool}>
                <Plus className="h-3.5 w-3.5" /> Create Wallets
              </button>
              {newGroup === null ? (
                <button type="button" onClick={() => setNewGroup("")} className="flex items-center gap-1 text-[#ccff00] hover:brightness-110">
                  <Plus className="h-3.5 w-3.5" /> New Group
                </button>
              ) : (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newGroup.trim();
                    if (!name) return;
                    void act(async () => {
                      const r = await post<{ group: RhGroup }>("/api/robinhood/wallets", { action: "group-create", name });
                      setFilter(r.group.id);
                    }, `Group “${name}” created`).then(() => setNewGroup(null));
                  }}
                >
                  <input autoFocus value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNewGroup(null)} placeholder="Group name" className="h-7 w-32 rounded-md border border-line-100 bg-input-100 px-2 text-xs text-text-100 outline-none focus:border-accent" />
                  <button type="submit" disabled={!newGroup.trim()} className="h-7 rounded-md bg-[#ccff00] px-2 text-xs font-medium text-black disabled:opacity-40">
                    Create
                  </button>
                  <button type="button" onClick={() => setNewGroup(null)} className="h-7 px-1 text-text-300 hover:text-text-100" aria-label="Cancel">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              )}
            </div>
          </div>
          <div className="border-b border-line-50 px-3 py-1.5 lg:px-4">
            <div className="flex h-7 w-full items-center gap-2 rounded-md border border-line-100 bg-bg-50 px-2 text-xs text-text-300">
              <Search className="h-3 w-3 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address or name" className="w-full bg-transparent outline-none placeholder:text-text-300" />
            </div>
          </div>
          <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto border-b border-line-50 px-4">
            <button type="button" onClick={() => setFilter("all")} className={sub(filter === "all")}>
              All ({wallets.length})
            </button>
            {groups.map((g) => {
              const on = filter === g.id;
              return (
                <div key={g.id} className="flex shrink-0 items-center">
                  {renaming === g.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        setRenaming(null);
                        if (draft.trim() && draft.trim() !== g.name) void act(() => wpost({ action: "group-rename", id: g.id, name: draft.trim() }), "Group renamed");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="mx-1 h-6 w-28 rounded border border-line-100 bg-input-100 px-1.5 text-xs text-text-100 outline-none focus:border-accent"
                    />
                  ) : (
                    <button type="button" onClick={() => setFilter(g.id)} className={sub(on)}>
                      {g.name} ({wallets.filter((w) => w.group === g.id).length})
                    </button>
                  )}
                  {on && renaming !== g.id ? (
                    <span className="flex items-center gap-0.5 pr-1">
                      <button type="button" onClick={() => { setRenaming(g.id); setDraft(g.name); }} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-text-100" title="Rename group">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          confirm(`Rename the wallets of “${g.name}” as ${g.name} 1, ${g.name} 2…?`) &&
                          void act(async () => {
                            const list = wallets.filter((w) => w.group === g.id);
                            for (const [i, w] of list.entries()) await wpost({ action: "rename", address: w.address, label: `${g.name} ${i + 1}` });
                          }, "Wallets renamed")
                        }
                        className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-text-100"
                        title={`Rename its wallets ${g.name} 1, ${g.name} 2…`}
                      >
                        <ListOrdered className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => confirm(`Delete group “${g.name}”? Its wallets stay.`) && void act(() => wpost({ action: "group-delete", id: g.id }), "Group deleted").then(() => setFilter("all"))} className="flex h-5 w-5 items-center justify-center rounded text-text-300 hover:text-decrease" title="Delete group">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
            <button type="button" onClick={() => setFilter("none")} className={sub(filter === "none")}>
              No group ({wallets.filter((w) => !w.group).length})
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[760px] table-fixed border-collapse">
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-36" />
                <col className="w-20" />
                <col className="w-32" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-bg-100">
                <tr className="border-b border-line-50 text-[11px] text-text-300">
                  <th className="px-3 py-2 text-left font-normal">
                    <input type="checkbox" className="pi-checkbox" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((w) => w.address)) : new Set())} aria-label="Select all" />
                  </th>
                  <th className="px-2 py-2 text-left font-normal">Wallet</th>
                  <th className="px-2 py-2 text-right font-normal">ETH</th>
                  <th className="px-2 py-2 text-right font-normal">Value</th>
                  <th className="px-2 py-2 text-right font-normal">Creator fees</th>
                  <th className="px-2 py-2 text-right font-normal">Launches</th>
                  <th className="px-3 py-2 text-right font-normal" />
                </tr>
              </thead>
              <tbody>
                {status.error && !s ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-decrease">
                      {failureMessage(status.error)}
                    </td>
                  </tr>
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-text-300">
                      {!s ? "Opening the Robinhood wallets…" : q ? "No wallet matches." : "No wallet here yet. Create some with Create Wallets."}
                    </td>
                  </tr>
                ) : (
                  rows.map((w) => (
                    <Row
                      key={w.address}
                      w={w}
                      groups={groups}
                      ethUsd={s?.ethUsd ?? null}
                      checked={selected.has(w.address)}
                      onCheck={(v) => setSelected((x) => { const n = new Set(x); if (v) n.add(w.address); else n.delete(w.address); return n; })}
                      onMain={() => void act(() => wpost({ action: "main", address: w.address }), `${w.label} is the main wallet`)}
                      onRename={(label) => void act(() => wpost({ action: "rename", address: w.address, label }), "Renamed")}
                      onSend={() => setModal({ kind: "send", address: w.address })}
                      onExport={() => setModal({ kind: "export", address: w.address })}
                      onRemove={() => confirm(`Remove ${w.label}? The key stays encrypted in eth-wallet.enc.json (re-import it to bring it back).`) && void act(() => wpost({ action: "remove", address: w.address }), `${w.label} removed`)}
                      onClaim={() => void act(() => post("/api/robinhood/claim", { wallet: w.address }), "Creator fees claimed")}
                      canRemove={wallets.length > 1}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ------------------------------------------------ summary */}
        <section className="flex shrink-0 flex-col border-t lg:min-h-0 lg:overflow-y-auto border-line-100 lg:w-[460px] lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-4 px-4 py-4">
            <div>
              <span className="text-sm text-text-300">Total Balance</span>
              <div className="mt-1 flex items-baseline gap-2">
                <EthMark className="h-6 w-6 self-center text-[#ccff00]" />
                <span className="text-[30px] font-semibold leading-9 text-text-100">{s ? ethNum(total, 5) : "—"}</span>
                <span className="text-sm text-text-300">ETH</span>
                <span className="text-base font-medium text-text-100">{usdOf(total, s?.ethUsd)}</span>
              </div>
              {filter !== "all" ? <p className="mt-1 text-xs text-text-300">This view: {ethNum(scopeTotal, 5)} ETH · {usdOf(scopeTotal, s?.ethUsd)}</p> : null}
            </div>
            <div className="flex items-center justify-between rounded-md border border-line-100 bg-bg-50 px-3 py-2.5">
              <div>
                <p className="text-xs text-text-300">Creator fees waiting (Pons escrow)</p>
                <p className={cx("font-mono text-sm", fees > 0 ? "text-increase" : "text-text-100")}>
                  {ethNum(fees, 6)} ETH <span className="text-text-300">{usdOf(fees, s?.ethUsd)}</span>
                </p>
              </div>
              <button type="button" disabled={!(fees > 0) || claiming} onClick={() => void claimAll()} className="inline-flex h-8 items-center gap-1.5 rounded border border-line-100 bg-bg-100 px-2.5 text-xs font-medium text-text-200 transition-colors hover:border-[#ccff00]/50 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40">
                <Gift className="h-3.5 w-3.5" /> {claiming ? "Claiming…" : "Claim all"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Action icon={<Share2 className="h-4 w-4" />} label={`Disperse${sel.length ? ` → ${sel.length}` : ""}`} onClick={() => setModal({ kind: "disperse" })} disabled={!wallets.length} />
              <Action icon={<Shuffle className="h-4 w-4" />} label={`Consolidate${sel.length ? ` (${sel.length})` : ""}`} onClick={() => setModal({ kind: "consolidate" })} disabled={wallets.length < 2} />
              <Action icon={<ArrowUpFromLine className="h-4 w-4" />} label="Send" onClick={() => setModal({ kind: "send", address: sel[0] ?? wallets.find((w) => w.main)?.address ?? "" })} disabled={!wallets.length} />
              <Link href="/rh/bridge" className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-line-100 bg-bg-50 px-2.5 text-[13px] font-medium text-text-200 transition-colors hover:border-[#ccff00]/40 hover:bg-white/[0.04] hover:text-text-100">
                <ArrowLeftRight className="h-4 w-4" /> Bridge
              </Link>
            </div>
            <p className="text-[11px] leading-snug text-text-300">Tick wallets in the list to disperse to them or consolidate from them. The ★ main wallet is the default dev of a launch.</p>
            <div className="border-t border-line-50 pt-3">
              <p className="mb-2 text-[13px] font-medium text-text-100">Activity</p>
              <div className="flex flex-col gap-1">
                {(activity.data?.items ?? []).slice(0, 40).map((a) => (
                  <div key={a.id} className="flex items-start gap-2 rounded px-1 py-1 text-[11px] hover:bg-white/[0.02]">
                    <span className={cx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", a.ok ? "bg-increase" : "bg-decrease")} />
                    <span className="min-w-0 flex-1 text-text-200">{a.message}</span>
                    <span className="shrink-0 text-text-300">{age(a.at)}</span>
                  </div>
                ))}
                {!activity.data?.items.length ? <p className="text-xs text-text-300">Nothing yet.</p> : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      {modal?.kind === "create" ? <RhCreateModal groups={groups} group={groupOf} onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal?.kind === "import" ? <RhImportModal groups={groups} group={groupOf} onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal?.kind === "move" ? <RhMoveModal groups={groups} addresses={sel} onClose={() => setModal(null)} onDone={() => (refresh(), setSelected(new Set()))} /> : null}
      {modal?.kind === "export" ? <RhExportModal address={modal.address} onClose={() => setModal(null)} /> : null}
      {modal?.kind === "send" ? <RhSendModal from={modal.address} wallets={wallets} onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal?.kind === "disperse" ? <RhDisperseModal wallets={wallets} groups={groups} selected={sel} onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal?.kind === "consolidate" ? <RhConsolidateModal wallets={wallets} selected={sel} onClose={() => setModal(null)} onDone={refresh} /> : null}
    </div>
  );
}

function Action({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-line-100 bg-bg-50 px-2.5 text-[13px] font-medium text-text-200 transition-colors hover:border-[#ccff00]/40 hover:bg-white/[0.04] hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-40">
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function Row({
  w,
  groups,
  ethUsd,
  checked,
  onCheck,
  onMain,
  onRename,
  onSend,
  onExport,
  onRemove,
  onClaim,
  canRemove,
}: {
  w: RhWallet;
  groups: RhGroup[];
  ethUsd: number | null;
  checked: boolean;
  onCheck: (v: boolean) => void;
  onMain: () => void;
  onRename: (label: string) => void;
  onSend: () => void;
  onExport: () => void;
  onRemove: () => void;
  onClaim: () => void;
  canRemove: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(w.label);
  const bal = w.balanceWei === null ? null : weiNum(w.balanceWei);
  const esc = weiNum(w.escrowWei);
  const group = w.group ? groups.find((g) => g.id === w.group)?.name : null;
  const icon = "flex h-6 w-6 items-center justify-center rounded text-text-300 hover:bg-hover-200 hover:text-text-100 disabled:opacity-40";
  return (
    <tr className={cx("border-b border-line-50 text-xs transition-colors hover:bg-hover-100", checked && "bg-accent-muted/40")}>
      <td className="px-3 py-2">
        <input type="checkbox" className="pi-checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${w.label}`} />
      </td>
      <td className="px-2 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={onMain} disabled={w.main} title={w.main ? "Main wallet: default dev of a launch" : "Make it the main wallet"} className={cx("shrink-0", w.main ? "text-[#ccff00]" : "text-text-300 hover:text-text-100")}>
            <Star className={cx("h-3.5 w-3.5", w.main && "fill-current")} />
          </button>
          {editing ? (
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (label.trim() && label.trim() !== w.label) onRename(label.trim());
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="h-6 w-36 rounded border border-line-100 bg-input-100 px-1.5 text-xs text-text-100 outline-none focus:border-accent"
            />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="group/n inline-flex items-center gap-1 truncate font-medium text-text-100 hover:text-accent" title="Rename">
              {w.label}
              <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/n:opacity-100" />
            </button>
          )}
          {group ? <span className="rounded border border-line-100 px-1 text-[10px] text-text-300">{group}</span> : null}
        </div>
        <Copyable text={w.address} label={short(w.address, 6, 6)} className="text-[11px] text-text-300" />
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-text-100">{bal === null ? "—" : ethNum(bal, 6)}</td>
      <td className="px-2 py-2 text-right text-text-200">{usdOf(bal, ethUsd)}</td>
      <td className="px-2 py-2 text-right">
        <span className="inline-flex items-center gap-1.5">
          <span className={cx("font-mono", esc > 0 ? "text-increase" : "text-text-300")}>{ethNum(esc, 6)}</span>
          {esc > 0 ? (
            <button type="button" onClick={onClaim} className="rounded border border-line-100 px-1.5 py-0.5 text-[10px] text-text-200 hover:text-text-100">
              Claim
            </button>
          ) : null}
        </span>
      </td>
      <td className="px-2 py-2 text-right text-text-200">{w.launches || "—"}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" onClick={onSend} className={icon} title="Send ETH">
            <ArrowUpFromLine className="h-3 w-3" />
          </button>
          <button type="button" onClick={onExport} className={icon} title="Export private key">
            <KeyRound className="h-3 w-3" />
          </button>
          <button type="button" onClick={onRemove} disabled={!canRemove} className={cx(icon, "hover:text-decrease")} title="Remove (key kept encrypted)">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}
