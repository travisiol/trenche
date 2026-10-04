"use client";
import { useState, type ReactNode } from "react";
import { Lock, LockOpen } from "lucide-react";
import { UnlockVaultModal } from "./bx/vault";
import { Wordmark } from "./bx/Shell";
import { BxButton, BxInput, BxLabel } from "./bx/ui";
import { toast } from "./ui";
import { refreshVaultDependents, useVault } from "@/lib/store";
import { failureMessage, post } from "@/lib/api";

/**
 * First run: no keystore → central "Create your vault" card.
 * Locked: banner on top, pages stay readable (signing actions disable themselves via useVault()).
 */
export function VaultGate({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (vault.loading && !vault.data) {
    return <div className="flex flex-1 items-center justify-center text-xs text-text-300">Loading…</div>;
  }
  if (vault.data && !vault.data.exists) return <CreateVault />;
  return (
    <>
      {vault.error ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-decrease/30 bg-decrease/10 px-4 py-2 text-xs text-decrease">
          Server not reachable — {failureMessage(vault.error)}
          <button type="button" onClick={vault.refresh} className="ml-auto underline">
            Retry
          </button>
        </div>
      ) : vault.data && !vault.data.unlocked ? (
        <div className="flex min-h-9 shrink-0 items-center gap-3 border-b border-yellow-100/30 bg-yellow-100/10 px-4 text-xs">
          <Lock className="h-3.5 w-3.5 text-yellow-100" />
          <span className="font-medium text-yellow-100">Vault locked</span>
          <span className="hidden text-text-200 sm:inline">Read-only. Unlock to sign transactions, export keys or launch.</span>
          <BxButton size="sm" variant="primary" className="ml-auto" onClick={() => setUnlockOpen(true)}>
            <LockOpen className="h-3.5 w-3.5" /> Unlock
          </BxButton>
        </div>
      ) : null}
      {children}
      <UnlockVaultModal open={unlockOpen} onClose={() => setUnlockOpen(false)} />
    </>
  );
}

function CreateVault() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strong = a.length >= 12 && /[A-Z]/.test(a) && /[a-z]/.test(a) && /[0-9]/.test(a);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (a !== b) return setErr("The two passphrases differ.");
    setBusy(true);
    setErr(null);
    try {
      await post("/api/vault/create", { passphrase: a });
      refreshVaultDependents();
      toast("Vault created", "ok");
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-landing-grid flex flex-1 items-center justify-center p-4">
      <form onSubmit={submit} className="flex w-full max-w-[440px] flex-col gap-4 rounded-lg border border-line-100 bg-bg-50 p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-muted text-accent">
            <Lock className="h-5 w-5" />
          </span>
          <div>
            <Wordmark />
            <h1 className="text-base font-semibold text-text-100">Create your vault</h1>
          </div>
        </div>
        <p className="text-xs text-text-300">Your keys are encrypted on this machine only. The passphrase is never stored: lose it and the wallets are gone.</p>
        <div>
          <BxLabel>Passphrase</BxLabel>
          <BxInput type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
          <p className="mt-1 text-[11px] text-text-300">At least 12 characters with an uppercase letter, a lowercase letter and a digit.</p>
        </div>
        <div>
          <BxLabel>Repeat passphrase</BxLabel>
          <BxInput type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        </div>
        <div className="flex h-1 gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`flex-1 rounded ${a.length > i * 4 ? (strong ? "bg-green-100" : "bg-yellow-100") : "bg-line-100"}`} />
          ))}
        </div>
        {err ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{err}</p> : null}
        <BxButton type="submit" variant="primary" disabled={!strong || !b || busy}>
          <Lock className="h-3.5 w-3.5" /> Create vault
        </BxButton>
      </form>
    </div>
  );
}
