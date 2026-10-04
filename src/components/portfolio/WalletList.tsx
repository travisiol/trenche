"use client";
import { useRef, useState } from "react";
import type { WalletGroup, WalletInfo } from "@/lib/ui-types";
import { short, sol } from "@/lib/format";
import { post, failureMessage } from "@/lib/api";
import { walletsRes } from "@/lib/store";
import { Button, Copy, cx, toast } from "../ui";

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

export function WalletRow({ w, active, balance, selected, onSelect, canSign, groups }: { w: WalletInfo; active: boolean; balance: string | null; selected: boolean; onSelect: (multi: boolean) => void; canSign: boolean; groups: WalletGroup[] }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(w.label);
  const commit = () => {
    setEditing(false);
    if (label.trim() !== w.label) update({ address: w.address, label: label.trim() });
  };
  return (
    <div
      className={cx("row flex items-center gap-2.5 px-3 rounded-lg border transition-colors cursor-pointer select-none", selected ? "bg-accent-soft border-accent/40" : "bg-card border-line hover:border-line-hover")}
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
    >
      <span className="text-text-3 cursor-grab" title="Drag to reorder" aria-hidden>
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2" r="1.3" /><circle cx="7.5" cy="2" r="1.3" /><circle cx="2.5" cy="7" r="1.3" /><circle cx="7.5" cy="7" r="1.3" /><circle cx="2.5" cy="12" r="1.3" /><circle cx="7.5" cy="12" r="1.3" /></svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
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
              className="input h-6 px-1.5 text-xs w-36"
            />
          ) : (
            <button
              className="text-xs font-medium truncate hover:text-accent text-left"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              {w.label || short(w.address)}
            </button>
          )}
          {active ? <span className="text-[10px] font-semibold px-1.5 h-4 rounded bg-accent text-white uppercase tracking-wide">Active</span> : null}
          {w.group ? <span className="text-[10px] px-1.5 h-4 rounded border border-line text-text-3 truncate max-w-[10ch]">{groups.find((g) => g.id === w.group)?.name ?? w.group}</span> : null}
        </div>
        <Copy text={w.address} className="text-[11px] text-text-3">
          {short(w.address, 5, 5)}
        </Copy>
      </div>
      <div className="text-right">
        <div className="mono text-xs">{sol(balance ?? w.sol)} <span className="text-text-3">SOL</span></div>
      </div>
      <RowMenu w={w} active={active} canSign={canSign} groups={groups} />
    </div>
  );
}

function RowMenu({ w, active, canSign, groups }: { w: WalletInfo; active: boolean; canSign: boolean; groups: WalletGroup[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Wallet actions" onClick={() => setOpen((o) => !o)} className="w-7 h-7 rounded-md text-text-3 hover:text-text hover:bg-white/5 flex items-center justify-center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-44 panel p-1 shadow-xl fade-in">
            {!active ? (
              <MenuItem onClick={() => post("/api/wallets/active", { address: w.address }).then(() => walletsRes.refresh()).catch((e) => toast(failureMessage(e), "err"))}>Set active</MenuItem>
            ) : null}
            <div className="px-2 pt-1.5 pb-0.5 label">Group</div>
            <MenuItem onClick={() => update({ address: w.address, group: null })} muted={!w.group}>No group</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} onClick={() => update({ address: w.address, group: g.id })} muted={w.group === g.id}>
                {g.name}
              </MenuItem>
            ))}
            <div className="h-px bg-line my-1" />
            <MenuItem onClick={() => update({ address: w.address, archived: !w.archived })}>{w.archived ? "Unarchive" : "Archive"}</MenuItem>
            <MenuItem
              danger
              disabled={!canSign}
              onClick={() => {
                if (confirm(`Remove ${w.label || short(w.address)} from the vault? Export its key first if it holds funds.`))
                  post("/api/wallets/remove", { addresses: [w.address] }).then(() => walletsRes.refresh()).catch((e) => toast(failureMessage(e), "err"));
              }}
            >
              Remove
            </MenuItem>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({ children, onClick, danger, muted, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; muted?: boolean; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className={cx("w-full text-left text-xs px-2 h-7 rounded-md hover:bg-white/5 disabled:opacity-40", danger ? "text-down" : muted ? "text-text-3" : "text-text-2 hover:text-text")}>
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
    <div className="flex flex-col gap-1.5">
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
    <div className="flex items-center gap-2 h-9 px-3 rounded-lg bg-card border border-line">
      <span className="text-xs font-medium">{g.name}</span>
      <span className="mono text-[11px] text-text-3">{count}</span>
      <Button size="xs" variant="ghost" className="ml-auto text-text-3" onClick={onRemove} title="Delete group">
        ×
      </Button>
    </div>
  );
}
