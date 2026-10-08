"use client";
/** Robinhood mode › Portfolio dialogs: create, import, export, send, move, disperse (one → many), consolidate (many → one). */
import { useState } from "react";
import { Shuffle } from "lucide-react";
import { failureMessage, post } from "@/lib/api";
import { short } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxInput, BxLabel, BxModal, BxSeg, BxSelect, BxTextarea, cx } from "@/components/bx/ui";
import { Copyable, Kv, eth, ethNum, weiNum, type RhGroup, type RhTransferResult, type RhWallet } from "./common";

function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

const wlabel = (w: RhWallet) => `${w.label || short(w.address)} — ${eth(w.balanceWei, 5)} ETH`;

function GroupSelect({ groups, value, onChange, none = "No group" }: { groups: RhGroup[]; value: string; onChange: (v: string) => void; none?: string }) {
  return (
    <BxSelect value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </BxSelect>
  );
}

export function RhCreateModal({ groups, group, onClose, onDone }: { groups: RhGroup[]; group: string; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState("1");
  const [label, setLabel] = useState("");
  const [g, setG] = useState(group);
  const { busy, err, run } = useAction();
  const n = Math.round(Number(count));
  return (
    <BxModal open onClose={onClose} title="Create Robinhood wallets" width={460}>
      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
          <div>
            <BxLabel>How many</BxLabel>
            <BxInput inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>
          <div>
            <BxLabel>Name (optional)</BxLabel>
            <BxInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bundle" />
          </div>
        </div>
        <div>
          <BxLabel>Group</BxLabel>
          <GroupSelect groups={groups} value={g} onChange={setG} />
        </div>
        <p className="text-[11px] text-text-300">New keys go into eth-wallet.enc.json, encrypted with the vault passphrase; a dated backup is made first.</p>
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton
          variant="primary"
          disabled={busy || !(n >= 1 && n <= 50)}
          onClick={() =>
            run(async () => {
              await post("/api/robinhood/wallets", { action: "create", count: n, label, group: g || null });
              toast(`${n} Robinhood wallet${n > 1 ? "s" : ""} created`, "ok");
              onDone();
              onClose();
            })
          }
        >
          {busy ? "Creating…" : `Create ${n >= 1 ? n : ""} wallet${n > 1 ? "s" : ""}`}
        </BxButton>
      </div>
    </BxModal>
  );
}

export function RhImportModal({ groups, group, onClose, onDone }: { groups: RhGroup[]; group: string; onClose: () => void; onDone: () => void }) {
  const [keys, setKeys] = useState("");
  const [g, setG] = useState(group);
  const [skipped, setSkipped] = useState<string[]>([]);
  const { busy, err, run } = useAction();
  return (
    <BxModal open onClose={onClose} title="Import Robinhood wallets" width={520}>
      <div className="flex flex-col gap-3 p-4">
        <BxLabel className="mb-0">Private keys — one per line, optional name before the key</BxLabel>
        <BxTextarea rows={6} value={keys} onChange={(e) => setKeys(e.target.value)} placeholder={"main 0xabc…\n0xdef…"} className="font-mono text-xs" />
        <div>
          <BxLabel>Group</BxLabel>
          <GroupSelect groups={groups} value={g} onChange={setG} />
        </div>
        {skipped.length ? <p className="text-[11px] text-text-300">{skipped.join(" · ")}</p> : null}
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton
          variant="primary"
          disabled={busy || !keys.trim()}
          onClick={() =>
            run(async () => {
              const r = await post<{ imported: number; skipped: string[] }>("/api/robinhood/wallets", { action: "import", keys, group: g || null });
              setSkipped(r.skipped);
              if (r.imported) {
                toast(`${r.imported} wallet${r.imported > 1 ? "s" : ""} imported`, "ok");
                onDone();
                if (!r.skipped.length) onClose();
              }
            })
          }
        >
          {busy ? "Importing…" : "Import"}
        </BxButton>
      </div>
    </BxModal>
  );
}

export function RhExportModal({ address, onClose }: { address: string; onClose: () => void }) {
  const [pass, setPass] = useState("");
  const [key, setKey] = useState<{ address: string; privateKey: string; path: string } | null>(null);
  const { busy, err, run } = useAction();
  const reveal = () => run(async () => setKey(await post("/api/robinhood/export", { passphrase: pass, address })));
  return (
    <BxModal open onClose={onClose} title="Export Robinhood key" width={480}>
      <div className="flex flex-col gap-3 p-4">
        {!key ? (
          <>
            <p className="text-xs text-text-300">{short(address, 6, 6)} — your vault passphrase decrypts the key. Anyone with it controls the wallet.</p>
            <BxInput type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Vault passphrase" onKeyDown={(e) => e.key === "Enter" && pass && void reveal()} />
            {err ? <p className="text-xs text-decrease">{err}</p> : null}
            <BxButton variant="primary" disabled={!pass || busy} onClick={() => void reveal()}>
              Reveal key
            </BxButton>
          </>
        ) : (
          <>
            <BxLabel>Address</BxLabel>
            <Copyable text={key.address} />
            <BxLabel>Private key</BxLabel>
            <div className="break-all rounded-md border border-line-100 bg-bg-100 px-3 py-2">
              <Copyable text={key.privateKey} />
            </div>
            <p className="text-[11px] text-text-300">Imports into MetaMask / Rabby as a private key. Encrypted copy: {key.path}</p>
          </>
        )}
      </div>
    </BxModal>
  );
}

export function RhSendModal({ from: initialFrom, wallets, onClose, onDone }: { from: string; wallets: RhWallet[]; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(initialFrom || wallets[0]?.address || "");
  const [target, setTarget] = useState(wallets.find((w) => w.address !== initialFrom)?.address ?? "other");
  const [custom, setCustom] = useState("");
  const [amount, setAmount] = useState("");
  const { busy, err, run } = useAction();
  const src = wallets.find((w) => w.address === from);
  const to = target === "other" ? custom.trim() : target;
  return (
    <BxModal open onClose={onClose} title="Send ETH" width={480}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>From</BxLabel>
          <BxSelect value={from} onChange={(e) => setFrom(e.target.value)}>
            {wallets.map((w) => (
              <option key={w.address} value={w.address}>
                {wlabel(w)}
              </option>
            ))}
          </BxSelect>
        </div>
        <div>
          <BxLabel>To</BxLabel>
          <BxSelect value={target} onChange={(e) => setTarget(e.target.value)}>
            {wallets
              .filter((w) => w.address !== from)
              .map((w) => (
                <option key={w.address} value={w.address}>
                  {wlabel(w)}
                </option>
              ))}
            <option value="other">Another address…</option>
          </BxSelect>
          {target === "other" ? <BxInput className="mt-2 font-mono" value={custom} onChange={(e) => setCustom(e.target.value.trim())} placeholder="0x…" /> : null}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <BxLabel className="mb-0">Amount (ETH)</BxLabel>
            <button type="button" onClick={() => setAmount("max")} className="text-[11px] text-text-300 hover:text-text-100">
              Max ({eth(src?.balanceWei ?? "0", 6)})
            </button>
          </div>
          <BxInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01" />
        </div>
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton
          variant="primary"
          disabled={!/^0x[0-9a-fA-F]{40}$/.test(to) || to.toLowerCase() === from.toLowerCase() || !amount || busy}
          onClick={() =>
            run(async () => {
              const r = await post<{ valueWei: string }>("/api/robinhood/withdraw", { from, to, amount: amount.replace(",", ".") });
              toast(`Sent ${eth(r.valueWei, 6)} ETH`, "ok");
              onDone();
              onClose();
            })
          }
        >
          {busy ? "Sending…" : "Send"}
        </BxButton>
      </div>
    </BxModal>
  );
}

export function RhMoveModal({ groups, addresses, onClose, onDone }: { groups: RhGroup[]; addresses: string[]; onClose: () => void; onDone: () => void }) {
  const [g, setG] = useState(groups[0]?.id ?? "");
  const { busy, err, run } = useAction();
  return (
    <BxModal open onClose={onClose} title={`Move ${addresses.length} wallet${addresses.length > 1 ? "s" : ""}`} width={420}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>Into</BxLabel>
          <GroupSelect groups={groups} value={g} onChange={setG} none="No group (out of any group)" />
        </div>
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton
          variant="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await post("/api/robinhood/wallets", { action: "move", addresses, group: g || null });
              toast("Moved", "ok");
              onDone();
              onClose();
            })
          }
        >
          {busy ? "Moving…" : "Move"}
        </BxButton>
      </div>
    </BxModal>
  );
}

