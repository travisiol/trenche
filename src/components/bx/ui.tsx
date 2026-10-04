"use client";
/** Block X look-alike primitives (class names taken from the captured DOM) — used by every converted page. */
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Block X card: rounded-lg border bg-bg-50 with a 52/56px header row. */
export function BxCard({ title, icon, right, children, className, bodyClassName }: { title?: ReactNode; icon?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <div className={cx("overflow-hidden rounded-lg border border-line-100 bg-bg-50 flex min-w-0 flex-col", className)}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {title !== undefined ? (
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 px-5 xl:h-[56px]">
            <div className="flex items-center gap-2">
              {icon}
              <h2 className="text-[16px] font-medium tracking-[-0.02em] text-text-100">{title}</h2>
            </div>
            {right ? <div className="flex items-center gap-2">{right}</div> : null}
          </div>
        ) : null}
        <div className={cx("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
      </div>
    </div>
  );
}

/** Primary (accent) / secondary (bordered) buttons as Block X renders them. */
export function BxButton({ variant = "secondary", size = "md", className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  const base = size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]";
  const look =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-hover"
      : variant === "danger"
        ? "border border-decrease/40 bg-decrease/10 text-decrease hover:bg-decrease/20"
        : variant === "ghost"
          ? "text-text-300 hover:bg-white/[0.04] hover:text-text-100"
          : "border border-line-100 bg-bg-50 text-text-200 hover:border-accent/35 hover:text-text-100";
  return (
    <button type="button" {...rest} className={cx("inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40", base, look, className)}>
      {children}
    </button>
  );
}

/** Block X input (dark input-100 surface, line-100 border). */
export function BxInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx("h-9 w-full rounded-md border border-line-100 bg-input-100 px-3 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent", className)} />;
}
export function BxTextarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx("w-full rounded-md border border-line-100 bg-input-100 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-300 focus:border-accent", className)} />;
}
export function BxSelect({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx("h-9 w-full appearance-none rounded-md border border-line-100 bg-input-100 px-3 text-sm text-text-100 outline-none focus:border-accent", className)} />;
}
export function BxLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cx("mb-1.5 block text-[13px] font-medium text-text-100", className)}>{children}</label>;
}
/** Segmented pill group (1D 7D 30D All · P1 P2 P3). */
export function BxSeg<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cx("flex items-center gap-1", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cx("rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors", o.value === value ? "bg-accent/15 text-accent" : "text-text-300 hover:bg-white/[0.04] hover:text-text-100")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
/** Block X toggle switch. */
export function BxSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cx("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40", checked ? "border-accent bg-accent" : "border-line-200 bg-input-200")}>
      <span className={cx("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", checked ? "translate-x-[18px]" : "translate-x-[3px]")} />
    </button>
  );
}

/** Modal with Block X's overlay + panel (bg-bg-50, line-100 border, header row with close). */
export function BxModal({ open, onClose, title, headerRight, children, width = 560, className }: { open: boolean; onClose: () => void; title: ReactNode; headerRight?: ReactNode; children: ReactNode; width?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-modal-overlay p-4" style={{ background: "var(--modal-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal className={cx("flex max-h-[92vh] w-full flex-col overflow-hidden rounded-lg border border-line-100 bg-bg-50 shadow-2xl", className)} style={{ maxWidth: width }}>
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line-100 px-4">
          <h2 className="text-[15px] font-medium text-text-100">{title}</h2>
          <div className="flex items-center gap-1.5">
            {headerRight}
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Launchpad-badged token avatar (Block X: 1px tinted frame + small pad badge bottom-right). */
export function PadAvatar({ src, alt, size = 32, className }: { src: string | null | undefined; alt: string; size?: number; className?: string }) {
  return (
    <div className={cx("relative shrink-0 overflow-visible", className)} style={{ width: size, height: size }} title="Pump.fun">
      <div className="absolute inset-0 rounded-md p-px" style={{ backgroundColor: "rgba(82, 212, 143, 0.35)" }}>
        <div className="relative h-full w-full overflow-hidden rounded-[5px] bg-bg-100">
          <div className="pointer-events-none absolute inset-0 z-10 rounded-[5px] border border-white/10" />
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- ipfs/cdn token images
            <img src={src} alt={alt} className="h-full w-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] font-medium text-text-300">{alt.slice(0, 2).toUpperCase()}</div>
          )}
        </div>
      </div>
      <div className="absolute -bottom-0.5 -right-0.5 z-10 flex items-center justify-center rounded-full bg-bg-100" style={{ width: Math.max(12, size * 0.38), height: Math.max(12, size * 0.38), border: "1.5px solid rgb(82, 212, 143)" }} title="Pump.fun">
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
        <img src="/launchpads/pumpfun.svg" alt="Pump.fun" className="object-contain" style={{ width: Math.max(6, size * 0.2), height: Math.max(6, size * 0.2) }} />
      </div>
    </div>
  );
}
