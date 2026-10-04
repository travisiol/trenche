"use client";
/** Portfolio modals in Block X components: create / import / export / move / deposit / withdraw / transfer /
 *  distribute / consolidate / privacy disperse / reverse disperse / airdrop. */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Eye, KeyRound, Plus, Share2, Shuffle, Undo2, Upload, Droplet } from "lucide-react";
import type { JobCreated, WalletGroup, WalletInfo, WalletsExportResponse, AirdropResponse } from "@/lib/types";
import { post, failureMessage } from "@/lib/api";
import { refreshVaultDependents, walletsRes } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { toast } from "@/components/ui";
import { BxButton, BxInput, BxLabel, BxModal, BxSelect, BxSwitch, cx } from "@/components/bx/ui";
import { WalletPicker } from "@/components/bx/WalletPicker";
import { BxJob } from "@/components/bx/Job";

export type ModalKind = "create" | "import" | "export" | "move" | "deposit" | "withdraw" | "transfer" | "distribute" | "consolidate" | "disperse" | "reverse" | "airdrop" | null;

export type Base = { open: boolean; onClose: () => void; wallets: WalletInfo[]; groups: WalletGroup[]; selected: string[]; active: string | null; balances: Record<string, string | null> | null };

const TX_FEE = 0.000005;
const RELAY_FEE = 0.00001;

function useSubmit() {
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
  return { busy, err, run, setErr };
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "bad" | "good" }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-300">{k}</span>
      <span className={cx("font-mono tabular-nums", tone === "bad" ? "text-decrease" : tone === "good" ? "text-green-100" : "text-text-100")}>{v}</span>
    </div>
  );
}
function Summary({ rows, note }: { rows: { k: string; v: string; tone?: "bad" | "good" }[]; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line-100 bg-bg-50 px-3 py-2.5">
      {rows.map((r) => (
        <Row key={r.k} {...r} />
      ))}
      {note ? <p className="pt-1 text-[11px] text-text-300">{note}</p> : null}
    </div>
  );
}
function Err({ children }: { children: string | null }) {
  return children ? <p className="rounded-md border border-decrease/30 bg-decrease/10 px-3 py-2 text-xs text-decrease">{children}</p> : null;
}
function Foot({ onClose, children, label = "Cancel" }: { onClose: () => void; children: React.ReactNode; label?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line-50 px-4 py-3">
      <BxButton onClick={onClose}>{label}</BxButton>
      {children}
    </div>
  );
}
function WalletSelect({ value, onChange, wallets, balances, placeholder = "Choose a wallet" }: { value: string; onChange: (v: string) => void; wallets: WalletInfo[]; balances: Base["balances"]; placeholder?: string }) {
  return (
    <BxSelect value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {wallets.map((w) => (
        <option key={w.address} value={w.address}>
          {w.label || short(w.address)} — {sol(balances?.[w.address] ?? w.sol)} SOL
        </option>
      ))}
    </BxSelect>
  );
}
const bal = (b: Base["balances"], wallets: WalletInfo[], a: string) => Number(b?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0) || 0;

