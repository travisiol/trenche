"use client";
import { useRef, useState } from "react";
import type { WalletGroup, WalletInfo } from "@/lib/types";
import { short, sol } from "@/lib/format";
import { post, failureMessage } from "@/lib/api";
import { walletsRes } from "@/lib/store";
import { Copy, cx, toast } from "../ui";
import { Icon } from "../icons";

type Props = {
  wallets: WalletInfo[];
  groups: WalletGroup[];
  active: string | null;
  balances: Record<string, string | null> | null;
  selected: Set<string>;
  onSelect: (addr: string, multi: boolean) => void;
  canSign: boolean;
};

async function update(body: Record<string, unknown>) {
  try {
    await post("/api/wallets/update", body);
    walletsRes.refresh();
  } catch (e) {
    toast(failureMessage(e), "err");
  }
}

/** 48px row: handle · label (click to rename) + short address with copy · group chip · active badge · balance · menu */
export function WalletRow({ w, active, balance, selected, onSelect, canSign, groups }: { w: WalletInfo; active: boolean; balance: string | null; selected: boolean; onSelect: (multi: boolean) => void; canSign: boolean; groups: WalletGroup[] }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(w.label);
  const commit = () => {
    setEditing(false);
    if (label.trim() !== w.label) update({ address: w.address, label: label.trim() });
  };
  const groupName = w.group ? (groups.find((g) => g.id === w.group)?.name ?? w.group) : null;
  return (
    <div
      className={cx("flex items-center gap-3 h-12 px-3 rounded-lg border transition-colors cursor-pointer select-none", selected ? "bg-accent-soft border-accent/40" : "bg-card border-line hover:border-line-hover")}
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
      aria-selected={selected}
    >
      <span className="text-text-3 cursor-grab shrink-0" title="Drag to reorder" aria-hidden>
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2" r="1.3" /><circle cx="7.5" cy="2" r="1.3" /><circle cx="2.5" cy="7" r="1.3" /><circle cx="7.5" cy="7" r="1.3" /><circle cx="2.5" cy="12" r="1.3" /><circle cx="7.5" cy="12" r="1.3" /></svg>
      </span>
      <div className="min-w-0 flex-1 flex items-center gap-2">
        {editing ? (
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setLabel(w.label);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="input h-8 px-2 text-sm w-36"
            aria-label="Wallet name"
          />
        ) : (
          <button
            className="text-sm font-medium truncate hover:text-accent text-left shrink min-w-0"
            title="Click to rename"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {w.label || short(w.address)}
          </button>
        )}
        <Copy text={w.address} className="text-[13px] text-text-3 shrink-0">
          {short(w.address, 4, 4)}
        </Copy>
        {active ? <span className="text-[11px] leading-4 font-semibold px-1.5 py-0.5 rounded bg-accent text-white uppercase tracking-wide shrink-0">Active</span> : null}
        {groupName ? (
          <span className="hidden sm:inline-flex items-center gap-1 text-[13px] px-2 h-6 rounded-md border border-line text-text-2 truncate max-w-[12ch] shrink-0" title={`Group: ${groupName}`}>
            <Icon name="tag" size={12} className="text-text-3" />
            {groupName}
          </span>
        ) : null}
      </div>
      <div className="text-right shrink-0 mono text-sm">
        {sol(balance ?? w.sol)} <span className="text-text-3">SOL</span>
      </div>
      <RowMenu w={w} active={active} canSign={canSign} groups={groups} />
    </div>
  );
}

