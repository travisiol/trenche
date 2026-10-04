"use client";
import { useState, type ReactNode } from "react";
import { Icon3D } from "./Icon3D";
import { ApiError, Button, Field, InlineError, Input, Spinner, toast } from "./ui";
import { UnlockModal } from "./Navbar";
import { refreshVaultDependents, useVault } from "@/lib/store";
import { failureMessage, post } from "@/lib/api";

/**
 * First run: no keystore → central "Create your vault" screen.
 * Locked: yellow banner on top, pages stay readable (signing actions disable themselves via useVault()).
 */
export function VaultGate({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (vault.loading && !vault.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-3">
        <Spinner />
      </div>
    );
  }
  if (vault.error) {
    return (
      <div className="flex-1 flex items-center justify-center dots">
        <div className="glow-frame w-full max-w-md">
          <ApiError error={vault.error} retry={vault.refresh} />
        </div>
      </div>
    );
  }
  if (vault.data && !vault.data.exists) return <CreateVault />;
  return (
    <>
      {vault.data && !vault.data.unlocked ? (
        <div className="shrink-0 flex items-center gap-3 px-4 h-10 bg-warn-soft border-b border-warn/30 text-warn text-xs">
          <Icon3D name="portfolio" size={18} />
          <span className="font-medium">Vault locked</span>
          <span className="text-text-2">Read-only. Unlock to sign transactions, export keys or launch.</span>
          <Button size="xs" variant="warn" className="ml-auto" onClick={() => setUnlockOpen(true)}>
            Unlock
          </Button>
        </div>
      ) : null}
      {children}
      <UnlockModal open={unlockOpen} onClose={() => setUnlockOpen(false)} />
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
    <div className="flex-1 flex items-center justify-center dots p-4">
      <form onSubmit={submit} className="glow-frame w-full max-w-[440px] p-7 flex flex-col gap-5 fade-in">
        <div className="flex items-center gap-4">
          <Icon3D name="portfolio" size={56} glow />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Create your vault</h1>
            <p className="text-xs text-text-3 mt-1">Keys are encrypted on this machine only. The passphrase is never stored — lose it and the wallets are gone.</p>
          </div>
        </div>
        <Field label="Passphrase" hint="At least 12 characters with upper, lower and a digit.">
          <Input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        <Field label="Repeat passphrase">
          <Input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        </Field>
        <div className="flex gap-1 h-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`flex-1 rounded ${a.length > i * 4 ? (strong ? "bg-up" : "bg-warn") : "bg-line"}`} />
          ))}
        </div>
        <InlineError>{err}</InlineError>
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!strong || !b}>
          Create vault
        </Button>
      </form>
    </div>
  );
}