/* ------------------------------------------------------------ Create */
export function CreateModal({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: WalletGroup[] }) {
  const [count, setCount] = useState("5");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");
  const s = useSubmit();
  const n = Math.max(1, Math.min(100, Number(count) || 0));
  return (
    <BxModal open={open} onClose={onClose} title="Create Wallets" width={440}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>How many</BxLabel>
          <BxInput type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} />
          <p className="mt-1 text-[11px] text-text-300">1 to 100 fresh keypairs, encrypted into the vault. Labels get a number suffix.</p>
        </div>
        <div>
          <BxLabel>Label prefix (optional)</BxLabel>
          <BxInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bundle" />
        </div>
        <div>
          <BxLabel>Group (optional)</BxLabel>
          <BxSelect value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </BxSelect>
        </div>
        <Err>{s.err}</Err>
      </div>
      <Foot onClose={onClose}>
        <BxButton
          variant="primary"
          disabled={s.busy}
          onClick={() =>
            s.run(async () => {
              await post("/api/wallets/generate", { count: n, label: label || undefined, group: group || undefined });
              refreshVaultDependents();
              toast(`${n} wallet${n > 1 ? "s" : ""} created`, "ok");
              onClose();
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Create {n}
        </BxButton>
      </Foot>
    </BxModal>
  );
}

/* ------------------------------------------------------------ Import */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const s = useSubmit();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (
    <BxModal open={open} onClose={onClose} title="Import Wallets" width={540}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>Private keys</BxLabel>
          <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={"Dev, 4NxQ…\n[12,34,…]"} className="w-full rounded-md border border-line-100 bg-input-100 px-3 py-2 font-mono text-xs text-text-100 outline-none placeholder:text-text-300 focus:border-accent" />
          <p className="mt-1 text-[11px] text-text-300">One per line: base58 secret or JSON byte array. Optional label before a comma. Keys never leave this machine.</p>
        </div>
        <Err>{s.err}</Err>
      </div>
      <Foot onClose={onClose}>
        <BxButton
          variant="primary"
          disabled={!lines.length || s.busy}
          onClick={() =>
            s.run(async () => {
              const r = await post<{ added: number; errors: string[] }>("/api/wallets/import", { lines });
              refreshVaultDependents();
              toast(`${r.added} imported${r.errors?.length ? `, ${r.errors.length} rejected` : ""}`, r.errors?.length ? "err" : "ok");
              if (!r.errors?.length) {
                setText("");
                onClose();
              } else s.setErr(r.errors.join("\n"));
            })
          }
        >
          <Upload className="h-3.5 w-3.5" /> Import {lines.length || ""}
        </BxButton>
      </Foot>
    </BxModal>
  );
}

/* ------------------------------------------------------------ Export keys */
export function ExportModal({ open, onClose, wallets, selected, active }: Base) {
  const [pass, setPass] = useState("");
  const [keys, setKeys] = useState<WalletsExportResponse["keys"] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const s = useSubmit();
  const targets = selected.length ? selected : active ? [active] : [];
  const close = () => {
    setKeys(null);
    setPass("");
    onClose();
  };
  const copy = (k: string, t: string) => navigator.clipboard?.writeText(t).then(() => (setCopied(k), setTimeout(() => setCopied(null), 1000)));
  return (
    <BxModal open={open} onClose={close} title={`Export Keys (${targets.length})`} width={540}>
      {!keys ? (
        <>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-xs text-text-300">{targets.length ? `Private keys of ${targets.map((a) => wallets.find((w) => w.address === a)?.label || short(a)).join(", ")} will be shown in clear.` : "Select wallets in the list first."}</p>
            <div>
              <BxLabel>Passphrase</BxLabel>
              <BxInput type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" placeholder="Re-enter your vault passphrase" />
            </div>
            <Err>{s.err}</Err>
          </div>
          <Foot onClose={close}>
            <BxButton variant="danger" disabled={!pass || !targets.length || s.busy} onClick={() => s.run(async () => setKeys((await post<WalletsExportResponse>("/api/wallets/export", { addresses: targets, passphrase: pass })).keys))}>
              <Eye className="h-3.5 w-3.5" /> Reveal keys
            </BxButton>
          </Foot>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2 p-4">
            <p className="rounded-md border border-yellow-100/30 bg-yellow-100/10 px-3 py-2 text-xs text-yellow-100">Anyone with these keys controls the wallets.</p>
            {keys.map((k) => (
              <div key={k.address} className="rounded-md border border-line-100 bg-bg-50 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-text-100">{k.label || short(k.address)}</span>
                  <button type="button" onClick={() => copy(k.address, k.secret)} className="inline-flex items-center gap-1 text-text-300 hover:text-text-100">
                    {copied === k.address ? <Check className="h-3 w-3 text-green-100" /> : <Copy className="h-3 w-3" />} Copy
                  </button>
                </div>
                <div className="mt-1 select-all break-all font-mono text-[11px] text-text-200">{k.secret}</div>
              </div>
            ))}
          </div>
          <Foot onClose={close} label="Done">
            <BxButton onClick={() => copy("all", keys.map((k) => `${k.label}, ${k.secret}`).join("\n"))}>
              <KeyRound className="h-3.5 w-3.5" /> {copied === "all" ? "Copied" : "Copy all"}
            </BxButton>
          </Foot>
        </>
      )}
    </BxModal>
  );
}

/* ------------------------------------------------------------ Move to group */
export function MoveModal({ open, onClose, wallets, groups, selected }: Base) {
  const [group, setGroup] = useState("");
  const [newName, setNewName] = useState("");
  const s = useSubmit();
  const names = selected.map((a) => wallets.find((w) => w.address === a)?.label || short(a));
  return (
    <BxModal open={open} onClose={onClose} title={`Move ${selected.length} wallet${selected.length !== 1 ? "s" : ""}`} width={440}>
      <div className="flex flex-col gap-3 p-4">
        <p className="truncate text-xs text-text-300" title={names.join(", ")}>
          {names.join(", ") || "Select wallets first."}
        </p>
        <div>
          <BxLabel>Into group</BxLabel>
          <BxSelect value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">No group (remove from groups)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="__new">+ New group…</option>
          </BxSelect>
        </div>
        {group === "__new" ? (
          <div>
            <BxLabel>New group name</BxLabel>
            <BxInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bundle A" autoFocus />
          </div>
        ) : null}
        <Err>{s.err}</Err>
      </div>
      <Foot onClose={onClose}>
        <BxButton
          variant="primary"
          disabled={!selected.length || s.busy || (group === "__new" && !newName.trim())}
          onClick={() =>
            s.run(async () => {
              let target: string | null = group || null;
              if (group === "__new") {
                const r = await post<{ group: WalletGroup }>("/api/groups", { name: newName.trim() });
                target = r.group.id;
              }
              await post("/api/wallets/move", { addresses: selected, group: target });
              walletsRes.refresh();
              toast(target ? `Moved ${selected.length} wallet${selected.length !== 1 ? "s" : ""}` : "Removed from groups", "ok");
              onClose();
            })
          }
        >
          Move
        </BxButton>
      </Foot>
    </BxModal>
  );
}

/* ------------------------------------------------------------ Deposit */
export function DepositModal({ open, onClose, wallets, selected, active, balances }: Base) {
  const [addr, setAddr] = useState(selected[0] ?? active ?? "");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const target = addr || selected[0] || active || "";
  useEffect(() => {
    if (!open || !target) return;
    let alive = true;
    QRCode.toDataURL(target, { margin: 1, width: 200, color: { dark: "#f0f5f5", light: "#0a0a0a" } }).then((u) => alive && setQr(u));
    return () => {
      alive = false;
    };
  }, [open, target]);
  return (
    <BxModal open={open} onClose={onClose} title="Deposit" width={420}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>Wallet</BxLabel>
          <WalletSelect value={target} onChange={setAddr} wallets={wallets} balances={balances} />
        </div>
        {target ? (
          <div className="flex flex-col items-center gap-3">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side
              <img src={qr} alt="Deposit address QR" width={200} height={200} className="rounded-md border border-line-100" />
            ) : null}
            <button type="button" onClick={() => navigator.clipboard?.writeText(target).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1000)))} className="inline-flex max-w-full items-center gap-1.5 break-all font-mono text-[11px] text-text-200 hover:text-text-100">
              {target} {copied ? <Check className="h-3 w-3 shrink-0 text-green-100" /> : <Copy className="h-3 w-3 shrink-0" />}
            </button>
            <p className="text-center text-[11px] text-text-300">Send SOL to this address. The balance refreshes every 5 seconds.</p>
          </div>
        ) : null}
      </div>
      <Foot onClose={onClose} label="Close">
        <span />
      </Foot>
    </BxModal>
  );
}

