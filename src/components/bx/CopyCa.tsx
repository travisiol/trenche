"use client";
/** A token's contract address as a visible chip: click = copy the full CA (toast + check mark). */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { short } from "@/lib/format";
import { toast } from "@/components/ui";
import { cx } from "./ui";

export function CopyCa({ ca, className, note }: { ca: string; className?: string; /** small tag after the address (e.g. "reserved") */ note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(ca);
      setCopied(true);
      toast("CA copied", "ok");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Copy failed — select the address by hand", "err");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={cx("group inline-flex max-w-full items-center gap-1.5 rounded-md border border-line-100 bg-bg-50 px-1.5 py-0.5 font-mono text-[11px] text-text-200 transition-colors hover:border-accent/50 hover:text-text-100", copied && "border-increase/50 text-increase", className)}
      title={`${ca} — click to copy`}
      data-testid="copy-ca"
    >
      <span className="font-sans text-[10px] font-semibold text-text-300">CA</span>
      <span className="truncate">{short(ca, 6, 6)}</span>
      {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0 opacity-70 group-hover:opacity-100" />}
      {note ? <span className="shrink-0 rounded bg-accent-muted px-1 font-sans text-[9px] uppercase text-accent">{note}</span> : null}
    </button>
  );
}
