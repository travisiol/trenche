"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { failureMessage, isApiFailure } from "@/lib/api";
import { Icon, type IconKind } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- Button
   Hierarchy: one `primary` per view · `outline` for secondary · `ghost` for quiet ·
   `danger` only for sell / dump / remove · `up`/`down` for the BUY / SELL buttons. */

type Variant = "primary" | "ghost" | "outline" | "up" | "down" | "warn" | "auto" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover shadow-[0_0_20px_#3b82f633]",
  ghost: "bg-transparent text-text-2 hover:bg-white/5 hover:text-text",
  outline: "bg-card border border-line text-text hover:border-line-hover hover:bg-card-2",
  up: "bg-up text-black hover:brightness-110",
  down: "bg-down text-white hover:brightness-110",
  warn: "bg-warn text-black hover:brightness-110",
  auto: "bg-auto text-white hover:brightness-110",
  danger: "bg-down-soft text-down border border-down/40 hover:bg-down/20",
};
type Size = "xs" | "sm" | "md" | "lg";
const sizes: Record<Size, string> = {
  xs: "h-7 px-2.5 text-[13px] rounded-md gap-1.5",
  sm: "h-8 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-lg gap-2",
  lg: "h-12 px-5 text-[15px] rounded-[10px] gap-2 font-semibold",
};
export function Button({
  variant = "outline",
  size = "md",
  busy,
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; icon?: IconKind }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background,border-color,filter] disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {busy ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === "lg" ? 18 : 15} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx("spin shrink-0", className)} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------- Containers */

/** Page frame: 24px padding, 16px gaps, 1440px max width. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cx("flex-1 flex flex-col gap-4 p-4 md:p-6 w-full mx-auto min-h-0", wide ? "" : "max-w-[1440px]", className)}>{children}</div>;
}

/** One header per page: 3D icon · 22px title · one-sentence explanation · primary action on the right. */
export function PageHeader({ icon, title, description, actions }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      {icon}
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-text-2 mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </header>
  );
}

