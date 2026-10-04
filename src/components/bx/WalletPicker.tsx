"use client";
/** Wallet picker with group chips: used by disperse / consolidate / dump / volume / launch tasks. */
import { Check, Tag } from "lucide-react";
import type { WalletGroup, WalletInfo } from "@/lib/types";
import { short, sol } from "@/lib/format";
import { cx } from "./ui";

export function WalletPicker({
  wallets,
  groups,
  value,
  onChange,
  balances,
  exclude,
  max,
  className,
}: {
  wallets: WalletInfo[];
  groups: WalletGroup[];
  value: string[];
  onChange: (v: string[]) => void;
  balances?: Record<string, string | null> | null;
  exclude?: string[];
  max?: number;
  className?: string;
}) {
  const list = wallets.filter((w) => !w.archived && !(exclude ?? []).includes(w.address));
  const toggle = (a: string) => onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  const groupAll = (id: string) => {
    const members = list.filter((w) => w.group === id).map((w) => w.address);
    const allIn = members.length > 0 && members.every((m) => value.includes(m));
    onChange(allIn ? value.filter((v) => !members.includes(v)) : Array.from(new Set([...value, ...members])));
  };
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.map((g) => {
          const members = list.filter((w) => w.group === g.id);
          const allIn = members.length > 0 && members.every((m) => value.includes(m.address));
          return (
            <button key={g.id} type="button" onClick={() => groupAll(g.id)} disabled={!members.length} className={cx("inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors disabled:opacity-40", allIn ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-200 hover:border-line-200 hover:text-text-100")} title={`${g.name}: ${members.length} wallet${members.length !== 1 ? "s" : ""}`}>
              {allIn ? <Check className="h-3 w-3" /> : <Tag className="h-3 w-3 text-text-300" />}
              {g.name} <span className="font-mono text-text-300">{members.length}</span>
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-text-300">
          <button type="button" className="hover:text-text-100" onClick={() => onChange(list.map((w) => w.address))}>
            All
          </button>
          {" · "}
          <button type="button" className="hover:text-text-100" onClick={() => onChange([])}>
            None
          </button>
          {" · "}
          <span className="font-mono tabular-nums">
            {value.length}
            {max ? `/${max}` : ""} selected
          </span>
        </span>
      </div>
      <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-line-100 bg-bg-50 p-1">
        {!list.length ? <p className="px-2 py-3 text-xs text-text-300">No wallet available.</p> : null}
        {list.map((w) => {
          const on = value.includes(w.address);
          const g = w.group ? groups.find((x) => x.id === w.group)?.name : null;
          return (
            <label key={w.address} className={cx("flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-xs", on ? "bg-accent-muted" : "hover:bg-hover-100")}>
              <input type="checkbox" className="pi-checkbox" checked={on} onChange={() => toggle(w.address)} disabled={!on && !!max && value.length >= max} />
              <span className="truncate text-text-100">{w.label || short(w.address)}</span>
              <span className="font-mono text-[11px] text-text-300">{short(w.address, 4, 4)}</span>
              {g ? <span className="rounded border border-line-100 px-1 text-[10px] text-text-300">{g}</span> : null}
              <span className="ml-auto font-mono tabular-nums text-text-200">{sol(balances?.[w.address] ?? w.sol)} SOL</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
