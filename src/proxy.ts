/* Request guard for every API route. DONCHAIN holds an unlocked vault in memory: its API must answer this machine's
 * own DONCHAIN tab and nothing else.
 *  · Host must be a loopback name (localhost / 127.0.0.1 / [::1]) — blocks DNS-rebinding pages and other devices of
 *    the network that would reach the port by IP.
 *  · A cross-site browser request is refused (Sec-Fetch-Site: cross-site, or an Origin that is not this host) —
 *    blocks any website open in the browser from POSTing to localhost while the vault is unlocked.
 *  · A POST must carry `content-type: application/json` — a cross-site "simple" request (form / text/plain) cannot,
 *    and the other methods are preflighted, which this server never grants. */
import { NextResponse, type NextRequest } from "next/server";

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function refuse(why: string) {
  return NextResponse.json({ error: `Refused: ${why}` }, { status: 403, headers: { "cache-control": "no-store" } });
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOOPBACK.test(host)) return refuse("DONCHAIN only answers on localhost.");
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return refuse("cross-site request.");
  const origin = request.headers.get("origin");
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).host.toLowerCase() === host.toLowerCase();
    } catch {
      ok = false;
    }
    if (!ok) return refuse("foreign origin.");
  }
  if (request.method === "POST") {
    const type = request.headers.get("content-type") ?? "";
    const len = Number(request.headers.get("content-length") ?? "0");
    if (len > 0 && !/^application\/json\b/i.test(type)) return refuse("JSON body required.");
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