/* ------------------------------------------------------------ Withdraw / Transfer */
export function SendModal({ open, onClose, wallets, selected, active, balances, kind }: Base & { kind: "withdraw" | "transfer" }) {
  const [from, setFrom] = useState(selected[0] ?? active ?? "");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [viaRelay, setViaRelay] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const s = useSubmit();
  const f = from || selected[0] || active || "";
  const b = bal(balances, wallets, f);
  const amt = Number(amount) || 0;
  const fees = TX_FEE + (viaRelay ? RELAY_FEE : 0);
  const shortOf = amt > 0 && amt + fees > b;
  return (
    <BxModal open={open} onClose={onClose} title={kind === "withdraw" ? "Withdraw" : "Transfer"} width={460}>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <BxLabel>From</BxLabel>
          <WalletSelect value={f} onChange={setFrom} wallets={wallets} balances={balances} />
        </div>
        <div>
          <BxLabel>To</BxLabel>
          {kind === "transfer" ? <WalletSelect value={to} onChange={setTo} wallets={wallets.filter((w) => w.address !== f)} balances={balances} placeholder="Destination wallet" /> : <BxInput value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="Destination address" className="font-mono" />}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <BxLabel>Amount (SOL)</BxLabel>
            <button type="button" className="mb-1.5 text-[11px] text-accent hover:underline" onClick={() => setAmount(Math.max(0, b - 0.001).toFixed(4))}>
              Max {sol(b)}
            </button>
          </div>
          <BxInput type="number" step="0.001" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
        </div>
        <label className="flex items-center justify-between gap-3 rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-xs">
          <span>
            <span className="font-medium text-text-100">Relay hop</span>
            <span className="block text-[11px] text-text-300">Funds go through a fresh relay wallet, keys never stored, two signatures.</span>
          </span>
          <BxSwitch checked={viaRelay} onChange={setViaRelay} />
        </label>
        <Summary
          rows={[
            { k: "Amount", v: `${sol(amt)} SOL` },
            { k: viaRelay ? "Network + relay fees" : "Network fee", v: `~${sol(fees, 6)} SOL` },
            { k: "Available", v: `${sol(b)} SOL`, tone: shortOf ? "bad" : undefined },
            { k: "Total", v: `${sol(amt + fees)} SOL`, tone: shortOf ? "bad" : undefined },
          ]}
          note={shortOf ? "More than the wallet holds — the server will refuse before sending." : undefined}
        />
        <Err>{s.err}</Err>
        <BxJob jobId={jobId} />
      </div>
      <Foot onClose={onClose} label={jobId ? "Close" : "Cancel"}>
        <BxButton variant="primary" disabled={!f || !to || !(amt > 0) || s.busy} onClick={() => s.run(async () => setJobId((await post<JobCreated>(`/api/fund/${kind}`, { from: f, to, sol: amount, viaRelay: viaRelay || undefined })).jobId))}>
          Send {amount || ""} SOL
        </BxButton>
      </Foot>
    </BxModal>
  );
}

