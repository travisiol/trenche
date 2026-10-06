/* Live feed latency on a REAL mainnet mint (read only): trade landed (processed notification on our own WS, = the moment the leader executed it) →
   (a) live SSE event at the browser side, (b) first seen by the old 2 s poll of /api/token/<mint>/trades.
   usage: TRENCH_DATA_DIR=<data dir with settings.json> BASE=http://127.0.0.1:3992 node scripts/measure-live.mjs <mint> [seconds] [sse|poll]
   "poll" = the old path alone (open no SSE so the server's feed is not watching that mint). */
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
const [mint, secs = "120", mode = "sse"] = process.argv.slice(2);
const BASE = process.env.BASE ?? "http://127.0.0.1:3992";
const settings = JSON.parse(readFileSync(`${process.env.TRENCH_DATA_DIR}/settings.json`, "utf8"));
const key = (settings.heliusKey ?? "").trim();
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58();
const landed = new Map(), sse = new Map(), poll = new Map(), bt = new Map();
const t0 = Date.now();
// processed reference
const ws = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${key}`);
ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [curve] }, { commitment: "processed" }] }));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const v = m.params?.result?.value;
  if (v?.signature && !v.err && !landed.has(v.signature)) landed.set(v.signature, Date.now());
};
// SSE
if (mode === "sse") (async () => {
  const res = await fetch(`${BASE}/api/token/${mint}/live`);
  const rd = res.body.getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += Buffer.from(value).toString("utf8");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /event: (\w+)/.exec(chunk)?.[1];
      const data = /data: (.*)/.exec(chunk)?.[1];
      if (ev === "trade") for (const t of JSON.parse(data)) { if (!sse.has(t.signature)) sse.set(t.signature, Date.now()); bt.set(t.signature, t.blockTime); }
      if (ev === "hello") console.log("hello", JSON.parse(data).status);
    }
  }
})();
// old poll (what the UI did: every 2 s)
const pollT = mode !== "poll" ? 0 : setInterval(async () => {
  const r = await fetch(`${BASE}/api/token/${mint}/trades?limit=100`).then((r) => r.json()).catch(() => null);
  const now = Date.now();
  for (const t of r?.trades ?? []) { if (!poll.has(t.signature)) poll.set(t.signature, now); if (!bt.has(t.signature)) bt.set(t.signature, t.blockTime); }
}, 2000);
setTimeout(() => {
  clearInterval(pollT);
  const rows = [...landed.entries()].filter(([s, at]) => at - t0 > 8000); // skip the warm-up (backlog)
  const d = (m) => rows.map(([s, at]) => (m.has(s) ? m.get(s) - at : null)).filter((x) => x !== null).sort((a, b) => a - b);
  const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
  const a = d(sse), b = d(poll);
  console.log(JSON.stringify({ landed: rows.length, sse: { n: a.length, p50: q(a, 0.5), p90: q(a, 0.9), max: a.at(-1) }, poll: { n: b.length, p50: q(b, 0.5), p90: q(b, 0.9), max: b.at(-1) }, missedBySse: rows.filter(([s]) => !sse.has(s)).length }));
  process.exit(0);
}, Number(secs) * 1000);
