"use client";
/** Wallet trash: wallets removed from the list keep their key in the encrypted vault — listed here, restorable. */
import { useState } from "react";
import { ArchiveRestore, RotateCcw } from "lucide-react";
import { failureMessage, post, useGet } from "@/lib/api";
import { walletsRes } from "@/lib/store";
import { short } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxModal } from "@/components/bx/ui";

type Removed = { address: string; label: string; deletedAt: number };

export function TrashModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const res = useGet<{ wallets: Removed[] }>(open ? "/api/wallets/removed" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = res.data?.wallets ?? [];
  const restore = async (addresses: string[]) => {
    setBusy(addresses.length > 1 ? "all" : addresses[0]);
    try {
      await post("/api/wallets/restore", { addresses });
      toast(`${addresses.length} wallet${addresses.length !== 1 ? "s" : ""} restored`, "ok");
      res.refresh();
      void walletsRes.refresh();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  const recover = async () => {
    setBusy("recover");
    try {
      const r = await post<{ recovered: number; scanned: number; unreadable: number }>("/api/wallets/recover", {});
      toast(r.recovered ? `${r.recovered} wallet${r.recovered !== 1 ? "s" : ""} recovered into the trash` : `Nothing to recover (${r.scanned} backup${r.scanned !== 1 ? "s" : ""} read${r.unreadable ? `, ${r.unreadable} under another passphrase` : ""})`, r.recovered ? "ok" : "info");
      res.refresh();
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy(null);
    }
  };
  return (
    <BxModal
      open={open}
      onClose={onClose}
      title="Trash"
      width={560}
      headerRight={
        <div className="flex items-center gap-2">
          <BxButton onClick={recover} disabled={!!busy} title="Look into the vault backups for keys that are no longer in the vault (wallets deleted before the trash existed)">
            <ArchiveRestore className="h-3.5 w-3.5" /> {busy === "recover" ? "Reading backups…" : "Recover from backups"}
          </BxButton>
          {rows.length > 1 ? (
            <BxButton onClick={() => restore(rows.map((r) => r.address))} disabled={!!busy}>
              <RotateCcw className="h-3.5 w-3.5" /> Restore all
            </BxButton>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-2 p-4">
        <p className="text-xs text-text-300">Deleted wallets are never erased: their keys stay encrypted in the vault. Restore one to use it again.</p>
        {!res.data ? <p className="py-4 text-center text-[13px] text-text-300">{res.error ? failureMessage(res.error) : "…"}</p> : null}
        {res.data && !rows.length ? <p className="py-4 text-center text-[13px] text-text-300">The trash is empty.</p> : null}
        {rows.map((w) => (
          <div key={w.address} className="flex items-center gap-3 rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-[13px]">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-text-100">{w.label || short(w.address)}</div>
              <div className="font-mono text-[11px] text-text-300">
                {short(w.address, 6, 6)} · deleted {new Date(w.deletedAt).toLocaleString()}
              </div>
            </div>
            <BxButton size="sm" onClick={() => restore([w.address])} disabled={!!busy}>
              <RotateCcw className="h-3.5 w-3.5" /> {busy === w.address ? "…" : "Restore"}
            </BxButton>
          </div>
        ))}
      </div>
    </BxModal>
  );
}