function RowMenu({ w, active, canSign, groups }: { w: WalletInfo; active: boolean; canSign: boolean; groups: WalletGroup[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Wallet actions" onClick={() => setOpen((o) => !o)} className="w-8 h-8 rounded-md text-text-3 hover:text-text hover:bg-white/5 flex items-center justify-center">
        <Icon name="more" size={16} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-52 panel p-1.5 shadow-2xl fade-in">
            {!active ? (
              <MenuItem icon="check" onClick={() => post("/api/wallets/active", { address: w.address }).then(() => walletsRes.refresh()).catch((e) => toast(failureMessage(e), "err"))}>
                Set as active wallet
              </MenuItem>
            ) : null}
            <div className="px-2 pt-2 pb-1 label">Group</div>
            <MenuItem onClick={() => update({ address: w.address, group: null })} muted={!w.group}>
              No group
            </MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} icon={w.group === g.id ? "check" : undefined} onClick={() => update({ address: w.address, group: g.id })} muted={w.group === g.id}>
                {g.name}
              </MenuItem>
            ))}
            {!groups.length ? <p className="hint px-2 pb-1">No group yet — create one above.</p> : null}
            <div className="h-px bg-line my-1" />
            <MenuItem icon="archive" onClick={() => update({ address: w.address, archived: !w.archived })}>
              {w.archived ? "Unarchive" : "Archive"}
            </MenuItem>
            <MenuItem
              icon="trash"
              danger
              disabled={!canSign}
              onClick={() => {
                if (confirm(`Remove ${w.label || short(w.address)} from the vault? Export its key first if it holds funds.`))
                  post("/api/wallets/remove", { addresses: [w.address] }).then(() => walletsRes.refresh()).catch((e) => toast(failureMessage(e), "err"));
              }}
            >
              Remove from vault
            </MenuItem>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({ children, onClick, danger, muted, disabled, icon }: { children: React.ReactNode; onClick: () => void; danger?: boolean; muted?: boolean; disabled?: boolean; icon?: "check" | "archive" | "trash" }) {
  return (
    <button disabled={disabled} onClick={onClick} className={cx("w-full text-left text-sm px-2 h-9 rounded-md hover:bg-white/5 disabled:opacity-40 flex items-center gap-2", danger ? "text-down" : muted ? "text-text-3" : "text-text-2 hover:text-text")}>
      {icon ? <Icon name={icon} size={14} /> : <span className="w-3.5" />}
      {children}
    </button>
  );
}

/** Drag-to-reorder list; order is persisted with `POST /api/wallets/update {order}` per moved row. */
export function WalletList({ wallets, groups, active, balances, selected, onSelect, canSign }: Props) {
  const dragFrom = useRef<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const sorted = [...wallets].sort((a, b) => a.order - b.order);

  const drop = async (to: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDrag(null);
    setOver(null);
    if (from === null || from === to) return;
    const next = [...sorted];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const changed = next.map((w, i) => ({ w, i })).filter(({ w, i }) => w.order !== i);
    walletsRes.mutate({ wallets: wallets.map((w) => ({ ...w, order: next.findIndex((n) => n.address === w.address) })), groups, active, unlocked: true });
    try {
      for (const { w, i } of changed) await post("/api/wallets/update", { address: w.address, order: i });
    } catch (e) {
      toast(failureMessage(e), "err");
    }
    walletsRes.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((w, i) => (
        <div
          key={w.address}
          draggable
          onDragStart={() => {
            dragFrom.current = i;
            setDrag(i);
          }}
          onDragEnd={() => {
            dragFrom.current = null;
            setDrag(null);
            setOver(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (over !== i) setOver(i);
          }}
          onDragLeave={() => over === i && setOver(null)}
          onDrop={() => drop(i)}
          className={cx(over === i && drag !== i ? "ring-1 ring-accent rounded-lg" : "")}
        >
          <WalletRow w={w} active={w.address === active} balance={balances?.[w.address] ?? null} selected={selected.has(w.address)} onSelect={(multi) => onSelect(w.address, multi)} canSign={canSign} groups={groups} />
        </div>
      ))}
    </div>
  );
}

export function GroupChip({ g, count, onRemove }: { g: WalletGroup; count: number; onRemove: () => void }) {
  return (
    <div className="inline-flex items-center gap-2 h-9 pl-3 pr-1 rounded-lg bg-card border border-line text-sm">
      <Icon name="tag" size={13} className="text-text-3" />
      <span className="font-medium">{g.name}</span>
      <span className="mono text-[13px] text-text-3">
        {count} wallet{count !== 1 ? "s" : ""}
      </span>
      <button className="w-7 h-7 rounded-md text-text-3 hover:text-down hover:bg-white/5 flex items-center justify-center" onClick={onRemove} title="Delete group (wallets stay)" aria-label={`Delete group ${g.name}`}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
