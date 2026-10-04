"use client";
/** Block X "Share PnL": a 1200×630 card drawn with the Canvas 2D API from GET /api/pnl/share — Download PNG,
 *  Copy image (clipboard, when the browser allows it) and Download video (4 s WebM: the SOL and $ figures count
 *  up under the DONCHAIN wordmark, recorded from the same drawing with MediaRecorder + canvas.captureStream).
 *  Nothing is invented: every figure comes from the API; a card valued at the current SOL price says so. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Film, Share2 } from "lucide-react";
import type { PnlSharePeriod, PnlShareResponse } from "@/lib/types";
import { failureMessage, useGet } from "@/lib/api";
import { toast } from "@/components/ui";
import { BxButton, BxModal, BxSeg, BxSwitch, cx } from "./ui";

export const CARD_W = 1200;
export const CARD_H = 630;
const VIDEO_MS = 4000;
const VIDEO_FPS = 30;

type Period = "1D" | "7D" | "30D" | "All";
const PERIOD_KEY: Record<Period, PnlSharePeriod> = { "1D": "1d", "7D": "7d", "30D": "30d", All: "all" };
const PERIOD_LABEL: Record<PnlSharePeriod, string> = { "1d": "Today", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };

/* Block X base theme (fixed on the card so a shared image looks the same whatever UI theme is active) */
const C = { bg: "#121212", panel: "#0a0a0a", line: "#1f2024", line2: "#2a2b30", text: "#f0f5f5", text2: "#c8ccce", text3: "#676e70", accent: "#0052ff", up: "#86d97f", down: "#f6465d" };

export type CardOptions = { hideAmounts: boolean; showWallets: boolean };

let fontFamily: string | null = null;
/** Geist as loaded by next/font (the family name lives in --font-geist-sans); falls back to the system sans. */
export async function cardFont(): Promise<string> {
  if (fontFamily) return fontFamily;
  const fallback = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
  const family = raw.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  if (!family) return (fontFamily = fallback);
  try {
    await Promise.all([400, 500, 600, 800].map((w) => document.fonts.load(`${w} 40px "${family}"`)));
    fontFamily = document.fonts.check(`600 40px "${family}"`) ? `"${family}", ${fallback}` : fallback;
  } catch {
    fontFamily = fallback;
  }
  return fontFamily;
}