/* ------------------------------------------------------------ Distribute / Disperse (privacy) */
export function DisperseModal({ open, onClose, wallets, groups, selected, active, balances, privacy }: Base & { privacy: boolean }) {
  const [from, setFrom] = useState(active ?? "");
  const [to, setTo] = useState<string[]>(selected.filter((a) => a !== active));
  const [minSol, setMin] = useState("0.1");
  const [maxSol, setMax] = useState("0.2");
  const [minDelay, setMinD] = useState("0");
  const [maxDelay, setMaxD] = useState("1000");
  const [viaRelay, setViaRelay] = useState(privacy);
  const [jobId, setJobId] = useState<string | null>(null);
  const s = useSubmit();
  const f = from || active || "";
  const b = bal(balances, wallets, f);
  const max = to.length * (Number(maxSol) || 0);
  const fees = to.length * (TX_FEE + (viaRelay ? RELAY_FEE : 0));
  const shortOf = to.length > 0 && max + fees > b;
  return (
    <BxModal open={open} onClose={onClose} title={privacy ? "Disperse" : "Distribute"} width={560}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-text-300">{privacy ? "One developer wallet funds a group of wallets with random amounts and delays, through fresh relay wallets so the group is not linked to the dev on-chain." : "One wallet sends a random amount to each target, one transfer at a time."}</p>
        <div>
          <BxLabel>From</BxLabel>
          <WalletSelect value={f} onChange={setFrom} wallets={wallets} balances={balances} />
        </div>
        <div>
          <BxLabel>To wallets — pick a group or tick wallets</BxLabel>
          <WalletPicker wallets={wallets} groups={groups} value={to} onChange={setTo} balances={balances} exclude={[f]} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <BxLabel>Min per wallet (SOL)</BxLabel>
            <BxInput type="number" step="0.01" value={minSol} onChange={(e) => setMin(e.target.value)} className="font-mono" />
          </div>
          <div>
            <BxLabel>Max per wallet (SOL)</BxLabel>
            <BxInput type="number" step="0.01" value={maxSol} onChange={(e) => setMax(e.target.value)} className="font-mono" />
          </div>
          <div>
            <BxLabel>Min delay (ms)</BxLabel>
            <BxInput type="number" value={minDelay} onChange={(e) => setMinD(e.target.value)} className="font-mono" />
          </div>
          <div>
            <BxLabel>Max delay (ms)</BxLabel>
            <BxInput type="number" value={maxDelay} onChange={(e) => setMaxD(e.target.value)} className="font-mono" />
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-xs">
          <span>
            <span className="font-medium text-text-100">Relay hop {privacy ? "(privacy)" : ""}</span>
            <span className="block text-[11px] text-text-300">Funds go through a fresh relay wallet per target, keys never stored, two signatures per target.</span>
          </span>
          <BxSwitch checked={viaRelay} onChange={setViaRelay} />
        </label>
        <Summary
          rows={[
            { k: `${to.length} target${to.length !== 1 ? "s" : ""} · worst case (all at max)`, v: `${sol(max)} SOL` },
            { k: viaRelay ? "Network + relay fees" : "Network fees", v: `~${sol(fees, 6)} SOL` },
            { k: "Available", v: `${sol(b)} SOL`, tone: shortOf ? "bad" : undefined },
            { k: "Needed at most", v: `${sol(max + fees)} SOL`, tone: shortOf ? "bad" : undefined },
          ]}
          note={shortOf ? "The source may run short — the server stops at the first refused send." : undefined}
        />
        <Err>{s.err}</Err>
        <BxJob jobId={jobId} />
      </div>
      <Foot onClose={onClose} label={jobId ? "Close" : "Cancel"}>
        <BxButton variant="primary" disabled={!f || !to.length || s.busy} onClick={() => s.run(async () => setJobId((await post<JobCreated>("/api/fund/disperse", { from: f, to, minSol, maxSol, minDelay: Number(minDelay), maxDelay: Number(maxDelay), viaRelay: viaRelay || undefined })).jobId))}>
          <Share2 className="h-3.5 w-3.5" /> {privacy ? "Disperse" : "Distribute"} to {to.length}
        </BxButton>
      </Foot>
    </BxModal>
  );
}