/** Titled card: every card has a title and a one-line description; 16px padding. */
export function Card({
  title,
  description,
  icon,
  actions,
  glow,
  className,
  bodyClassName,
  flush,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  glow?: boolean;
  className?: string;
  bodyClassName?: string;
  /** no body padding (tables, lists) */
  flush?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={cx(glow ? "glow-frame" : "panel", "flex flex-col min-w-0", className)}>
      {title !== undefined ? (
        <header className="flex items-start gap-3 px-4 py-3 border-b border-line shrink-0">
          {icon ? <span className="shrink-0 mt-0.5">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] leading-6 font-semibold tracking-tight truncate">{title}</h2>
            {description ? <p className="hint">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx("min-w-0 min-h-0 flex-1 flex flex-col", flush ? "" : "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Kept for compatibility: same as Card. */
export const Panel = Card;

/** Section inside a card: small title + one-line explanation. */
export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="hint">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Big stat card (dashboard / portfolio top row). */
export function StatCard({ label, value, sub, tone, icon, right }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "up" | "down"; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="panel p-4 flex items-start gap-3 min-w-0">
      {icon ? <span className="shrink-0 mt-0.5">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 min-h-7">
          <div className="label truncate">{label}</div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
        <div className={cx("mono text-2xl leading-8 font-semibold tracking-tight truncate mt-0.5", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
        {sub ? <div className="hint mt-0.5 truncate">{sub}</div> : null}
      </div>
    </div>
  );
}

/** Labelled value in full words: "Market cap" / "$4.1K". */
export function KV({ label, value, tone, className, align = "left" }: { label: ReactNode; value: ReactNode; tone?: "up" | "down" | "warn" | "accent"; className?: string; align?: "left" | "right" }) {
  return (
    <div className={cx("min-w-0", align === "right" && "text-right", className)}>
      <div className="label truncate">{label}</div>
      <div className={cx("mono text-sm font-medium truncate", tone === "up" && "text-up", tone === "down" && "text-down", tone === "warn" && "text-warn", tone === "accent" && "text-accent")}>{value}</div>
    </div>
  );
}

export function Label({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cx("label block mb-1.5", className)}>
      {children}
    </label>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
  right,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx("min-w-0", className)}>
      <div className="flex items-baseline justify-between mb-1.5 gap-2">
        <label htmlFor={id} className="label">
          {label}
        </label>
        {right}
      </div>
      <div data-field-id={id}>{children}</div>
      {hint ? <p className="hint mt-1">{hint}</p> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; suffix?: ReactNode }) {
  const { mono, suffix, className, ...rest } = props;
  if (suffix) {
    return (
      <div className="relative">
        <input {...rest} className={cx("input pr-14", mono && "mono", className)} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-text-3 pointer-events-none">{suffix}</span>
      </div>
    );
  }
  return <input {...rest} className={cx("input", mono && "mono", className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("input", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx("input appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7482%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_12px_center] pr-9", props.className)} />
  );
}

export function Toggle({ checked, onChange, label, color = "accent", disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; color?: "accent" | "auto" | "up"; disabled?: boolean }) {
  const bg = checked ? (color === "auto" ? "bg-auto" : color === "up" ? "bg-up" : "bg-accent") : "bg-line-hover";
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5 disabled:opacity-50 text-left">
      <span className={cx("relative inline-block w-9 h-5 rounded-full transition-colors shrink-0", bg)}>
        <span className={cx("absolute top-[2px] w-4 h-4 rounded-full bg-white transition-[left]", checked ? "left-[18px]" : "left-[2px]")} />
      </span>
      {label ? <span className="text-sm text-text-2">{label}</span> : null}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "sm", className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "xs" | "sm" | "md"; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-lg border border-line bg-bg p-0.5", size === "xs" ? "h-8" : size === "md" ? "h-10" : "h-9", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "px-3 rounded-md font-medium transition-colors text-[13px] flex-1 whitespace-nowrap",
            o.value === value ? "bg-accent-soft text-accent" : "text-text-3 hover:text-text-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line px-2 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx(
            "relative h-11 px-3 text-sm font-medium transition-colors whitespace-nowrap",
            t.value === value ? "text-text" : "text-text-3 hover:text-text-2",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 text-[13px] text-text-3 mono">{t.count}</span> : null}
          {t.value === value ? <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-accent rounded-full" /> : null}
        </button>
      ))}
    </div>
  );
}

/** Status pill (Migrated, Bonding, Active…). Not for numbers — use KV. */
export function Capsule({ k, children, tone, className, title }: { k?: ReactNode; children: ReactNode; tone?: "up" | "down" | "warn" | "accent" | "auto"; className?: string; title?: string }) {
  const toneCls =
    tone === "up" ? "text-up border-up/30 bg-up-soft" : tone === "down" ? "text-down border-down/30 bg-down-soft" : tone === "warn" ? "text-warn border-warn/30 bg-warn-soft" : tone === "accent" ? "text-accent border-accent/30 bg-accent-soft" : tone === "auto" ? "text-auto border-auto/30 bg-auto-soft" : "";
  return (
    <span className={cx("capsule num", toneCls, className)} title={title}>
      {k ? <b>{k}</b> : null}
      {children}
    </span>
  );
}

export function Progress({ value, className, color }: { value: number | null | undefined; className?: string; color?: string }) {
  const v = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={cx("progress", className)}>
      <i style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone, big }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "up" | "down"; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={cx("mono font-semibold tracking-tight truncate", big ? "text-2xl mt-1" : "text-base mt-0.5", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
      {sub ? <div className="hint mt-0.5 truncate">{sub}</div> : null}
    </div>
  );
}

/** "Total 0.4 SOL + fees ~0.00002" — shown before every confirm button that moves funds. */
export function CostLine({ rows, total, note }: { rows?: { label: ReactNode; value: ReactNode; tone?: "up" | "down" | "warn" }[]; total?: { label?: ReactNode; value: ReactNode; tone?: "up" | "down" | "warn" }; note?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-4 py-3 flex flex-col gap-1.5 text-sm">
      {rows?.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="text-text-2">{r.label}</span>
          <span className={cx("mono", r.tone === "up" && "text-up", r.tone === "down" && "text-down", r.tone === "warn" && "text-warn")}>{r.value}</span>
        </div>
      ))}
      {total ? (
        <div className={cx("flex items-center justify-between gap-4 font-semibold", rows?.length ? "pt-1.5 mt-0.5 border-t border-line" : "")}>
          <span>{total.label ?? "Total"}</span>
          <span className={cx("mono", total.tone === "up" && "text-up", total.tone === "down" && "text-down", total.tone === "warn" && "text-warn")}>{total.value}</span>
        </div>
      ) : null}
      {note ? <p className="hint">{note}</p> : null}
    </div>
  );
}

/** Step list for job progress: green / red dot, label, optional link. */
export function StepList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx("flex flex-col", className)}>{children}</ul>;
}
export function StepItem({ ok, pending, children, right }: { ok?: boolean; pending?: boolean; children: ReactNode; right?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 min-h-9 py-1 text-sm border-b border-line/60 last:border-0">
      <Dot tone={pending ? "accent" : ok ? "up" : "down"} pulse={pending} size={8} />
      <span className="min-w-0 flex-1 truncate text-text-2">{children}</span>
      {right ? <span className="shrink-0 flex items-center gap-3 text-[13px]">{right}</span> : null}
    </li>
  );
}

/* --------------------------------------------------------------- Feedback */

export function Empty({ icon, title, children, action, compact }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center px-6 gap-2 fade-in", compact ? "py-6" : "py-12")}>
      {icon ? <div className="opacity-90 mb-1">{icon}</div> : null}
      <div className="text-[15px] font-semibold">{title}</div>
      {children ? <p className="text-sm text-text-2 max-w-[44ch] leading-relaxed">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** "Server not reachable / route missing" — never mock data. */
export function ApiError({ error, retry, compact }: { error: unknown; retry?: () => void; compact?: boolean }) {
  if (!error) return null;
  const kind = isApiFailure(error) ? error.kind : "error";
  const title = kind === "network" ? "Server not reachable" : kind === "missing" ? "Route missing" : kind === "locked" ? "Vault locked" : "Request failed";
  const detail = isApiFailure(error) ? (kind === "missing" ? `${error.path} is not served yet.` : kind === "network" ? "The DONCHAIN server did not answer. Is `npm run dev` running?" : error.message) : failureMessage(error);
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm text-warn px-3 py-2 rounded-lg bg-warn-soft border border-warn/20 min-w-0">
        <Icon name="warning" size={15} />
        <span className="font-medium shrink-0">{title}</span>
        <span className="text-text-2 truncate">{detail}</span>
        {retry ? (
          <button onClick={retry} className="ml-auto underline text-text-2 hover:text-text shrink-0">
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-6 fade-in">
      <div className="w-10 h-10 rounded-full bg-warn-soft text-warn flex items-center justify-center">
        <Icon name="warning" size={18} />
      </div>
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="text-sm text-text-2 max-w-[44ch] break-words">{detail}</p>
      {retry ? (
        <Button size="sm" onClick={retry} icon="refresh">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function WarnIcon({ size = 14 }: { size?: number }) {
  return <Icon name="warning" size={size} />;
}

export function InlineError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 text-sm text-down bg-down-soft border border-down/20 rounded-lg px-3 py-2.5 break-words">
      <Icon name="warning" size={15} className="mt-0.5" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "auto" }) {
  const cls = tone === "warn" ? "text-warn bg-warn-soft border-warn/20" : tone === "auto" ? "text-auto bg-auto-soft border-auto/20" : "text-text-2 bg-card border-line";
  return (
    <div className={cx("flex items-start gap-2 text-sm border rounded-lg px-3 py-2.5", cls)}>
      <Icon name="info" size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ Modal */

export function Modal({ open, onClose, title, description, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[2px] fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal className="glow-frame w-full flex flex-col max-h-[92vh]" style={{ maxWidth: width }}>
        <header className="flex items-start gap-3 px-5 py-4 border-b border-line">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold tracking-tight">{title}</h3>
            {description ? <p className="text-sm text-text-2 mt-0.5">{description}</p> : null}
          </div>
          <button data-close onClick={onClose} aria-label="Close" className="w-9 h-9 -mr-2 -mt-1 rounded-lg text-text-3 hover:text-text hover:bg-white/5 flex items-center justify-center shrink-0">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="p-5 overflow-y-auto flex flex-col gap-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Popover */

export function Popover({ trigger, children, width = 280, align = "right" }: { trigger: (open: boolean) => ReactNode; children: ReactNode; width?: number; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className={cx("absolute top-full mt-1.5 z-30 panel p-3 shadow-2xl fade-in", align === "right" ? "right-0" : "left-0")} style={{ width }}>
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Toast */

type Toast = { id: number; text: string; tone: "ok" | "err" | "info" };
const toastListeners = new Set<(t: Toast) => void>();
let toastId = 0;
const MUTE_KEY = "donchain.toasts.muted";
export function toastsMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setToastsMuted(v: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
/** raw RPC rate-limit errors are replaced by one honest sentence (the detail stays in the job log and /api/rpc/health) */
export const RPC_RATE_LIMIT_RE = /429|Too Many Requests|Rate limit exceeded|rate.?limited|-32005/i;
export const RPC_RATE_LIMIT_TOAST = "Public RPC rate-limited — the request was retried; add a Helius key in Settings for a private RPC.";
export function toast(text: string, tone: Toast["tone"] = "info") {
  if (tone !== "err" && toastsMuted()) return;
  if (tone === "err" && RPC_RATE_LIMIT_RE.test(text)) {
    text = RPC_RATE_LIMIT_TOAST;
    tone = "info";
  }
  const t = { id: ++toastId, text, tone };
  toastListeners.forEach((l) => l(t));
}
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((s) => [...s, t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 4200);
    };
    toastListeners.add(l);
    return () => {
      toastListeners.delete(l);
    };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "fade-in pointer-events-auto px-3 py-2.5 rounded-md text-xs font-medium border shadow-lg max-w-[360px] break-words flex items-start gap-2",
            t.tone === "ok" ? "bg-bg-50 border-green-100/40 text-green-100" : t.tone === "err" ? "bg-bg-50 border-decrease/40 text-decrease" : "bg-bg-50 border-line-100 text-text-100",
          )}
        >
          <Icon name={t.tone === "ok" ? "check" : t.tone === "err" ? "warning" : "info"} size={15} className="mt-0.5" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- Misc */

export function Copy({ text, children, className, size = 13 }: { text: string; children?: ReactNode; className?: string; size?: number }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      className={cx("inline-flex items-center gap-1.5 mono text-text-2 hover:text-text transition-colors min-w-0", className)}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {children}
      <Icon name={done ? "check" : "copy"} size={size} className={done ? "text-up" : "opacity-60"} />
    </button>
  );
}

export function Dot({ tone, pulse, size = 6 }: { tone: "up" | "down" | "warn" | "muted" | "accent"; pulse?: boolean; size?: number }) {
  const c = tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : tone === "warn" ? "bg-warn" : tone === "accent" ? "bg-accent" : "bg-text-3";
  return <span className={cx("inline-block rounded-full shrink-0", c, pulse && "pulse")} style={{ width: size, height: size }} />;
}

export function TokenImage({ src, alt, size = 40, className }: { src: string | null | undefined; alt: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={cx("shrink-0 rounded-lg bg-card-2 border border-line flex items-center justify-center text-text-3 font-semibold", className)} style={{ width: size, height: size, fontSize: Math.max(11, size / 3) }}>
        {alt?.slice(0, 2).toUpperCase() || "?"}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- token images come from arbitrary ipfs gateways
  return <img src={src} alt={alt} width={size} height={size} onError={() => setBroken(true)} className={cx("shrink-0 rounded-lg object-cover bg-card-2 border border-line", className)} style={{ width: size, height: size }} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded border border-line bg-bg text-[13px] mono text-text-2">{children}</kbd>;
}

/** Numbered step marker for guided flows (1 Token · 2 Dev wallet …). */
export function StepNumber({ n, done }: { n: number; done?: boolean }) {
  return (
    <span className={cx("inline-flex items-center justify-center w-7 h-7 rounded-full text-[13px] font-semibold shrink-0 border", done ? "bg-up text-black border-up" : "bg-accent-soft text-accent border-accent/40")}>
      {done ? <Icon name="check" size={14} /> : n}
    </span>
  );
}

/** Loading line used inside cards. */
export function Loading({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-text-3 p-4">
      <Spinner size={14} /> {children ?? "Loading…"}
    </div>
  );
}
