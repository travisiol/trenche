"use client";
/* Short notification sounds made with the Web Audio API (no audio files):
 *  - "send": a falling two-note blip when SOL leaves one of the vault wallets (a transfer step is sent)
 *  - "receive": a rising two-note chime when a vault wallet's SOL balance goes up
 * Muted together with the toasts (Settings › Notifications), and a separate switch for sounds only. */

const SOUND_KEY = "donchain.sounds.muted";

export function soundsMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1" || localStorage.getItem("donchain.toasts.muted") === "1";
  } catch {
    return false;
  }
}

export function setSoundsMuted(v: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, gain: number) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ac.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

let last = 0;
export function playSound(kind: "send" | "receive") {
  if (soundsMuted()) return;
  const now = Date.now();
  if (now - last < 120) return; // a burst of steps plays once
  last = now;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  if (kind === "send") {
    tone(ac, 880, t, 0.12, 0.08);
    tone(ac, 660, t + 0.09, 0.16, 0.08);
  } else {
    tone(ac, 660, t, 0.12, 0.09);
    tone(ac, 990, t + 0.1, 0.22, 0.09);
  }
}

/* ---- triggers ---------------------------------------------------------------------------------------------- */

/** job kinds that move SOL between wallets (send sound when one of their payments is broadcast) */
const FUND_KINDS = new Set(["withdraw", "transfer", "disperse", "distribute", "consolidate", "reverse", "private-send", "privatesend"]);
const sentSeen = new Map<string, number>();

/** called by the shared job stream on every update */
export function soundOnJob(job: { id: string; kind: string; sent: number }) {
  if (!FUND_KINDS.has(job.kind)) return;
  const prev = sentSeen.get(job.id) ?? 0;
  if (job.sent > prev) playSound("send");
  sentSeen.set(job.id, job.sent);
}

let prevBalances: Record<string, number> | null = null;
/** called with each fresh /api/balances answer: a vault wallet whose SOL went up plays the receive sound */
export function soundOnBalances(b: Record<string, string | null> | null | undefined) {
  if (!b) return;
  const next: Record<string, number> = {};
  for (const [a, v] of Object.entries(b)) if (v !== null && v !== undefined) next[a] = Number(v);
  if (prevBalances) {
    const up = Object.entries(next).some(([a, v]) => prevBalances![a] !== undefined && v - prevBalances![a] > 0.000001);
    if (up) playSound("receive");
  }
  prevBalances = next;
}
