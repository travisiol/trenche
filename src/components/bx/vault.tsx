"use client";
/** Vault lock / unlock in Block X components (the user pill of the top bar opens this). */
import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { BxButton, BxInput, BxLabel, BxModal } from "./ui";
import { refreshVaultDependents, useVault } from "@/lib/store";
import { failureMessage, post } from "@/lib/api";
import { toast } from "@/components/ui";

export async function lockVault() {
  try {
    await post("/api/vault/lock", {});
    refreshVaultDependents();
    toast("Vault locked", "info");
  } catch (e) {
    toast(failureMessage(e), "err");
  }
}

export function UnlockVaultModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post("/api/vault/unlock", { passphrase: pass });
      refreshVaultDependents();
      setPass("");
      onClose();
      toast("Vault unlocked", "ok");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BxModal open={open} onClose={onClose} title="Unlock vault" width={400}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-4">
        <p className="text-[13px] text-text-300">Decrypts your keys in memory so you can sign. Lock again when you leave.</p>
        <div>
          <BxLabel>Passphrase</BxLabel>
          <BxInput type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Your keystore passphrase" autoFocus />
        </div>
        {err ? <p className="text-[13px] text-decrease">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <BxButton onClick={onClose}>Cancel</BxButton>
          <BxButton type="submit" variant="primary" disabled={!pass || busy}>
            <LockOpen className="h-3.5 w-3.5" /> Unlock
          </BxButton>
        </div>
      </form>
    </BxModal>
  );
}

/** The user pill: vault state + lock/unlock. */
export function VaultPill() {
  const vault = useVault();
  const [open, setOpen] = useState(false);
  const unlocked = vault.data?.unlocked ?? false;
  const exists = vault.data?.exists ?? false;
  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${unlocked ? "border-green-100/40 bg-green-100/10 text-green-100" : "border-line-100 bg-bg-100 text-text-300"}`}>{unlocked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}</span>
        <span className="max-w-[120px] truncate text-xs text-text-200">{!exists ? "No vault" : unlocked ? "Vault unlocked" : "Vault locked"}</span>
        <button type="button" disabled={!exists} onClick={() => (unlocked ? lockVault() : setOpen(true))} className="rounded-md px-2 py-1 text-xs text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100 disabled:opacity-40">
          {unlocked ? "Lock" : "Unlock"}
        </button>
      </div>
      <UnlockVaultModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
