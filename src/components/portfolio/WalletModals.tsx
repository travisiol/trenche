"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { WalletInfo, WalletsExportResponse, JobCreated } from "@/lib/types";
import { post, failureMessage } from "@/lib/api";
import { refreshVaultDependents, walletsRes } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { Button, Copy, Field, InlineError, Input, Modal, Select, Textarea, toast, cx } from "../ui";
import { JobProgress } from "../JobProgress";

export type ModalKind = "create" | "import" | "export" | "deposit" | "withdraw" | "disperse" | "consolidate" | "transfer" | "group" | null;

type Base = { open: boolean; onClose: () => void; wallets: WalletInfo[]; selected: string[]; active: string | null; balances: Record<string, string | null> | null };

function WalletSelect({ value, onChange, wallets, balances, placeholder = "Choose a wallet" }: { value: string; onChange: (v: string) => void; wallets: WalletInfo[]; balances: Base["balances"]; placeholder?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {wallets.map((w) => (
        <option key={w.address} value={w.address}>
          {w.label || short(w.address)} — {sol(balances?.[w.address] ?? w.sol)} SOL
        </option>
      ))}
    </Select>
  );
}

function MultiPick({ wallets, value, onChange, balances }: { wallets: WalletInfo[]; value: string[]; onChange: (v: string[]) => void; balances: Base["balances"] }) {
  const toggle = (a: string) => onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  return (
    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg border border-line p-1 bg-bg">
      <div className="flex gap-2 px-1 py-1 text-[11px]">
        <button type="button" className="text-accent" onClick={() => onChange(wallets.map((w) => w.address))}>
          All
        </button>
        <button type="button" className="text-text-3" onClick={() => onChange([])}>
          None
        </button>
        <span className="ml-auto text-text-3 mono">{value.length} selected</span>
      </div>
      {wallets.map((w) => (
        <label key={w.address} className={cx("flex items-center gap-2 h-8 px-2 rounded-md cursor-pointer text-xs", value.includes(w.address) ? "bg-accent-soft" : "hover:bg-white/5")}>
          <input type="checkbox" checked={value.includes(w.address)} onChange={() => toggle(w.address)} className="accent-accent" />
          <span className="truncate">{w.label || short(w.address)}</span>
          <span className="ml-auto mono text-text-3">{sol(balances?.[w.address] ?? w.sol)}</span>
        </label>
      ))}
    </div>
  );
}

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

/* ---------------------------------------------------------------- Create */
export function CreateModal({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: { id: string; name: string }[] }) {
  const [count, setCount] = useState("5");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");
  const s = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title="Create wallets" width={420}>
      <Field label="How many" hint="Keypairs are generated and encrypted into the vault. Labels get a number suffix.">
        <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} mono />
      </Field>
      <Field label="Label prefix (optional)">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bundle" />
      </Field>
      <Field label="Group (optional)">
        <Select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <InlineError>{s.err}</InlineError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          busy={s.busy}
          onClick={() =>
            s.run(async () => {
              await post("/api/wallets/generate", { count: Number(count), label: label || undefined, group: group || undefined });
              refreshVaultDependents();
              toast(`${count} wallet(s) created`, "ok");
              onClose();
            })
          }
        >
          Create {count} wallet{Number(count) > 1 ? "s" : ""}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Import */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const s = useSubmit();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (
    <Modal open={open} onClose={onClose} title="Import wallets" width={520}>
      <Field label="Private keys" hint="One per line: base58 secret or JSON byte array. Optional label before a comma: `Dev, 5Kx…`. Keys are encrypted into the vault and never leave this machine.">
        <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} className="mono text-xs" placeholder={"Dev, 4NxQ…\n[12,34,…]"} spellCheck={false} />
      </Field>
      <InlineError>{s.err}</InlineError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          busy={s.busy}
          disabled={!lines.length}
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
          Import {lines.length || ""}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Export */
