/* Route-handler helpers: uniform `{ error }` responses, input parsing, validation. */
import type { ApiError } from "@/lib/types";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (message: string): never => {
  throw new HttpError(400, message);
};

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function errorResponse(err: unknown): Response {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  const body: ApiError = { error: message.slice(0, 600) };
  return json(body, { status });
}

/** wrap a handler: any thrown error → { error } with status */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    if (!text.trim()) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isAddress = (s: unknown): s is string => typeof s === "string" && BASE58.test(s);

export function requireAddress(v: unknown, what = "address"): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!BASE58.test(s)) throw new HttpError(400, `Invalid ${what} (base58 public key expected).`);
  return s;
}

export function requireAddresses(v: unknown, what = "wallets"): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new HttpError(400, `${what}: a non-empty array of addresses is required.`);
  return v.map((x) => requireAddress(x, what));
}

/** decimal SOL string → lamports (bigint). Throws on anything not a positive decimal. */
export function lamportsOf(v: unknown, what = "sol", allowZero = false): bigint {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.?$/.test(s)) throw new HttpError(400, `${what}: a decimal SOL amount is required.`);
  const [whole, frac = ""] = s.split(".");
  const lam = BigInt(whole || "0") * BigInt(1_000_000_000) + BigInt((frac + "000000000").slice(0, 9));
  if (!allowZero && lam <= BigInt(0)) throw new HttpError(400, `${what}: must be > 0.`);
  return lam;
}

export function solString(lamports: bigint | number): string {
  const neg = lamports < 0;
  const abs = BigInt(neg ? -lamports : lamports);
  const whole = abs / BigInt(1_000_000_000);
  const frac = (abs % BigInt(1_000_000_000)).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function intIn(v: unknown, min: number, max: number, fallback: number, what = "value"): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${what}: number expected.`);
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function numIn(v: unknown, min: number, max: number, fallback: number, what = "value"): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${what}: number expected.`);
  return Math.max(min, Math.min(max, n));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** SSE response from an async subscription. `subscribe` returns an unsubscribe fn. */
export function sse(
  subscribe: (send: (event: string, data: unknown) => void) => () => void,
  signal?: AbortSignal,
): Response {
  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        unsub?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            enc.encode(
              `event: ${event}\ndata: ${JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`,
            ),
          );
        } catch {
          close();
        }
      };
      controller.enqueue(enc.encode(": trench\n\n"));
      unsub = subscribe(send);
      ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, 15000);
      signal?.addEventListener("abort", close);
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsub?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
