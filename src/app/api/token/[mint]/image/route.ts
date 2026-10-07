import { HttpError, requireAddress, route } from "@/server/api";
import { tokenInfo } from "@/server/token";

export const dynamic = "force-dynamic";

/** The token's own image, byte for byte (no resize, no re-encode) — fetched here because most image hosts refuse a
 *  browser download from another site (CORS), which left Vamp / Clone without the image. IPFS links are tried on
 *  several gateways. Images only, 15 MB at most. */
const GATEWAYS = ["https://ipfs.io/ipfs/", "https://cloudflare-ipfs.com/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://dweb.link/ipfs/", "https://nftstorage.link/ipfs/"];
const MAX_BYTES = 15 * 1024 * 1024;

/** the format from the first bytes, for gateways that answer application/octet-stream */
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function candidates(url: string): string[] {
  const cid = /\/ipfs\/([^?#]+)/.exec(url)?.[1] ?? /^ipfs:\/\/(?:ipfs\/)?([^?#]+)/.exec(url)?.[1] ?? /^https?:\/\/([a-z0-9]{40,})\.ipfs\.[^/]+\/?([^?#]*)/i.exec(url)?.slice(1).filter(Boolean).join("/");
  const list = url.startsWith("ipfs://") ? [] : [url];
  if (cid) for (const g of GATEWAYS) list.push(g + cid);
  return [...new Set(list)];
}

export const GET = route(async (_req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const mint = requireAddress((await ctx.params).mint, "mint");
  const info = await tokenInfo(mint);
  if (!info.image) throw new HttpError(404, "This token has no image in its metadata.");
  let last = "no answer";
  for (const url of candidates(info.image)) {
    try {
      const res = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*;q=0.8" } });
      if (!res.ok) { last = `${new URL(url).host} ${res.status}`; continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const declared = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      const type = declared.startsWith("image/") ? declared : sniff(bytes) ?? declared;
      if (bytes.length === 0 || bytes.length > MAX_BYTES) { last = `${new URL(url).host}: ${bytes.length} bytes`; continue; }
      if (!type.startsWith("image/")) { last = `${new URL(url).host}: ${type || "no type"}`; continue; }
      return new Response(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
    } catch (e) { last = `${new URL(url).host}: ${e instanceof Error ? e.message : "failed"}`; }
  }
  throw new HttpError(502, `Could not download the token image (${last}).`);
});