/* ------------------------------------------------------------ Consolidate / Reverse Disperse */
export function ConsolidateModal({ open, onClose, wallets, groups, selected, active, balances, privacy }: Base & { privacy: boolean }) {
  const [from, setFrom] = useState<string[]>(selected.filter((a) => a !== active));
  const [to, setTo] = useState(active ?? "");
  const [viaRelay, setViaRelay] = useState(privacy);
  const [jobId, setJobId] = useState<string | null>(null);
  const s = useSubmit();
  const t = to || active || "";
  const total = from.reduce((n, a) => n + bal(balances, wallets, a), 0);
  const feePer = viaRelay ? TX_FEE + 0.000005 : TX_FEE;
  return (
    <BxModal open={open} onClose={onClose} title={privacy ? "Reverse Disperse" : "Consolidate"} width={560}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-text-300">{privacy ? "A group of wallets is swept back into one wallet (each down to zero minus the fee)." : "Sweeps every selected wallet down to zero, minus the network fee, into one wallet."}</p>
        <div>
          <BxLabel>From wallets — pick a group or tick wallets</BxLabel>
          <WalletPicker wallets={wallets} groups={groups} value={from} onChange={setFrom} balances={balances} exclude={[t]} />
        </div>
        <div>
          <BxLabel>To</BxLabel>
          <WalletSelect value={t} onChange={setTo} wallets={wallets} balances={balances} />
        </div>
        {privacy ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-line-100 bg-bg-50 px-3 py-2 text-xs">
            <span>
              <span className="font-medium text-text-100">Relay hop (privacy)</span>
              <span className="block text-[11px] text-text-300">Each wallet empties itself through its own fresh relay wallet, keys never stored, two signatures per wallet.</span>
            </span>
            <BxSwitch checked={viaRelay} onChange={setViaRelay} />
          </div>
        ) : null}
        <Summary
          rows={[
            { k: `Held by ${from.length} wallet${from.length !== 1 ? "s" : ""}`, v: `${sol(total)} SOL` },
            { k: viaRelay ? "Network + relay fees" : "Network fees", v: `~${sol(from.length * feePer, 6)} SOL` },
            { k: "Arrives", v: `≈ ${sol(Math.max(0, total - from.length * feePer))} SOL`, tone: "good" },
          ]}
        />
        <Err>{s.err}</Err>
        <BxJob jobId={jobId} />
      </div>
      <Foot onClose={onClose} label={jobId ? "Close" : "Cancel"}>
        <BxButton variant="primary" disabled={!t || !from.length || s.busy} onClick={() => s.run(async () => setJobId((await post<JobCreated>("/api/fund/consolidate", { from, to: t, viaRelay: viaRelay || undefined })).jobId))}>
          {privacy ? <Undo2 className="h-3.5 w-3.5" /> : <Shuffle className="h-3.5 w-3.5" />} Sweep {from.length}
        </BxButton>
      </Foot>
    </BxModal>
  );
}

