"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { WalletsResponse } from "@/lib/ui-types";

/** `/` → /portfolio when the vault has no wallet yet, else /dashboard. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    api<WalletsResponse>("/api/wallets")
      .then((w) => alive && router.replace(w.wallets.length ? "/dashboard" : "/portfolio"))
      .catch(() => alive && router.replace("/portfolio"));
    return () => {
      alive = false;
    };
  }, [router]);
  return (
    <div className="flex flex-1 items-center justify-center dots">
      <div className="text-text-3 label pulse">Opening TRENCH…</div>
    </div>
  );
}