export function ExportModal({ open, onClose, wallets, selected, active }: Base) {
  const [pass, setPass] = useState("");
  const [keys, setKeys] = useState<WalletsExportResponse["keys"] | null>(null);
  const s = useSubmit();
  const targets = selected.length ? selected : active ? [active] : [];
  const close = () => {
    setKeys(null);
    setPass("");
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={`Export ${targets.length} key${targets.length > 1 ? "s" : ""}`} width={520}>
      {!keys ? (
        <>
          <p className="text-xs text-text-2">
            Private keys of {targets.length ? targets.map((a) => wallets.find((w) => w.address === a)?.label || short(a)).join(", ") : "— select wallets first"} will be shown in clear. Re-enter the passphrase to confirm.
          </p>
          <Field label="Passphrase">
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
          </Field>
          <InlineError>{s.err}</InlineError>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" busy={s.busy} disabled={!pass || !targets.length} onClick={() => s.run(async () => setKeys((await post<WalletsExportResponse>("/api/wallets/export", { addresses: targets, passphrase: pass })).keys))}>
              Reveal keys
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {keys.map((k) => (
              <div key={k.address} className="card p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{k.label || short(k.address)}</span>
                  <Copy text={k.secret}>copy key</Copy>
                </div>
                <div className="mono text-[11px] text-text-2 break-all mt-1 select-all">{k.secret}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Copy text={keys.map((k) => `${k.label}, ${k.secret}`).join("\n")} className="text-xs">
              Copy all
            </Copy>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------- Deposit */
export function DepositModal({ open, onClose, wallets, selected, active, balances }: Base) {
  const [addr, setAddr] = useState(selected[0] ?? active ?? "");
  const [qr, setQr] = useState<string | null>(null);
  const target = addr || selected[0] || active || "";
  useEffect(() => {
    if (!open || !target) return;
    let alive = true;
    QRCode.toDataURL(target, { margin: 1, width: 220, color: { dark: "#fcfcfc", light: "#0e1116" } }).then((u) => alive && setQr(u));
    return () => {
      alive = false;
    };
  }, [open, target]);
  return (
    <Modal open={open} onClose={onClose} title="Deposit SOL" width={400}>
      <Field label="Wallet">
        <WalletSelect value={target} onChange={setAddr} wallets={wallets} balances={balances} />
      </Field>
      {target ? (
        <div className="flex flex-col items-center gap-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side
            <img src={qr} alt="Deposit address QR" width={220} height={220} className="rounded-lg border border-line" />
          ) : null}
          <Copy text={target} className="text-xs break-all text-center">
            {target}
          </Copy>
          <p className="text-[11px] text-text-3 text-center">Solana mainnet. Balance refreshes every 5 s.</p>
        </div>
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------- Withdraw / Transfer */
export function SendModal({ open, onClose, wallets, selected, active, balances, kind }: Base & { kind: "withdraw" | "transfer" }) {
  const [from, setFrom] = useState(selected[0] ?? active ?? "");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const s = useSubmit();
  const f = from || selected[0] || active || "";
  const bal = Number(balances?.[f] ?? wallets.find((w) => w.address === f)?.sol ?? 0);
  return (
    <Modal open={open} onClose={onClose} title={kind === "withdraw" ? "Withdraw SOL" : "Transfer between wallets"} width={440}>
      <Field label="From">
        <WalletSelect value={f} onChange={setFrom} wallets={wallets} balances={balances} />
      </Field>
      <Field label="To">
        {kind === "transfer" ? <WalletSelect value={to} onChange={setTo} wallets={wallets.filter((w) => w.address !== f)} balances={balances} placeholder="Destination wallet" /> : <Input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="Destination address" mono />}
      </Field>
      <Field
        label="Amount"
        right={
          <button type="button" className="text-[11px] text-accent" onClick={() => setAmount(Math.max(0, bal - 0.001).toFixed(4))}>
            Max {sol(bal)}
          </button>
        }
      >
        <Input type="number" step="0.001" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} suffix="SOL" mono />
      </Field>
      <InlineError>{s.err}</InlineError>
      {jobId ? <JobProgress jobId={jobId} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          busy={s.busy}
          disabled={!f || !to || !(Number(amount) > 0)}
          onClick={() =>
            s.run(async () => {
              const r = await post<JobCreated>(`/api/fund/${kind}`, { from: f, to, sol: amount });
              setJobId(r.jobId);
              toast("Transfer sent", "info");
            })
          }
        >
          Send {amount || ""} SOL
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- Disperse */
export function DisperseModal({ open, onClose, wallets, selected, active, balances }: Base) {
  const [from, setFrom] = useState(active ?? "");
  const [to, setTo] = useState<string[]>(selected.filter((a) => a !== active));
  const [minSol, setMin] = useState("0.1");
  const [maxSol, setMax] = useState("0.2");
  const [minDelay, setMinD] = useState("0");
  const [maxDelay, setMaxD] = useState("1000");
  const [jobId, setJobId] = useState<string | null>(null);
  const s = useSubmit();
  const f = from || active || "";
  const est = to.length * ((Number(minSol) + Number(maxSol)) / 2);
  return (
    <Modal open={open} onClose={onClose} title="Disperse SOL" width={520}>
      <Field label="From">
        <WalletSelect value={f} onChange={setFrom} wallets={wallets} balances={balances} />
      </Field>
      <Field label="To wallets">
        <MultiPick wallets={wallets.filter((w) => w.address !== f)} value={to} onChange={setTo} balances={balances} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min SOL each">
          <Input type="number" step="0.01" value={minSol} onChange={(e) => setMin(e.target.value)} mono suffix="SOL" />
        </Field>
        <Field label="Max SOL each">
          <Input type="number" step="0.01" value={maxSol} onChange={(e) => setMax(e.target.value)} mono suffix="SOL" />
        </Field>
        <Field label="Min delay">
          <Input type="number" value={minDelay} onChange={(e) => setMinD(e.target.value)} mono suffix="ms" />
        </Field>
        <Field label="Max delay">
          <Input type="number" value={maxDelay} onChange={(e) => setMaxD(e.target.value)} mono suffix="ms" />
        </Field>
      </div>
      <p className="text-[11px] text-text-3">
        About <span className="mono text-text-2">{sol(est)} SOL</span> will leave {f ? wallets.find((w) => w.address === f)?.label || short(f) : "the source"} across {to.length} sends. Each amount is random between min and max.
      </p>
      <InlineError>{s.err}</InlineError>
      {jobId ? <JobProgress jobId={jobId} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" busy={s.busy} disabled={!f || !to.length} onClick={() => s.run(async () => setJobId((await post<JobCreated>("/api/fund/disperse", { from: f, to, minSol, maxSol, minDelay: Number(minDelay), maxDelay: Number(maxDelay) })).jobId))}>
          Disperse to {to.length}
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ Consolidate */
export function ConsolidateModal({ open, onClose, wallets, selected, active, balances }: Base) {
  const [from, setFrom] = useState<string[]>(selected.filter((a) => a !== active));
  const [to, setTo] = useState(active ?? "");
  const [jobId, setJobId] = useState<string | null>(null);
  const s = useSubmit();
  const t = to || active || "";
  const total = from.reduce((n, a) => n + Number(balances?.[a] ?? wallets.find((w) => w.address === a)?.sol ?? 0), 0);
  return (
    <Modal open={open} onClose={onClose} title="Consolidate SOL" width={520}>
      <Field label="From wallets (swept to the last lamport minus fee)">
        <MultiPick wallets={wallets.filter((w) => w.address !== t)} value={from} onChange={setFrom} balances={balances} />
      </Field>
      <Field label="To">
        <WalletSelect value={t} onChange={setTo} wallets={wallets} balances={balances} />
      </Field>
      <p className="text-[11px] text-text-3">
        About <span className="mono text-text-2">{sol(total)} SOL</span> from {from.length} wallet{from.length > 1 ? "s" : ""}.
      </p>
      <InlineError>{s.err}</InlineError>
      {jobId ? <JobProgress jobId={jobId} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" busy={s.busy} disabled={!t || !from.length} onClick={() => s.run(async () => setJobId((await post<JobCreated>("/api/fund/consolidate", { from, to: t })).jobId))}>
          Sweep {from.length} wallet{from.length > 1 ? "s" : ""}
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Group */
export function GroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const s = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title="New group" width={380}>
      <Field label="Name" hint="Groups are selectable as buyers, snipers or volume wallets on the Launch page.">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bundle A" />
      </Field>
      <InlineError>{s.err}</InlineError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          busy={s.busy}
          disabled={!name.trim()}
          onClick={() =>
            s.run(async () => {
              await post("/api/groups", { name: name.trim() });
              walletsRes.refresh();
              setName("");
              onClose();
            })
          }
        >
          Create group
        </Button>
      </div>
    </Modal>
  );
}
