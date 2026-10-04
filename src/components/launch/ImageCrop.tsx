"use client";
/** Square image picker: drop/upload or paste a URL, pan + zoom, exports a 512×512 PNG data URL. */
import { useEffect, useRef, useState } from "react";
import { Button, Input, InlineError, cx } from "../ui";
import { BxModal } from "../bx/ui";

const OUT = 512;

export function ImagePicker({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const read = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => setSrc(String(r.result));
    r.readAsDataURL(file);
  };
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) read(f);
        }}
        className={cx("relative w-full aspect-square max-w-[200px] rounded-xl border overflow-hidden shrink-0 flex items-center justify-center text-text-3 transition-colors", dragOver ? "border-accent bg-accent-soft" : value ? "border-line" : "border-dashed border-line-hover hover:border-accent bg-bg")}
        aria-label="Token image"
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- local data URL
          <img src={value} alt="Token" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center px-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="mx-auto mb-1.5"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
            <div className="text-[13px]">Drop or click</div>
          </div>
        )}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            {value ? "Replace" : "Upload"}
          </Button>
          {value ? (
            <Button size="sm" variant="ghost" onClick={() => setSrc(value)}>
              Re-crop
            </Button>
          ) : null}
          {value ? (
            <Button size="sm" variant="ghost" onClick={() => onChange("")}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {src ? (
        <CropModal
          src={src}
          onClose={() => setSrc(null)}
          onDone={(d) => {
            onChange(d);
            setSrc(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function CropModal({ src, onClose, onDone }: { src: string; onClose: () => void; onDone: (dataUrl: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const SIZE = 320;

  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      img.current = i;
      setReady(true);
    };
    i.onerror = () => setErr("This image could not be decoded.");
    i.src = src;
  }, [src]);

  useEffect(() => {
    const c = canvas.current;
    const i = img.current;
    if (!c || !i || !ready) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const base = Math.max(SIZE / i.width, SIZE / i.height) * zoom;
    const w = i.width * base;
    const h = i.height * base;
    ctx.drawImage(i, (SIZE - w) / 2 + pos.x, (SIZE - h) / 2 + pos.y, w, h);
  }, [zoom, pos, ready]);

  const done = () => {
    const i = img.current;
    if (!i) return;
    const out = document.createElement("canvas");
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext("2d")!;
    const k = OUT / SIZE;
    const base = Math.max(SIZE / i.width, SIZE / i.height) * zoom * k;
    const w = i.width * base;
    const h = i.height * base;
    ctx.drawImage(i, (OUT - w) / 2 + pos.x * k, (OUT - h) / 2 + pos.y * k, w, h);
    onDone(out.toDataURL("image/png"));
  };

  return (
    <BxModal open onClose={onClose} title="Crop image" width={400}>
      <div className="flex flex-col gap-3 p-4">
      <InlineError>{err}</InlineError>
      <div className="flex flex-col items-center gap-3">
        <canvas
          ref={canvas}
          width={SIZE}
          height={SIZE}
          className="rounded-xl border border-line bg-bg cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => setZoom((z) => Math.min(5, Math.max(1, z - e.deltaY / 600)))}
        />
        <label className="flex items-center gap-3 w-full text-sm text-text-2">
          Zoom
          <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-accent" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={done} disabled={!ready}>
          Use image
        </Button>
      </div>
          </div>
    </BxModal>
  );
}

/** Paste-a-URL helper used by Clone: fetches the image and returns a data URL (fails on CORS). */
export async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

export function UrlInput({ onLoad }: { onLoad: (dataUrl: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Image URL" className="text-[13px]" aria-label="Image URL" />
      <Button
        size="md"
        busy={busy}
        disabled={!url}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            onLoad(await urlToDataUrl(url));
            setUrl("");
          } catch {
            setErr("Could not fetch that image (blocked by its host). Download it and upload the file.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Fetch
      </Button>
      </div>
      {err ? <span className="text-[13px] text-down">{err}</span> : null}
    </div>
  );
}
