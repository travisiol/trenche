"use client";
/** "New version" banner: the server was updated while this tab stayed open (it still runs the old code) — reload. */
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

export function UpdateBanner() {
  const first = useRef<string | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { build } = (await r.json()) as { build: string };
        if (!alive || build === "dev") return;
        if (first.current === null) first.current = build;
        else if (build !== first.current) setStale(true);
      } catch {
        /* server restarting: next check */
      }
    };
    void check();
    const t = setInterval(check, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-lg" role="status">
      DONCHAIN was updated — this tab still runs the previous version.
      <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1 hover:bg-white/30">
        <RefreshCw className="h-3.5 w-3.5" /> Reload
      </button>
    </div>
  );
}
