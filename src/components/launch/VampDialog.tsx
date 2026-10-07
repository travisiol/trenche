"use client";
/** Vamp: paste a pump.fun CA (or its pump.fun / Axiom / GMGN link) → preview → Enter. The Launch page builds a draft
 *  from the picked preset (dev wallet, dev buy, tasks…, like Quick Launch) with the token's name, ticker,
 *  description, links and image, and opens the launch confirmation — one more click to launch. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BxButton, BxModal, PadAvatar, cx } from "@/components/bx/ui";
import { get, useGet } from "@/lib/api";
import { urlToDataUrl } from "@/components/launch/ImageCrop";
import { isMint, short } from "@/lib/format";
import type { PresetsResponse, TokenInfo } from "@/lib/types";

/** the first Solana address in what was pasted (a bare CA, or a link that carries one) */
export function mintIn(text: string): string | null {
  const t = text.trim();
  if (isMint(t)) return t;
  for (const m of t.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []) if (isMint(m)) return m;
  return null;
}

export function VampDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const presets = useGet<PresetsResponse>(open ? "/api/presets" : null);
  const list = presets.data?.presets ?? [];
  const [presetId, setPresetId] = useState<string | null>(null);
  const preset = list.find((p) => p.id === presetId) ?? list[0] ?? null;
  const mint = mintIn(text);
  const token = useGet<TokenInfo>(mint ? `/api/token/${mint}` : null);
  const t = token.data && mint && token.data.mint === mint ? token.data : null;
  const go = () => {
    if (!mint) return;
    onClose(); setText("");
    router.push(`/launch?vamp=${encodeURIComponent(mint)}${preset ? `&quick=${encodeURIComponent(preset.id)}` : ""}`);
  };
  return (
    <BxModal open={open} onClose={onClose} title="Vamp a token" width={440}>
      <div className="space-y-3">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && mint && go()} placeholder="Paste a CA or a pump.fun link" spellCheck={false}
          className="h-10 w-full rounded-md border border-line-100 bg-input-100 px-3 font-mono text-xs text-text-100 outline-none placeholder:text-text-300 focus:border-accent" />
        {mint ? (
          <div className="flex items-center gap-3 rounded-md border border-line-100 bg-bg-50 p-3">
            <PadAvatar src={t?.image ?? undefined} alt={t?.symbol ?? ""} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-100">{t ? `${t.name ?? "?"} · $${t.symbol ?? "?"}` : token.error ? "Token not found" : "Reading the token…"}</p>
              <p className="truncate font-mono text-[11px] text-text-300">{short(mint, 6, 6)}{t?.twitter || t?.website || t?.telegram ? " · links copied too" : ""}</p>
            </div>
          </div>
        ) : text.trim() ? <p className="text-xs text-text-300">No Solana address in what you pasted.</p> : null}
        <div>
          <p className="mb-1.5 text-xs text-text-300">Launch with preset</p>
          {list.length ? (
            <div className="flex flex-wrap gap-1.5">
              {list.map((p) => (
                <button key={p.id} type="button" onClick={() => setPresetId(p.id)} className={cx("h-7 rounded-md border px-2.5 text-xs font-medium transition-colors", preset?.id === p.id ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 bg-bg-50 text-text-300 hover:text-text-100")}>{p.name}</button>
              ))}
            </div>
          ) : <p className="text-[11px] leading-relaxed text-text-300">No preset saved: the Launch form opens with the token filled in, to set the dev wallet and buys there. Save a preset from the Tasks panel to launch in one click next time.</p>}
        </div>
        <p className="text-[11px] leading-relaxed text-text-300">{preset ? `Preset “${preset.name}” gives the dev wallet, buys and tasks; the token gives name, ticker, description, links and image. You confirm before anything is sent.` : "Name, ticker, description, links and image come from the token."}</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <BxButton onClick={onClose}>Cancel</BxButton>
        <BxButton variant="primary" disabled={!mint || !!token.error} onClick={go}>{preset ? "Vamp · review launch" : "Vamp · open form"}</BxButton>
      </div>
    </BxModal>
  );
}

/** The pasted token's face on a launch form: name, ticker, description, links, image (as a data URL, like Clone). */
export async function vampInto<F extends { name: string; symbol: string; description: string; twitter: string; telegram: string; website: string; imageDataUrl: string }>(form: F, mint: string): Promise<{ form: F; imageCopied: boolean }> {
  const t = await get<TokenInfo>(`/api/token/${mint}`);
  let img = form.imageDataUrl; let imageCopied = false;
  if (t.image) { try { img = await urlToDataUrl(t.image); imageCopied = true; } catch { /* host blocked the download */ } }
  return { form: { ...form, name: t.name ?? form.name, symbol: t.symbol ?? form.symbol, description: t.description ?? "", twitter: t.twitter ?? "", telegram: t.telegram ?? "", website: t.website ?? "", imageDataUrl: img }, imageCopied };
}
