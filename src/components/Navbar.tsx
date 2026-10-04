"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon3D, type IconName } from "./Icon3D";
import { Button, Dot, Modal, Field, Input, InlineError, cx, toast } from "./ui";
import { useBalances, useSolPrice, useVault, useWallets, refreshVaultDependents } from "@/lib/store";
import { post, failureMessage } from "@/lib/api";
import { short, sol, usd } from "@/lib/format";
import { useFeedStatus } from "./feed-status";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/trenches", label: "Trenches", icon: "trenches" },
  { href: "/trending", label: "Trending", icon: "trending" },
  { href: "/launch", label: "Launch", icon: "launch" },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { href: "/rewards", label: "Rewards", icon: "rewards" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function Navbar() {
  const path = usePathname();
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const price = useSolPrice();
  const feed = useFeedStatus();
  const [unlockOpen, setUnlockOpen] = useState(false);

  const active = wallets.data?.wallets.find((w) => w.address === wallets.data?.active) ?? null;
  const activeSol = active ? (balances.data?.[active.address] ?? active.sol) : null;
  const unlocked = vault.data?.unlocked ?? false;
  const exists = vault.data?.exists ?? false;

  return (
    <header className="h-14 shrink-0 bg-panel border-b border-line flex items-center px-3 gap-1 sticky top-0 z-40">
      <Link href="/" className="flex items-center gap-2 pr-3 mr-1 h-9 rounded-lg hover:bg-white/5">
        <Icon3D name="radar" size={28} glow />
        <span className="font-bold tracking-[0.12em] text-[14px]">TRENCH</span>
      </Link>
      <nav className="hidden md:flex items-center gap-0.5">
        {NAV.map((n) => {
          const on = path === n.href || path.startsWith(n.href + "/") || (n.href === "/trade" && path.startsWith("/trade"));
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium transition-colors",
                on ? "bg-accent-soft text-text" : "text-text-2 hover:text-text hover:bg-white/5",
              )}
            >
              <Icon3D name={n.icon} size={20} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <nav className="flex md:hidden items-center gap-0.5 overflow-x-auto">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} title={n.label} className={cx("flex items-center h-9 px-2 rounded-lg", path.startsWith(n.href) ? "bg-accent-soft" : "")}>
            <Icon3D name={n.icon} size={20} />
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* active wallet */}
        <Link href="/portfolio" className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-card hover:border-line-hover" title="Active wallet">
          <Icon3D name="portfolio" size={18} />
          {active ? (
            <>
              <span className="text-xs font-medium max-w-[9ch] truncate">{active.label || short(active.address)}</span>
              <span className="mono text-xs text-text-2">{sol(activeSol)} SOL</span>
            </>
          ) : (
            <span className="text-xs text-text-3">No wallet</span>
          )}
        </Link>
        {/* feed status */}
        <Link href="/trenches" className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-line bg-card text-[11px] text-text-2" title={feed.error ?? (feed.connected ? "Feed connected" : "Feed disconnected")}>
          <Dot tone={feed.connected ? "up" : feed.error ? "down" : "muted"} pulse={feed.connected} />
          <span className="hidden lg:inline">{feed.connected ? "Feed live" : "Feed off"}</span>
        </Link>
        {/* SOL price */}
        <div className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-line bg-card text-xs mono" title="SOL price">
          <span className="text-text-3">SOL</span>
          <span>{price.data ? usd(price.data.usd, 2).replace(/K$/, "") : "—"}</span>
        </div>
        {/* vault lock */}
        <button
          onClick={() => (unlocked ? lock() : setUnlockOpen(true))}
          disabled={!exists}
          title={!exists ? "No vault yet" : unlocked ? "Lock vault" : "Unlock vault"}
          className={cx(
            "flex items-center justify-center w-9 h-9 rounded-lg border transition-colors",
            unlocked ? "border-up/40 bg-up-soft text-up" : exists ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-card text-text-3",
          )}
        >
          <LockIcon open={unlocked} />
        </button>
      </div>
      <UnlockModal open={unlockOpen} onClose={() => setUnlockOpen(false)} />
    </header>
  );
}

async function lock() {
  try {
    await post("/api/vault/lock", {});
    refreshVaultDependents();
    toast("Vault locked", "info");
  } catch (e) {
    toast(failureMessage(e), "err");
  }
}

export function UnlockModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Modal open={open} onClose={onClose} title="Unlock vault" width={400}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Passphrase">
          <Input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Your keystore passphrase" />
        </Field>
        <InlineError>{err}</InlineError>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!pass}>
            Unlock
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LockIcon({ open, size = 15 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      {open ? <path d="M7 11V7a5 5 0 0 1 9.9-1" /> : <path d="M7 11V7a5 5 0 0 1 10 0v4" />}
    </svg>
  );
}