/* ------------------------------------------------------------ Airdrop (devnet only) */
export function AirdropModal({ open, onClose, wallets, selected, active, balances }: Base) {
  const [addr, setAddr] = useState(selected[0] ?? active ?? "");
  const [amount, setAmount] = useState("1");
  const [res, setRes] = useState<AirdropResponse | null>(null);
  const s = useSubmit();
  const target = addr || selected[0] || active || "";
  return (
    <BxModal open={open} onClose={onClose} title="Devnet airdrop" width={420}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-text-300">Free test SOL from the devnet faucet. The faucet often refuses (429) — the message is shown as-is.</p>
        <div>
          <BxLabel>Wallet</BxLabel>
          <WalletSelect value={target} onChange={setAddr} wallets={wallets} balances={balances} />
        </div>
        <div>
          <BxLabel>Amount (SOL)</BxLabel>
          <BxInput type="number" step="0.5" min={0} max={5} value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
        </div>
        {res ? (
          <Summary rows={[{ k: "Signature", v: short(res.signature, 6, 6) }, { k: "Confirmed", v: res.confirmed ? "yes" : "no", tone: res.confirmed ? "good" : "bad" }, { k: "Balance now", v: res.balance ? `${sol(res.balance)} SOL` : "—" }]} note={res.error ?? undefined} />
        ) : null}
        <Err>{s.err}</Err>
      </div>
      <Foot onClose={onClose} label="Close">
        <BxButton
          variant="primary"
          disabled={!target || !(Number(amount) > 0) || s.busy}
          onClick={() =>
            s.run(async () => {
              const r = await post<AirdropResponse>("/api/dev/airdrop", { wallet: target, sol: amount });
              setRes(r);
              refreshVaultDependents();
              toast(r.confirmed ? `Airdrop of ${r.sol} SOL confirmed` : (r.error ?? "Airdrop sent, not confirmed yet"), r.confirmed ? "ok" : "info");
            })
          }
        >
          <Droplet className="h-3.5 w-3.5" /> Request {amount} SOL
        </BxButton>
      </Foot>
    </BxModal>
  );
}
