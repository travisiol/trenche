"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon3D, type IconName } from "./Icon3D";
import { Icon } from "./icons";
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
    <header className="h-14 shrink-0 bg-panel border-b border-line flex items-center px-3 md:px-4 gap-2 sticky top-0 z-40">
      <Link href="/" className="flex items-center gap-2 pr-3 mr-1 h-10 rounded-lg hover:bg-white/5">
        <Icon3D name="radar" size={28} glow />
        <span className="font-bold tracking-[0.12em] text-[14px]">TRENCH</span>
      </Link>
      <nav className="hidden lg:flex items-center gap-0.5">
        {NAV.map((n) => {
          const on = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "flex items-center gap-2 h-10 px-3 rounded-lg text-sm font-medium transition-colors",
                on ? "bg-accent-soft text-text" : "text-text-2 hover:text-text hover:bg-white/5",
              )}
            >
              <Icon3D name={n.icon} size={20} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <nav className="flex lg:hidden items-center gap-0.5 overflow-x-auto">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} title={n.label} aria-label={n.label} className={cx("flex items-center justify-center h-10 w-10 rounded-lg shrink-0", path.startsWith(n.href) ? "bg-accent-soft" : "hover:bg-white/5")}>
            <Icon3D name={n.icon} size={22} />
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* active wallet */}
        <Link href="/portfolio" className="hidden sm:flex items-center gap-2 h-10 px-3 rounded-lg border border-line bg-card hover:border-line-hover" title="Active wallet — change it in Portfolio">
          <Icon3D name="portfolio" size={18} />
          {active ? (
            <>
              <span className="text-sm font-medium max-w-[10ch] truncate">{active.label || short(active.address)}</span>
              <span className="mono text-sm text-text-2">{sol(activeSol)} SOL</span>
            </>
          ) : (
            <span className="text-sm text-text-3">No wallet</span>
          )}
        </Link>
        {/* feed status */}
        <Link href="/trenches" className="flex items-center gap-2 h-10 px-3 rounded-lg border border-line bg-card text-[13px] text-text-2" title={feed.error ?? (feed.connected ? "Live feed connected" : "Feed idle — opens with the Trenches page")}>
          <Dot tone={feed.connected ? "up" : feed.error ? "down" : "muted"} pulse={feed.connected} />
          <span className="hidden xl:inline">{feed.connected ? "Feed live" : "Feed idle"}</span>
        </Link>
        {/* SOL price */}
        <div className="hidden sm:flex items-center gap-1.5 h-10 px-3 rounded-lg border border-line bg-card text-[13px] mono" title="SOL price">
          <span className="text-text-3">SOL</span>
          <span>{price.data ? usd(price.data.usd, 2).replace(/K$/, "") : "—"}</span>
        </div>
        {/* vault lock */}
        <button
          onClick={() => (unlocked ? lock() : setUnlockOpen(true))}
          disabled={!exists}
          title={!exists ? "No vault yet" : unlocked ? "Vault unlocked — click to lock" : "Vault locked — click to unlock"}
          aria-label={unlocked ? "Lock vault" : "Unlock vault"}
          className={cx(
            "flex items-center justify-center w-10 h-10 rounded-lg border transition-colors",
            unlocked ? "border-up/40 bg-up-soft text-up" : exists ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-card text-text-3",
          )}
        >
          <Icon name={unlocked ? "unlock" : "lock"} size={16} />
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
    <Modal open={open} onClose={onClose} title="Unlock vault" description="Decrypts your keys in memory so you can sign. Lock again when you leave." width={420}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Passphrase">
          <Input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Your keystore passphrase" />
        </Field>
        <InlineError>{err}</InlineError>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!pass} icon="unlock">
            Unlock
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LockIcon({ open, size = 15 }: { open: boolean; size?: number }) {
  return <Icon name={open ? "unlock" : "lock"} size={size} />;
}
