/* "Fetch mint address" (Block X reserves a …pump address from a pool): grind an ed25519 keypair whose base58 address
 * ends with a suffix, in CHILD PROCESSES (node crypto, no deps — ~18k keys/s each; the dev server's event loop is
 * never blocked), and keep the keypair server-side in runtime.json until /api/launch/prepare uses it. */
import { spawn, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";
import { Keypair } from "@solana/web3.js";
import type { ReservedMint } from "@/lib/types";
import { HttpError } from "./api";
import { jobNew, jobRun } from "./jobs";
import { registerRuntimeProducer, restoreSection, saveRuntimeSoon } from "./persist";
import { logActivity, store } from "./store";

/* worker: generate keys until one matches, print {"seed":hex} and exit; progress lines every 20k tries */
const WORKER = `
const c = require("node:crypto");
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) { const d = [0]; for (const byte of buf) { let carry = byte; for (let j = 0; j < d.length; j++) { carry += d[j] << 8; d[j] = carry % 58; carry = (carry / 58) | 0; } while (carry) { d.push(carry % 58); carry = (carry / 58) | 0; } } let s = ""; for (const byte of buf) { if (byte) break; s += "1"; } for (let i = d.length - 1; i >= 0; i--) s += A[d[i]]; return s; }
const suffix = process.env.VANITY_SUFFIX; const cs = process.env.VANITY_CS === "1"; const want = cs ? suffix : suffix.toLowerCase();
let n = 0;
for (;;) {
  const { publicKey, privateKey } = c.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const addr = b58(pub);
  if ((cs ? addr : addr.toLowerCase()).endsWith(want)) {
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    process.stdout.write(JSON.stringify({ seed: seed.toString("hex"), addr }) + "\\n");
    process.exit(0);
  }
  if (++n % 20000 === 0) process.stdout.write(JSON.stringify({ tries: 20000 }) + "\\n");
}
`;

export type GrindResult = { keypair: Keypair; tries: number; ms: number; workers: number };

/** resolves with the keypair, or null after `timeoutMs` (every worker is killed either way) */
export function grindVanity(suffix: string, o: { caseSensitive?: boolean; timeoutMs?: number; workers?: number; onProgress?: (tries: number) => void; signal?: { stopped: boolean } } = {}): Promise<GrindResult | null> {
  const s = suffix.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{1,6}$/.test(s)) throw new HttpError(400, "suffix: 1–6 base58 characters (no 0, O, I, l).");
  const workers = Math.max(1, Math.min(32, o.workers ?? Math.max(1, cpus().length - 2)));
  const timeoutMs = Math.max(1000, Math.min(600_000, o.timeoutMs ?? 90_000));
  const t0 = Date.now();
  return new Promise((resolve) => {
    const procs: ChildProcess[] = [];
    let tries = 0;
    let done = false;
    const finish = (r: GrindResult | null) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      for (const p of procs) {
        try {
          p.kill();
        } catch {
          /* gone */
        }
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const poll = setInterval(() => {
      if (o.signal?.stopped) finish(null);
    }, 250);
    for (let i = 0; i < workers; i++) {
      const p = spawn(process.execPath, ["-e", WORKER], { cwd: store().dir, env: { ...process.env, VANITY_SUFFIX: s, VANITY_CS: o.caseSensitive ? "1" : "0" }, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      procs.push(p);
      let buf = "";
      p.stdout?.on("data", (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          try {
            const j = JSON.parse(line) as { seed?: string; addr?: string; tries?: number };
            if (j.tries) {
              tries += j.tries;
              o.onProgress?.(tries);
            } else if (j.seed) {
              const kp = Keypair.fromSeed(Buffer.from(j.seed, "hex"));
              finish({ keypair: kp, tries, ms: Date.now() - t0, workers });
            }
          } catch {
            /* partial line */
          }
        }
      });
      p.on("error", () => {
        /* a worker that cannot spawn: the others continue; all failing → timeout */
      });
    }
  });
}

/* ------------------------------------------------------------------ reserved mints (runtime.json) */

/** `pool`: ground in the background, not handed to any draft yet (Fetch mint address takes one instantly) */
type Reserved = ReservedMint & { secret: string; pool?: boolean };

/** how many ready …pump addresses the background keeps, and how many CPU workers it may use (the machine stays usable) */
const POOL_TARGET = 3;
const POOL_SUFFIX = "pump";
const POOL_WORKERS = Math.max(1, Math.min(6, Math.floor(cpus().length / 4)));
type Bag = { mints: Map<string, Reserved>; grinding: Map<string, { jobId: string; suffix: string; startedAt: number; signal: { stopped: boolean } }> };

function bag(): Bag {
  const rt = store().runtime;
  if (!rt.reservedMints) {
    const b: Bag = { mints: new Map(), grinding: new Map() };
    rt.reservedMints = b;
    registerRuntimeProducer("reservedMints", () => [...b.mints.values()]);
    for (const r of restoreSection<Reserved[]>("reservedMints") ?? []) if (r?.mint && r.secret) b.mints.set(r.mint, r);
  }
  return rt.reservedMints as Bag;
}

export function reservedMints(): { mints: ReservedMint[]; grinding: { jobId: string; suffix: string; startedAt: number }[] } {
  const b = bag();
  ensurePool();
  return { mints: [...b.mints.values()].filter((m) => !m.pool).map(({ secret: _s, pool: _p, ...m }) => m).sort((a, c) => c.at - a.at), grinding: [...b.grinding.values()].map(({ jobId, suffix, startedAt }) => ({ jobId, suffix, startedAt })) };
}

/* background pool: keeps POOL_TARGET unused …pump keypairs ready, one low-CPU grind at a time, paused while a
   user-requested grind runs */
const poolState = (globalThis as unknown as { __trenchMintPool?: { running: boolean } }).__trenchMintPool ?? ((globalThis as unknown as { __trenchMintPool?: { running: boolean } }).__trenchMintPool = { running: false });
export function ensurePool(): void {
  if (poolState.running) return;
  const b = bag();
  const ready = [...b.mints.values()].filter((m) => m.pool && !m.usedAt && m.suffix === POOL_SUFFIX).length;
  if (ready >= POOL_TARGET || b.grinding.size > 0) return;
  poolState.running = true;
  void grindVanity(POOL_SUFFIX, { caseSensitive: true, timeoutMs: 600_000, workers: POOL_WORKERS })
    .then((r) => {
      if (!r) return;
      const mint = r.keypair.publicKey.toBase58();
      b.mints.set(mint, { mint, suffix: POOL_SUFFIX, at: Date.now(), usedAt: null, secret: Buffer.from(r.keypair.secretKey).toString("base64"), pool: true });
      saveRuntimeSoon();
    })
    .catch(() => null)
    .finally(() => {
      poolState.running = false;
      setTimeout(ensurePool, 2_000);
    });
}

/** start a grind job; job.extra.mint is set when found */
export function reserveMint(suffix: string, o: { caseSensitive?: boolean; timeoutMs?: number }): { jobId: string } {
  const s = suffix.trim() || "pump";
  if (!/^[1-9A-HJ-NP-Za-km-z]{1,6}$/.test(s)) throw new HttpError(400, "suffix: 1–6 base58 characters (no 0, O, I, l).");
  const b = bag();
  // a ready address from the background pool: handed over at once (same job shape, already done)
  const ready = s === POOL_SUFFIX && o.caseSensitive !== false ? [...b.mints.values()].find((m) => m.pool && !m.usedAt) : undefined;
  if (ready) {
    ready.pool = false;
    ready.at = Date.now();
    saveRuntimeSoon();
    const job = jobNew("vanity", 1, `Fetch mint address …${s}`);
    job.extra = { suffix: s, caseSensitive: true, tries: 0, mint: ready.mint, fromPool: true };
    jobRun(job, async (j) => {
      j.steps.push({ ok: true, at: Date.now(), address: ready.mint, note: "ready address from the background pool (instant)" });
      j.completed = 1;
      j.sent = 1;
      logActivity(store(), { kind: "launch", ok: true, message: `Mint address reserved: ${ready.mint} (…${s}, from the pool)`, mint: ready.mint, jobId: j.id });
    });
    setTimeout(ensurePool, 500);
    return { jobId: job.id };
  }
  if (b.grinding.size >= 2) throw new HttpError(429, "Two mint grinds already run — wait for one to finish.");
  const timeoutMs = Math.max(1000, Math.min(600_000, Number(o.timeoutMs) || 90_000));
  const job = jobNew("vanity", 1, `Fetch mint address …${s}`);
  const signal = { stopped: false };
  b.grinding.set(job.id, { jobId: job.id, suffix: s, startedAt: Date.now(), signal });
  job.extra = { suffix: s, caseSensitive: !!o.caseSensitive, tries: 0, mint: null };
  jobRun(job, async (j) => {
    const r = await grindVanity(s, { caseSensitive: o.caseSensitive, timeoutMs, signal, onProgress: (t) => { j.extra = { ...(j.extra ?? {}), tries: t }; } }).finally(() => b.grinding.delete(job.id));
    if (j.stop) signal.stopped = true;
    if (!r) throw new Error(`No address ending with "${s}" found in ${Math.round(timeoutMs / 1000)} s (${(j.extra?.tries as number) ?? 0} tries). Try again or a shorter suffix.`);
    const mint = r.keypair.publicKey.toBase58();
    const rec: Reserved = { mint, suffix: s, at: Date.now(), usedAt: null, secret: Buffer.from(r.keypair.secretKey).toString("base64") };
    b.mints.set(mint, rec);
    setTimeout(ensurePool, 2_000);
    if (b.mints.size > 50) {
      const oldest = [...b.mints.values()].filter((m) => m.usedAt).sort((a, c) => a.at - c.at)[0];
      if (oldest) b.mints.delete(oldest.mint);
    }
    saveRuntimeSoon();
    j.extra = { ...(j.extra ?? {}), mint, tries: r.tries, ms: r.ms, workers: r.workers };
    j.steps.push({ ok: true, at: Date.now(), address: mint, note: `found after ${r.tries} tries in ${(r.ms / 1000).toFixed(1)} s (${r.workers} workers)` });
    j.completed = 1;
    j.sent = 1;
    logActivity(store(), { kind: "launch", ok: true, message: `Mint address reserved: ${mint} (…${s}, ${(r.ms / 1000).toFixed(1)} s)`, mint, jobId: j.id });
  });
  return { jobId: job.id };
}

/** the keypair of a reserved, unused mint; marks it used */
export function takeReserved(mint: string): Keypair {
  const b = bag();
  const r = b.mints.get(mint);
  if (!r) throw new HttpError(404, "Unknown reserved mint: fetch one with POST /api/launch/mint first (reserved mints live in runtime.json).");
  if (r.usedAt) throw new HttpError(409, "This reserved mint was already used by a launch.");
  const kp = Keypair.fromSecretKey(Buffer.from(r.secret, "base64"));
  r.usedAt = Date.now();
  saveRuntimeSoon();
  return kp;
}

/** the keypair of a reserved, unused mint WITHOUT marking it used (a launch prepared ahead of its click: /api/launch/
 *  execute marks it used) */
export function peekReserved(mint: string): Keypair {
  const r = bag().mints.get(mint);
  if (!r) throw new HttpError(404, "Unknown reserved mint: fetch one with POST /api/launch/mint first (reserved mints live in runtime.json).");
  if (r.usedAt) throw new HttpError(409, "This reserved mint was already used by a launch.");
  return Keypair.fromSecretKey(Buffer.from(r.secret, "base64"));
}

/** is this mint a reserved one (pool or "Fetch mint address")? */
export function isReserved(mint: string): boolean {
  return bag().mints.has(mint);
}

/** a launch that was refused before anything was sent hands the reserved mint back (usedAt cleared) */
export function unuseReserved(mint: string): void {
  const r = bag().mints.get(mint);
  if (r && r.usedAt) {
    r.usedAt = null;
    saveRuntimeSoon();
  }
}

export function releaseReserved(mint: string): void {
  const b = bag();
  const r = b.mints.get(mint);
  if (!r) throw new HttpError(404, "Unknown reserved mint.");
  if (r.usedAt) throw new HttpError(409, "This mint was used by a launch: it cannot be released.");
  // never used: back into the ready pool (a …pump address costs minutes of grinding)
  if (r.suffix === POOL_SUFFIX) r.pool = true;
  else b.mints.delete(mint);
  saveRuntimeSoon();
}
