"use client";
import { useState, type ReactNode } from "react";
import { Icon3D } from "./Icon3D";
import { Icon } from "./icons";
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
  if (vault.data && !vault.data.exists) return <CreateVault />;
  return (
    <>
      {vault.error ? (
        <div className="shrink-0 px-4 py-2 border-b border-warn/30 bg-warn-soft">
          <ApiError error={vault.error} retry={vault.refresh} compact />
        </div>
      ) : vault.data && !vault.data.unlocked ? (
        <div className="shrink-0 flex items-center gap-3 px-4 md:px-6 min-h-12 py-2 bg-warn-soft border-b border-warn/30 text-sm">
          <Icon name="lock" size={16} className="text-warn" />
          <span className="font-medium text-warn">Vault locked</span>
          <span className="text-text-2 hidden sm:inline">You can read everything. Unlock to sign transactions, export keys or launch.</span>
          <Button size="sm" variant="warn" className="ml-auto" onClick={() => setUnlockOpen(true)} icon="unlock">
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
      <form onSubmit={submit} className="glow-frame w-full max-w-[460px] p-6 md:p-8 flex flex-col gap-5 fade-in">
        <div className="flex items-center gap-4">
          <Icon3D name="portfolio" size={56} glow />
          <div>
            <h1 className="text-[22px] leading-7 font-semibold tracking-tight">Create your vault</h1>
            <p className="text-sm text-text-2 mt-1">Your keys are encrypted on this machine only. The passphrase is never stored: lose it and the wallets are gone.</p>
          </div>
        </div>
        <Field label="Passphrase" hint="At least 12 characters with an uppercase letter, a lowercase letter and a digit.">
          <Input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        <Field label="Repeat passphrase">
          <Input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        </Field>
        <div className="flex gap-1 h-1.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`flex-1 rounded ${a.length > i * 4 ? (strong ? "bg-up" : "bg-warn") : "bg-line"}`} />
          ))}
        </div>
        <InlineError>{err}</InlineError>
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!strong || !b} icon="lock">
          Create vault
        </Button>
      </form>
    </div>
  );
}
