"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { WalletsResponse } from "@/lib/types";
import { lastChain } from "@/components/rh/recent";

/** `/` → the chain used last: Robinhood mode → /rh/dashboard; Solana → /portfolio when the vault has no wallet yet, else /dashboard. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    if (lastChain() === "robinhood") {
      router.replace("/rh/dashboard");
      return;
    }
    api<WalletsResponse>("/api/wallets")
      .then((w) => alive && router.replace(w.wallets.length ? "/dashboard" : "/portfolio"))
      .catch(() => alive && router.replace("/portfolio"));
    return () => {
      alive = false;
    };
  }, [router]);
  return (
    <div className="flex flex-1 items-center justify-center bg-bg-100">
      <div className="text-xs text-text-300">Opening DONCHAIN…</div>
    </div>
  );
}