const fmtSol = (n: number) => {
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : "+"}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: abs < 1 ? 4 : 2 })} SOL`;
};
const fmtUsd = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${n < 0 ? "-" : "+"}${Math.abs(n).toFixed(1)}%`;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws one frame. `t` = animation progress 0..1 (1 = the still card used for the PNG). */
export function drawPnlCard(ctx: CanvasRenderingContext2D, d: PnlShareResponse, opts: CardOptions, font: string, t = 1) {
  const W = CARD_W, H = CARD_H;
  const realised = Number(d.netSol);
  const realisedUsd = d.netUsd === null ? null : Number(d.netUsd);
  const rewards = Number(d.fees.creatorFeesClaimedSol);
  const costs = Number(d.fees.totalCostSol);
  const buys = Number(d.buysSol);
  const pct = buys > 0 ? (realised / buys) * 100 : 0;
  const tone = realised < 0 ? C.down : C.up;
  const count = easeOut((t - 0.25) / 0.6);
  const fade = easeOut(t / 0.3);
  const statsIn = easeOut((t - 0.55) / 0.35);

  // background + glow + frame
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 140, 80, 10, W - 140, 80, 620);
  glow.addColorStop(0, "rgba(0,82,255,0.22)");
  glow.addColorStop(1, "rgba(0,82,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(120, H + 40, 10, 120, H + 40, 520);
  glow2.addColorStop(0, realised < 0 ? "rgba(246,70,93,0.12)" : "rgba(134,217,127,0.10)");
  glow2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 16.5, 16.5, W - 33, H - 33, 22);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // wordmark
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 40px ${font}`;
  ctx.fillStyle = C.text;
  ctx.fillText("DON", 72, 108);
  const wDon = ctx.measureText("DON").width;
  ctx.fillStyle = C.accent;
  ctx.fillText("CHAIN", 72 + wDon - 2, 108);
  ctx.font = `500 15px ${font}`;
  ctx.fillStyle = C.text3;
  ctx.fillText("PUMP.FUN DEV TERMINAL", 74, 136);
  ctx.restore();

  // period + dates (top right)
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = "right";
  ctx.font = `600 22px ${font}`;
  ctx.fillStyle = C.text;
  ctx.fillText(PERIOD_LABEL[d.period], W - 72, 96);
  ctx.font = `400 16px ${font}`;
  ctx.fillStyle = C.text3;
  const sameDay = fmtDate(d.from) === fmtDate(d.to);
  ctx.fillText(sameDay ? `${fmtDate(d.to)} · UTC` : `${fmtDate(d.from)} – ${fmtDate(d.to)} · UTC`, W - 72, 124);
  ctx.restore();

  // headline
  ctx.save();
  ctx.font = `500 20px ${font}`;
  ctx.fillStyle = C.text3;
  ctx.fillText("REALIZED PNL · NET OF FEES", 72, 222);
  ctx.fillStyle = tone;
  if (opts.hideAmounts) {
    ctx.font = `700 150px ${font}`;
    ctx.fillText(fmtPct(pct * count), 66, 370);
    ctx.font = `500 30px ${font}`;
    ctx.fillStyle = C.text2;
    ctx.fillText(buys > 0 ? "return on SOL bought" : "no SOL bought in this window", 72, 420);
  } else {
    ctx.font = `700 150px ${font}`;
    ctx.fillText(fmtSol(realised * count), 66, 370);
    ctx.font = `500 54px ${font}`;
    ctx.fillStyle = realisedUsd === null ? C.text3 : tone;
    ctx.globalAlpha = realisedUsd === null ? 1 : 0.85;
    const usdText = realisedUsd === null ? "USD value unavailable" : fmtUsd(realisedUsd * count);
    ctx.fillText(usdText, 72, 440);
    const usdW = ctx.measureText(usdText).width;
    ctx.globalAlpha = 1;
    if (buys > 0 && realisedUsd !== null) {
      ctx.font = `500 26px ${font}`;
      ctx.fillStyle = C.text3;
      ctx.fillText(`(${fmtPct(pct * count)})`, 72 + usdW + 18, 440);
    }
  }
  ctx.restore();

  // stats row
  const winRate = d.wins + d.losses ? (d.wins / (d.wins + d.losses)) * 100 : null;
  const best = d.bestTradeSol === null ? null : Number(d.bestTradeSol);
  const tiles: [string, string, string | null][] = [
    ["WIN RATE", winRate === null ? "—" : `${winRate.toFixed(0)}%`, d.wins + d.losses ? `${d.wins}W · ${d.losses}L` : "no closed token"],
    ["TRADES", String(d.trades), d.launches ? `${d.launches} launch${d.launches !== 1 ? "es" : ""}` : null],
    ["BEST TRADE", opts.hideAmounts ? (best === null ? "—" : best >= 0 ? "▲" : "▼") : best === null ? "—" : fmtSol(best), d.bestTradeSymbol ? `$${d.bestTradeSymbol}` : d.bestTradeMint ? `${d.bestTradeMint.slice(0, 4)}…${d.bestTradeMint.slice(-4)}` : null],
    ["VOLUME", opts.hideAmounts ? "hidden" : `${Number(d.volumeSol).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`, d.solPrice && !opts.hideAmounts ? `$${(Number(d.volumeSol) * d.solPrice).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null],
  ];
  const tileW = (W - 144 - 3 * 16) / 4;
  ctx.save();
  ctx.globalAlpha = statsIn;
  tiles.forEach(([k, v, sub], i) => {
    const x = 72 + i * (tileW + 16), y = 478 + (1 - statsIn) * 14;
    roundRect(ctx, x, y, tileW, 96, 12);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.stroke();
    ctx.font = `600 13px ${font}`;
    ctx.fillStyle = C.text3;
    ctx.fillText(k, x + 18, y + 30);
    ctx.font = `600 30px ${font}`;
    ctx.fillStyle = k === "BEST TRADE" && best !== null && !opts.hideAmounts ? (best < 0 ? C.down : C.up) : C.text;
    ctx.fillText(v, x + 18, y + 68);
    const vW = ctx.measureText(v).width;
    ctx.font = `400 14px ${font}`;
    if (sub && 18 + vW + 12 + ctx.measureText(sub).width + 16 <= tileW) {
      ctx.fillStyle = C.text3;
      ctx.textAlign = "right";
      ctx.fillText(sub, x + tileW - 16, y + 68);
      ctx.textAlign = "left";
    }
  });
  ctx.restore();

  // footer
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = `400 14px ${font}`;
  ctx.fillStyle = C.text3;
  const notes: string[] = [];
  if (d.solPrice) notes.push(`SOL $${d.solPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  if (d.usdAtCurrentPrice && !opts.hideAmounts && realisedUsd !== null) notes.push("USD at current SOL price");
  if (!opts.hideAmounts && costs > 0) notes.push(`fees ${fmtSol(-costs)}`);
  if (!opts.hideAmounts && rewards > 0) notes.push(`rewards ${fmtSol(rewards)}`);
  if (d.unrealisedSol !== null && !opts.hideAmounts && Number(d.unrealisedSol) > 0) notes.push(`holdings ${Number(d.unrealisedSol).toFixed(3)} SOL`);
  if (d.estimated) notes.push("ledger still syncing");
  ctx.fillText(notes.join("  ·  "), 72, H - 36);
  if (opts.showWallets) {
    ctx.textAlign = "right";
    const label = `${d.wallets} wallet${d.wallets !== 1 ? "s" : ""}`;
    ctx.font = `600 14px ${font}`;
    const w = ctx.measureText(label).width + 28;
    roundRect(ctx, W - 72 - w, H - 56, w, 30, 15);
    ctx.fillStyle = "rgba(0,82,255,0.14)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,82,255,0.45)";
    ctx.stroke();
    ctx.fillStyle = "#7aa3ff";
    ctx.fillText(label, W - 72 - 14, H - 36);
  }
  ctx.restore();
}

export function videoSupported(): { ok: boolean; mime: string } {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return { ok: false, mime: "" };
  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") return { ok: false, mime: "" };
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  return { ok: !!mime, mime };
}

/** Records the count-up animation to a WebM blob. Frames are timed with setTimeout (not rAF) so a background
 *  tab still produces a video. */
export function recordPnlVideo(d: PnlShareResponse, opts: CardOptions, font: string, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("canvas 2D context unavailable"));
    drawPnlCard(ctx, d, opts, font, 0);
    const stream = canvas.captureStream(VIDEO_FPS);
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    } catch (e) {
      return reject(e);
    }
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onerror = () => reject(new Error("MediaRecorder failed"));
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      resolve(new Blob(chunks, { type: mime.split(";")[0] }));
    };
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / VIDEO_MS;
      drawPnlCard(ctx, d, opts, font, Math.min(1, t));
      if (t < 1) setTimeout(step, 1000 / VIDEO_FPS);
      else setTimeout(() => rec.state !== "inactive" && rec.stop(), 350);
    };
    rec.start(200);
    step();
  });
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileStem = (d: PnlShareResponse) => `donchain-pnl-${d.period}-${new Date(d.to).toISOString().slice(0, 10)}`;

export function SharePnlModal({ open, onClose, initialPeriod = "1D" }: { open: boolean; onClose: () => void; initialPeriod?: Period }) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  const [busy, setBusy] = useState<"" | "png" | "copy" | "video">("");
  const [copied, setCopied] = useState(false);
  const res = useGet<PnlShareResponse>(open ? `/api/pnl/share?period=${PERIOD_KEY[period]}` : null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fontRef = useRef<string | null>(null);
  const d = res.data;
  const video = videoSupported();
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard && typeof ClipboardItem !== "undefined";

  useEffect(() => {
    if (!open || !d) return;
    let cancelled = false;
    cardFont().then((font) => {
      if (cancelled) return;
      fontRef.current = font;
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawPnlCard(ctx, d, { hideAmounts, showWallets }, font, 1);
    });
    return () => {
      cancelled = true;
    };
  }, [open, d, hideAmounts, showWallets]);

  const stillBlob = useCallback(async (): Promise<Blob> => {
    if (!d) throw new Error("no data");
    const font = fontRef.current ?? (await cardFont());
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2D context unavailable");
    drawPnlCard(ctx, d, { hideAmounts, showWallets }, font, 1);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
  }, [d, hideAmounts, showWallets]);

  const onPng = async () => {
    if (!d) return;
    setBusy("png");
    try {
      downloadBlob(await stillBlob(), `${fileStem(d)}.png`);
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy("");
    }
  };
  const onCopy = async () => {
    if (!d) return;
    setBusy("copy");
    try {
      const blob = await stillBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      toast(`Clipboard refused the image: ${failureMessage(e)}`, "err");
    } finally {
      setBusy("");
    }
  };
  const onVideo = async () => {
    if (!d || !video.ok) return;
    setBusy("video");
    try {
      const font = fontRef.current ?? (await cardFont());
      const blob = await recordPnlVideo(d, { hideAmounts, showWallets }, font, video.mime);
      if (!blob.size) throw new Error("the recorder produced an empty file");
      downloadBlob(blob, `${fileStem(d)}.webm`);
    } catch (e) {
      toast(failureMessage(e), "err");
    } finally {
      setBusy("");
    }
  };

  return (
    <BxModal open={open} onClose={onClose} title="Share PnL" width={760}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BxSeg value={period} onChange={setPeriod} options={(["1D", "7D", "30D", "All"] as Period[]).map((p) => ({ value: p, label: p }))} />
          <div className="flex flex-wrap items-center gap-4 text-[13px] text-text-200">
            <label className="flex items-center gap-2">
              <BxSwitch checked={hideAmounts} onChange={setHideAmounts} />
              Hide amounts (show % only)
            </label>
            <label className="flex items-center gap-2">
              <BxSwitch checked={showWallets} onChange={setShowWallets} />
              Show wallet count
            </label>
          </div>
        </div>
        <div className="relative w-full overflow-hidden rounded-lg border border-line-100 bg-bg-100" style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}>
          <canvas ref={canvasRef} width={CARD_W} height={CARD_H} className={cx("block h-full w-full", !d && "opacity-0")} aria-label="PnL share card preview" />
          {!d ? <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-300">{res.error ? failureMessage(res.error) : "Computing…"}</div> : null}
        </div>
        {d ? (
          <p className="text-[12px] leading-relaxed text-text-300">
            {d.trades} on-chain trade{d.trades !== 1 ? "s" : ""} in this window · net of {Number(d.fees.totalCostSol).toFixed(4)} SOL of fees
            {Number(d.fees.creatorFeesClaimedSol) > 0 ? ` · creator fees claimed +${Number(d.fees.creatorFeesClaimedSol).toFixed(4)} SOL` : ""}
            {" · USD at the current SOL price"}
            {d.estimated ? " · the ledger is still reading transactions, figures may change" : ""}
            {d.unrealisedSol === null ? " · positions unreadable right now (holdings not shown)" : ""}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <BxButton variant="primary" onClick={onPng} disabled={!d || !!busy}>
            <Download className="h-4 w-4" /> {busy === "png" ? "Rendering…" : "Download PNG"}
          </BxButton>
          <BxButton onClick={onCopy} disabled={!d || !!busy || !canCopy} title={canCopy ? undefined : "Clipboard images are not available in this browser"}>
            {copied ? <Check className="h-4 w-4 text-increase" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : busy === "copy" ? "Copying…" : "Copy image"}
          </BxButton>
          <BxButton onClick={onVideo} disabled={!d || !!busy || !video.ok} title={video.ok ? "4 s WebM, 1200×630" : "Video not supported in this browser (MediaRecorder / canvas.captureStream missing)"}>
            <Film className="h-4 w-4" /> {busy === "video" ? "Recording 4 s…" : "Download video"}
          </BxButton>
          {!video.ok ? <span className="text-[12px] text-text-300">Video not supported in this browser.</span> : null}
        </div>
      </div>
    </BxModal>
  );
}

/** Share icon button + its modal (Dashboard Portfolio PnL header, Portfolio summary). */
export function SharePnlButton({ period, className, label }: { period?: Period; className?: string; label?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cx("inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] text-text-300 transition-colors hover:bg-white/[0.04] hover:text-text-100", className)} aria-label="Share PnL" title="Share PnL">
        <Share2 className="h-3.5 w-3.5" />
        {label ? <span className="hidden sm:inline">Share</span> : null}
      </button>
      {open ? <SharePnlModal open={open} onClose={() => setOpen(false)} initialPeriod={period} /> : null}
    </>
  );
}
