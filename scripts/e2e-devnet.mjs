/* End-to-end driver against a running TRENCH server (default http://localhost:3985).
 * Phases (env E2E_PHASE): "setup" (vault + wallets + devnet + export/import), "funds" (needs SOL on dev-1),
 * "launch" (pump.fun on devnet), "restart-check". Prints every signature. Nothing here touches mainnet:
 * it refuses to run unless /api/settings reports cluster "devnet". */
const BASE = process.env.TRENCH_URL || "http://localhost:3985";
const PASS = process.env.E2E_PASS || "trench devnet e2e passphrase 2026";
const phase = process.env.E2E_PHASE || "setup";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const log = (...a) => console.log(...a);
async function waitJob(id, timeoutMs = 240_000) {
  const t0 = Date.now();
  for (;;) {
    const j = await api("GET", `/api/jobs/${id}`);
    if (j.done || Date.now() - t0 > timeoutMs) return j;
    await sleep(1500);
  }
}
function printJob(j) {
  log(`  job ${j.id} [${j.kind}] ${j.status} ${j.sent}/${j.total} sent, ${j.failed} failed${j.error ? " — " + j.error : ""} (cluster ${j.cluster})`);
  for (const s of j.steps) log(`    ${s.ok ? "ok " : "ERR"} ${s.phase ?? ""} ${s.address ? s.address.slice(0, 8) + "…" : ""} ${s.sol ?? ""} ${s.signature ?? ""} ${s.error ?? s.note ?? ""}`);
  return j;
}
async function runJob(label, method, path, body) {
  log(`\n== ${label}`);
  const r = await api(method, path, body);
  if (!r.jobId) {
    log("  refused:", r.status, r.error);
    return r;
  }
  return printJob(await waitJob(r.jobId));
}

const vault = await api("GET", "/api/vault");
if (!vault.exists) log("create vault:", (await api("POST", "/api/vault/create", { passphrase: PASS })).unlocked);
else if (!vault.unlocked) log("unlock vault:", (await api("POST", "/api/vault/unlock", { passphrase: PASS })).unlocked);

let settings = await api("GET", "/api/settings");
if (settings.cluster !== "devnet") {
  settings = await api("POST", "/api/settings", { cluster: "devnet" });
  log("switched to devnet:", settings.cluster, settings.effectiveRpcUrl, settings.explorerSuffix);
}
if (settings.cluster !== "devnet") throw new Error("refusing to run: cluster is not devnet");

let w = await api("GET", "/api/wallets");
const labelled = (l) => w.wallets.find((x) => x.label === l)?.address;

if (phase === "setup") {
  if (!labelled("dev-1")) {
    await api("POST", "/api/wallets/generate", { count: 5, label: "dev" });
    w = await api("GET", "/api/wallets");
  }
  log("wallets:", w.wallets.map((x) => `${x.label}=${x.address}`).join("\n         "));
  const dev1 = labelled("dev-1");
  log("\n== airdrop 2 SOL → dev-1");
  const a = await api("POST", "/api/dev/airdrop", { wallet: dev1, sol: "2" });
  log("  ", a.status, a.error ?? `confirmed=${a.confirmed} sig=${a.signature} balance=${a.balance} ${a.explorer}`);

  log("\n== export dev-5 then remove + re-import");
  const dev5 = labelled("dev-5");
  const bad = await api("POST", "/api/wallets/export", { address: dev5, passphrase: "wrong passphrase 123456" });
  log("  wrong passphrase →", bad.status, bad.error);
  const ex = await api("POST", "/api/wallets/export", { address: dev5, passphrase: PASS });
  const secret = ex.keys?.[0]?.secret;
  log("  export →", ex.status, "secret length", secret?.length, "address", ex.keys?.[0]?.address);
  const rm = await api("POST", "/api/wallets/remove", { addresses: [dev5] });
  log("  removed:", rm.status, rm.removed ?? rm.error);
  const im = await api("POST", "/api/wallets/import", { lines: [`dev-5,${secret}`] });
  log("  import →", im.status, "added", im.added, "same address back:", im.wallets?.some((x) => x.address === dev5));

  log("\n== relay transfer with empty wallets (balance guard)");
  await runJob("transfer dev-1 → dev-2 via relay (expect refusal)", "POST", "/api/fund/transfer", { from: dev1, to: labelled("dev-2"), sol: "0.1", viaRelay: true });

  log("\n== prepare a launch (real IPFS upload) → pending mint persisted");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const prep = await api("POST", "/api/launch/prepare", { name: "Trench Devnet", symbol: "TDEV", description: "devnet e2e", imageDataUrl: png });
  log("  prepare →", prep.status, prep.mint ?? prep.error, prep.uri ?? "");
  log("\nSETUP DONE. dev-1 =", dev1, "| pending mint =", prep.mint);
}

if (phase === "restart-check") {
  const jobs = await api("GET", "/api/jobs");
  log("jobs after restart:", jobs.jobs?.length, jobs.jobs?.slice(0, 5).map((j) => `${j.id} ${j.kind} ${j.status}`).join(" | "));
  const mint = process.env.E2E_MINT;
  if (mint) {
    const ex = await api("POST", "/api/launch/execute", { mint, launchpad: "pumpfun", devWallet: labelled("dev-1"), devBuySol: "0.05", quote: "SOL", tasks: [] });
    log("execute after restart →", ex.status, ex.error ?? ex);
  }
  const vol = await api("GET", `/api/dev/volume?mint=${process.env.E2E_MINT ?? "11111111111111111111111111111111"}`);
  log("volume status:", JSON.stringify(vol).slice(0, 300));
}

if (phase === "funds") {
  const dev1 = labelled("dev-1");
  const bal = await api("GET", "/api/balances");
  log("balances:", JSON.stringify(bal));
  if (Number(bal[dev1] ?? 0) < 0.5) throw new Error("dev-1 needs ≥ 0.5 SOL on devnet first");
  const [d2, d3, d4, d5] = ["dev-2", "dev-3", "dev-4", "dev-5"].map(labelled);
  const ext = process.env.E2E_EXTERNAL; // optional external address for the withdraw
  await runJob("withdraw 0.01 SOL dev-1 → external", "POST", "/api/fund/withdraw", { from: dev1, to: ext ?? d5, sol: "0.01" });
  await runJob("transfer 0.05 SOL dev-1 → dev-2", "POST", "/api/fund/transfer", { from: dev1, to: d2, sol: "0.05" });
  await runJob("transfer 0.05 SOL dev-1 → dev-3 via relay", "POST", "/api/fund/transfer", { from: dev1, to: d3, sol: "0.05", viaRelay: true });
  await runJob("disperse dev-1 → 4 wallets 0.02–0.04 SOL, 500–2500 ms", "POST", "/api/fund/disperse", { from: dev1, to: [d2, d3, d4, d5], minSol: "0.02", maxSol: "0.04", minDelay: 500, maxDelay: 2500 });
  await runJob("disperse dev-1 → 2 wallets via relay", "POST", "/api/fund/disperse", { from: dev1, to: [d4, d5], minSol: "0.01", maxSol: "0.02", minDelay: 0, maxDelay: 1000, viaRelay: true });
  await runJob("consolidate 4 → dev-1", "POST", "/api/fund/consolidate", { from: [d2, d3, d4, d5], to: dev1 });
  log("\nbalances after:", JSON.stringify(await api("GET", "/api/balances")));
}
