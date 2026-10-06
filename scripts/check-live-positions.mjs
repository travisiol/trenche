/* Live positions reconciliation on a REAL mainnet mint (read only): positions read once, then every live trade of
 * `wallets` applied with src/lib/livePositions.ts applyLive (the code the Tasks / Token info panels run), compared
 * after `seconds` with a fresh positions read (the truth). Prints per wallet: live estimate vs truth.
 *   BASE=http://127.0.0.1:3992 node scripts/check-live-positions.mjs <mint> <seconds> <wallet,wallet…>
 * The wallets must be "ours" for /api/positions (vault, trash or a launch record's wallets). Node ≥ 23 (type stripping). */
import { applyLive } from "../src/lib/livePositions.ts";
const [mint, secs = "120", list = ""] = process.argv.slice(2);
const BASE = process.env.BASE ?? "http://127.0.0.1:3992";
const wallets = list.split(",").filter(Boolean);
const own = new Set(wallets);
const read = async () => {
  const sentAt = Date.now();
  const rows = await fetch(`${BASE}/api/positions?mints=${mint}&wallets=${wallets.join(",")}`).then((r) => r.json());
  return { rows, sentAt };
};
const trades = [];
let last = null;
const ac = new AbortController();
(async () => {
  const res = await fetch(`${BASE}/api/token/${mint}/live`, { signal: ac.signal });
  const rd = res.body.getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await rd.read().catch(() => ({ done: true }));
    if (done) break;
    buf += Buffer.from(value).toString("utf8");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!/event: trade/.test(chunk)) continue;
      const now = Date.now();
      for (const t of JSON.parse(/data: (.*)/.exec(chunk)[1])) {
        const r = { ...t, receivedAt: now };
        trades.unshift(r);
        if (!last || r.slot >= last.slot) last = r;
        if (own.has(t.wallet)) console.log(new Date(now).toISOString().slice(11, 23), "own", t.wallet.slice(0, 4), t.side, t.solAmount, "SOL", t.tokens, "tok");
      }
    }
  }
})();
await new Promise((r) => setTimeout(r, 1500));
const base = await read();
console.log("base read", base.rows.map((r) => `${r.wallet.slice(0, 4)} amt ${Number(r.amount).toFixed(0)} cost ${Number(r.costSol).toFixed(4)} real ${Number(r.realisedSol).toFixed(4)}`).join(" · "));
await new Promise((r) => setTimeout(r, Number(secs) * 1000));
const est = applyLive(mint, base.rows, trades, last, own, base.sentAt);
await new Promise((r) => setTimeout(r, 4000)); // let the RPC index the last trades
const truth = await read();
ac.abort();
let worst = 0;
for (const w of wallets) {
  const e = est.find((r) => r.wallet === w), t = truth.rows.find((r) => r.wallet === w);
  if (!e && !t) continue;
  const f = (r, k) => Number(r?.[k] ?? 0);
  const d = { amount: f(e, "amount") - f(t, "amount"), cost: f(e, "costSol") - f(t, "costSol"), realised: f(e, "realisedSol") - f(t, "realisedSol"), value: f(e, "valueSol") - f(t, "valueSol") };
  worst = Math.max(worst, Math.abs(d.cost), Math.abs(d.realised));
  console.log(w.slice(0, 4), "live", { amount: f(e, "amount").toFixed(0), cost: f(e, "costSol").toFixed(6), realised: f(e, "realisedSol").toFixed(6), value: f(e, "valueSol").toFixed(4) }, "truth", { amount: f(t, "amount").toFixed(0), cost: f(t, "costSol").toFixed(6), realised: f(t, "realisedSol").toFixed(6), value: f(t, "valueSol").toFixed(4) });
}
console.log("own live trades:", trades.filter((t) => own.has(t.wallet)).length, "· all live trades:", trades.length, "· worst cost/realised gap (SOL):", worst.toFixed(9));
process.exit(0);