const GAS_KEEP = 0.00003;

/** one wallet pays many: the same amount each, a random amount in a range (fixed per wallet once rolled), or a total split */
export function RhDisperseModal({ wallets, groups, selected, onClose, onDone }: { wallets: RhWallet[]; groups: RhGroup[]; selected: string[]; onClose: () => void; onDone: () => void }) {
  const richest = [...wallets].sort((a, b) => weiNum(b.balanceWei) - weiNum(a.balanceWei))[0];
  const [from, setFrom] = useState(wallets.find((w) => w.main)?.address ?? richest?.address ?? "");
  const [picked, setPicked] = useState<string[]>(selected.length ? selected : []);
  const [filter, setFilter] = useState<string>("all");
  const [mode, setMode] = useState<"each" | "range" | "split">("each");
  const [each, setEach] = useState("0.005");
  const [min, setMin] = useState("0.003");
  const [max, setMax] = useState("0.006");
  const [total, setTotal] = useState("0.05");
  const [seed, setSeed] = useState(1);
  const [results, setResults] = useState<RhTransferResult[] | null>(null);
  const { busy, err, run } = useAction();
  const targets = picked.filter((a) => a.toLowerCase() !== from.toLowerCase());
  const visible = wallets.filter((w) => w.address !== from && (filter === "all" || (w.group ?? "none") === filter));
  const num = (s: string) => Number(s.replace(",", "."));
  // random amounts are a function of the seed: the preview is exactly what is sent, "roll" draws new ones
  const rnd = (i: number) => {
    const x = Math.sin(seed * 9301 + i * 49297) * 233280;
    return x - Math.floor(x);
  };
  const plan = targets.map((to, i) => {
    const v = mode === "each" ? num(each) : mode === "split" ? num(total) / Math.max(1, targets.length) : num(min) + (num(max) - num(min)) * rnd(i);
    return { to, eth: Number.isFinite(v) && v > 0 ? Math.floor(v * 1e6) / 1e6 : 0 };
  });
  const src = wallets.find((w) => w.address === from);
  const sum = plan.reduce((t, p) => t + p.eth, 0);
  const enough = src ? weiNum(src.balanceWei) >= sum + GAS_KEEP * plan.length : false;
  const valid = plan.length > 0 && plan.every((p) => p.eth > 0) && (mode !== "range" || num(max) >= num(min));
  const toggle = (a: string) => setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));
  const labelOf = (a: string) => wallets.find((w) => w.address === a)?.label ?? short(a);
  return (
    <BxModal open onClose={onClose} title="Disperse ETH" width={620}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>From</BxLabel>
          <BxSelect value={from} onChange={(e) => setFrom(e.target.value)}>
            {wallets.map((w) => (
              <option key={w.address} value={w.address}>
                {wlabel(w)}
              </option>
            ))}
          </BxSelect>
        </div>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <BxLabel className="mb-0">To · {targets.length} selected</BxLabel>
            <div className="flex flex-wrap items-center gap-1">
              {[{ id: "all", name: "All" }, ...groups, { id: "none", name: "No group" }].map((g) => (
                <button key={g.id} type="button" onClick={() => setFilter(g.id)} className={cx("rounded border px-2 py-0.5 text-[11px] transition-colors", filter === g.id ? "border-accent/40 bg-accent/15 text-accent" : "border-line-100 text-text-300 hover:text-text-100")}>
                  {g.name}
                </button>
              ))}
              <button type="button" onClick={() => setPicked((p) => [...new Set([...p, ...visible.map((w) => w.address)])])} className="rounded px-1.5 py-0.5 text-[11px] text-text-300 hover:bg-white/[0.04] hover:text-text-100">
                Select shown
              </button>
              <button type="button" onClick={() => setPicked([])} className="rounded px-1.5 py-0.5 text-[11px] text-text-300 hover:bg-white/[0.04] hover:text-text-100">
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-[220px] overflow-y-auto rounded-md border border-line-100 bg-bg-100">
            {!visible.length ? <p className="px-3 py-3 text-xs text-text-300">No wallet here.</p> : null}
            {visible.map((w) => {
              const on = picked.includes(w.address);
              const p = plan.find((x) => x.to === w.address);
              const r = results?.find((x) => x.to.toLowerCase() === w.address.toLowerCase());
              return (
                <label key={w.address} className={cx("flex cursor-pointer items-center gap-3 border-b border-line-50 px-3 py-1.5 text-xs last:border-b-0 hover:bg-white/[0.02]", on && "bg-accent/[0.05]")}>
                  <input type="checkbox" className="pi-checkbox" checked={on} onChange={() => toggle(w.address)} />
                  <span className="min-w-0 flex-1 truncate text-text-100">{w.label}</span>
                  <span className="w-24 text-right font-mono text-text-300">{eth(w.balanceWei, 5)}</span>
                  <span className={cx("w-36 text-right font-mono", r ? (r.ok ? "text-increase" : "text-decrease") : "text-text-100")} title={r?.error ?? undefined}>
                    {r ? (r.ok ? `+${eth(r.valueWei, 6)} ✓` : "failed") : on && p ? `+${ethNum(p.eth, 6)}` : "—"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <BxLabel className="mb-0">Amount</BxLabel>
            <BxSeg
              value={mode}
              onChange={setMode}
              options={[
                { value: "each", label: "Same each" },
                { value: "range", label: "Random range" },
                { value: "split", label: "Split a total" },
              ]}
            />
          </div>
          {mode === "each" ? <BxInput inputMode="decimal" value={each} onChange={(e) => setEach(e.target.value)} placeholder="0.005" /> : null}
          {mode === "split" ? <BxInput inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Total ETH" /> : null}
          {mode === "range" ? (
            <div className="flex items-center gap-2">
              <BxInput inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Min" />
              <span className="text-text-300">–</span>
              <BxInput inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max" />
              <BxButton size="sm" onClick={() => setSeed((s) => s + 1)} title="Roll new amounts">
                <Shuffle className="h-3.5 w-3.5" />
              </BxButton>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs">
          <Kv k="Wallets" v={plan.length} />
          <Kv k="Total sent" v={`${ethNum(sum, 6)} ETH`} strong />
          <Kv k="Source after" v={src ? `${ethNum(weiNum(src.balanceWei) - sum, 6)} ETH` : "—"} />
        </div>
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton
          variant="primary"
          disabled={busy || !valid || !enough}
          onClick={() =>
            run(async () => {
              const r = await post<{ results: RhTransferResult[] }>("/api/robinhood/disperse", { from, plan: plan.map((p) => ({ to: p.to, eth: String(p.eth) })) });
              setResults(r.results);
              const ok = r.results.filter((x) => x.ok).length;
              toast(`${ok}/${r.results.length} wallet${r.results.length > 1 ? "s" : ""} funded`, ok === r.results.length ? "ok" : "err");
              onDone();
            })
          }
        >
          {busy ? "Sending…" : !enough && plan.length ? `${labelOf(from)} lacks ETH` : `Disperse ${ethNum(sum, 6)} ETH to ${plan.length} wallet${plan.length === 1 ? "" : "s"}`}
        </BxButton>
        <p className="text-[11px] text-text-300">Direct transfers from one wallet (one nonce sequence), sent together — ~0.000002 ETH of gas each.</p>
      </div>
    </BxModal>
  );
}

/** many wallets → one: each sends its own transfer, all in parallel */
export function RhConsolidateModal({ wallets, selected, onClose, onDone }: { wallets: RhWallet[]; selected: string[]; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(wallets.find((w) => w.main)?.address ?? wallets[0]?.address ?? "");
  const [pct, setPct] = useState("100");
  const [results, setResults] = useState<RhTransferResult[] | null>(null);
  const { busy, err, run } = useAction();
  const sources = (selected.length ? selected : wallets.map((w) => w.address)).filter((a) => a.toLowerCase() !== to.toLowerCase());
  const total = sources.reduce((t, a) => t + weiNum(wallets.find((w) => w.address === a)?.balanceWei), 0) * (Number(pct) / 100);
  return (
    <BxModal open onClose={onClose} title="Consolidate ETH" width={520}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-text-300">
          {sources.length} wallet{sources.length === 1 ? "" : "s"} {selected.length ? "selected" : "(all)"} send their ETH, minus the gas, to one wallet.
        </p>
        <div>
          <BxLabel>To</BxLabel>
          <BxSelect value={to} onChange={(e) => setTo(e.target.value)}>
            {wallets.map((w) => (
              <option key={w.address} value={w.address}>
                {wlabel(w)}
              </option>
            ))}
          </BxSelect>
        </div>
        <div>
          <BxLabel>Share of each balance (%)</BxLabel>
          <BxInput inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9]/g, ""))} />
        </div>
        <Kv k="About" v={`${ethNum(total, 6)} ETH`} strong className="rounded-md border border-line-100 bg-bg-100 px-3 py-2.5 text-xs" />
        {results ? (
          <div className="max-h-[160px] overflow-y-auto rounded-md border border-line-100 bg-bg-100 text-xs">
            {results.map((r) => (
              <div key={r.from} className="flex items-center justify-between gap-2 border-b border-line-50 px-3 py-1.5 last:border-b-0">
                <span className="text-text-200">{wallets.find((w) => w.address.toLowerCase() === r.from.toLowerCase())?.label ?? short(r.from)}</span>
                <span className={cx("font-mono", r.ok ? "text-increase" : "text-decrease")}>{r.ok ? `${eth(r.valueWei, 6)} ETH ✓` : r.error}</span>
              </div>
            ))}
          </div>
        ) : null}
        {err ? <p className="text-xs text-decrease">{err}</p> : null}
        <BxButton
          variant="primary"
          disabled={busy || !sources.length || !(Number(pct) >= 1 && Number(pct) <= 100)}
          onClick={() =>
            run(async () => {
              const r = await post<{ results: RhTransferResult[] }>("/api/robinhood/consolidate", { from: sources, to, percent: Number(pct) });
              setResults(r.results);
              const ok = r.results.filter((x) => x.ok).length;
              toast(`${ok}/${r.results.length} wallet${r.results.length > 1 ? "s" : ""} consolidated`, ok ? "ok" : "err");
              onDone();
            })
          }
        >
          {busy ? "Sending…" : `Consolidate ${sources.length} wallet${sources.length === 1 ? "" : "s"}`}
        </BxButton>
      </div>
    </BxModal>
  );
}
