"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { WalletInfo, WalletsExportResponse, JobCreated } from "@/lib/types";
import { post, failureMessage } from "@/lib/api";
import { refreshVaultDependents, walletsRes } from "@/lib/store";
import { short, sol } from "@/lib/format";
import { Button, Copy, CostLine, Field, InlineError, Input, Modal, Note, Select, Textarea, toast, cx } from "../ui";
import { JobProgress } from "../JobProgress";

export type ModalKind = "create" | "import" | "export" | "deposit" | "withdraw" | "disperse" | "consolidate" | "transfer" | "group" | "airdrop" | null;

type Base = { open: boolean; onClose: () => void; wallets: WalletInfo[]; selected: string[]; active: string | null; balances: Record<string, string | null> | null };

/** Base fee of one simple SOL transfer (5 000 lamports) — the server re-checks the real amount. */
const TX_FEE = 0.000005;

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
    <div className="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-lg border border-line p-1.5 bg-bg">
      <div className="flex gap-3 px-1.5 py-1 text-[13px]">
        <button type="button" className="text-accent hover:underline" onClick={() => onChange(wallets.map((w) => w.address))}>
          Select all
        </button>
        <button type="button" className="text-text-3 hover:underline" onClick={() => onChange([])}>
          None
        </button>
        <span className="ml-auto text-text-3 mono">{value.length} selected</span>
      </div>
      {wallets.map((w) => (
        <label key={w.address} className={cx("flex items-center gap-2.5 h-9 px-2 rounded-md cursor-pointer text-sm", value.includes(w.address) ? "bg-accent-soft" : "hover:bg-white/5")}>
          <input type="checkbox" checked={value.includes(w.address)} onChange={() => toggle(w.address)} className="accent-accent w-4 h-4" />
          <span className="truncate">{w.label || short(w.address)}</span>
          <span className="ml-auto mono text-text-3 text-[13px]">{sol(balances?.[w.address] ?? w.sol)} SOL</span>
        </label>
      ))}
      {!wallets.length ? <p className="hint p-2">No other wallet.</p> : null}
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

function Footer({ onClose, closeLabel = "Cancel", children }: { onClose: () => void; closeLabel?: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button variant="ghost" onClick={onClose}>
        {closeLabel}
      </Button>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Create */
export function CreateModal({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: { id: string; name: string }[] }) {
  const [count, setCount] = useState("5");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");
  const s = useSubmit();
  const n = Math.max(1, Math.min(100, Number(count) || 0));
  return (
    <Modal open={open} onClose={onClose} title="Create wallets" description="Fresh keypairs, generated here and encrypted into your vault." width={440}>
      <Field label="How many" hint="1 to 100. Labels get a number suffix: Bundle-1, Bundle-2…">
        <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} mono suffix="wallets" />
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
      <Footer onClose={onClose}>
        <Button
          variant="primary"
          icon="plus"
          busy={s.busy}
          disabled={!n}
          onClick={() =>
            s.run(async () => {
              await post("/api/wallets/generate", { count: n, label: label || undefined, group: group || undefined });
              refreshVaultDependents();
              toast(`${n} wallet${n > 1 ? "s" : ""} created`, "ok");
              onClose();
            })
          }
        >
          Create {n} wallet{n > 1 ? "s" : ""}
        </Button>
      </Footer>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Import */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const s = useSubmit();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (
    <Modal open={open} onClose={onClose} title="Import wallets" description="Paste private keys; they are encrypted into the vault and never leave this machine." width={540}>
      <Field label="Private keys" hint="One per line: a base58 secret or a JSON byte array. Optional label before a comma, e.g. “Dev, 5Kx…”.">
        <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} className="mono text-[13px]" placeholder={"Dev, 4NxQ…\n[12,34,…]"} spellCheck={false} />
      </Field>
      <InlineError>{s.err}</InlineError>
      <Footer onClose={onClose}>
        <Button
          variant="primary"
          icon="import"
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
          Import {lines.length || ""} key{lines.length !== 1 ? "s" : ""}
        </Button>
      </Footer>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Export */
export function ExportModal({ open, onClose, wallets, selected, active }: Base) {
  const [pass, setPass] = useState("");
  const [keys, setKeys] = useState<WalletsExportResponse["keys"] | null>(null);
  const s = useSubmit();
  const targets = selected.length ? selected : active ? [active] : [];
  const names = targets.map((a) => wallets.find((w) => w.address === a)?.label || short(a));
  const close = () => {
    setKeys(null);
    setPass("");
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={`Export ${targets.length} private key${targets.length > 1 ? "s" : ""}`} description={targets.length ? `Keys of ${names.join(", ")} will be shown in clear.` : "Select wallets in the list first; without a selection the active wallet is exported."} width={540}>
      {!keys ? (
        <>
          <Field label="Passphrase" hint="Re-enter your vault passphrase to confirm.">
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
          </Field>
          <InlineError>{s.err}</InlineError>
          <Footer onClose={close}>
            <Button variant="danger" icon="eye" busy={s.busy} disabled={!pass || !targets.length} onClick={() => s.run(async () => setKeys((await post<WalletsExportResponse>("/api/wallets/export", { addresses: targets, passphrase: pass })).keys))}>
              Reveal keys
            </Button>
          </Footer>
        </>
      ) : (
        <>
          <Note tone="warn">Anyone with these keys controls the wallets. Store them somewhere encrypted.</Note>
          <div className="flex flex-col gap-2">
            {keys.map((k) => (
              <div key={k.address} className="card p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{k.label || short(k.address)}</span>
                  <Copy text={k.secret} className="text-[13px]">
                    Copy key
                  </Copy>
                </div>
                <div className="mono text-[13px] text-text-2 break-all mt-1 select-all">{k.secret}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 items-center">
            <Copy text={keys.map((k) => `${k.label}, ${k.secret}`).join("\n")} className="text-sm">
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
    <Modal open={open} onClose={onClose} title="Deposit SOL" description="Send SOL from any wallet or exchange to this address. Solana mainnet only." width={420}>
      <Field label="Wallet">
        <WalletSelect value={target} onChange={setAddr} wallets={wallets} balances={balances} />
      </Field>
      {target ? (
        <div className="flex flex-col items-center gap-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side
            <img src={qr} alt="Deposit address QR" width={220} height={220} className="rounded-lg border border-line" />
          ) : null}
          <Copy text={target} className="text-sm break-all text-center justify-center">
            {target}
          </Copy>
          <p className="hint text-center">The balance refreshes every 5 seconds.</p>
        </div>
      ) : null}
      <Footer onClose={onClose} closeLabel="Close">
        <span />
      </Footer>
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
  const amt = Number(amount) || 0;
  const short_ = amt + TX_FEE > bal;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === "withdraw" ? "Withdraw SOL" : "Transfer between wallets"}
      description={kind === "withdraw" ? "Send SOL from one of your wallets to any Solana address." : "Move SOL from one vault wallet to another."}
      width={460}
    >
      <Field label="From">
        <WalletSelect value={f} onChange={setFrom} wallets={wallets} balances={balances} />
      </Field>
      <Field label="To">
        {kind === "transfer" ? <WalletSelect value={to} onChange={setTo} wallets={wallets.filter((w) => w.address !== f)} balances={balances} placeholder="Destination wallet" /> : <Input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="Destination address" mono />}
      </Field>
      <Field
        label="Amount"
        right={
          <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => setAmount(Math.max(0, bal - 0.001).toFixed(4))}>
            Max {sol(bal)} SOL
          </button>
        }
      >
        <Input type="number" step="0.001" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} suffix="SOL" mono />
      </Field>
      <CostLine
        rows={[
          { label: "Amount", value: `${sol(amt)} SOL` },
          { label: "Network fee", value: `~${TX_FEE} SOL` },
          { label: "Available", value: `${sol(bal)} SOL`, tone: short_ && amt > 0 ? "down" : undefined },
        ]}
        total={{ value: `${sol(amt + TX_FEE)} SOL`, tone: short_ && amt > 0 ? "down" : undefined }}
        note={short_ && amt > 0 ? "More than the wallet holds. Nothing will be sent." : undefined}
      />
      <InlineError>{s.err}</InlineError>
      {jobId ? <JobProgress jobId={jobId} /> : null}
      <Footer onClose={onClose} closeLabel={jobId ? "Close" : "Cancel"}>
        <Button
          variant="primary"
          icon={kind === "withdraw" ? "withdraw" : "transfer"}
          busy={s.busy}
          disabled={!f || !to || !(amt > 0)}
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
      </Footer>
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
  const bal = Number(balances?.[f] ?? wallets.find((w) => w.address === f)?.sol ?? 0);
  const avg = to.length * ((Number(minSol) + Number(maxSol)) / 2);
  const max = to.length * Number(maxSol);
  const fees = to.length * TX_FEE;
  const short_ = max + fees > bal;
  return (
    <Modal open={open} onClose={onClose} title="Disperse SOL" description="One wallet sends a random amount to each selected wallet, one transfer at a time." width={540}>
      <Field label="From">
        <WalletSelect value={f} onChange={setFrom} wallets={wallets} balances={balances} />
      </Field>
      <Field label="To wallets">
        <MultiPick wallets={wallets.filter((w) => w.address !== f)} value={to} onChange={setTo} balances={balances} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min per wallet">
          <Input type="number" step="0.01" value={minSol} onChange={(e) => setMin(e.target.value)} mono suffix="SOL" />
        </Field>
        <Field label="Max per wallet">
          <Input type="number" step="0.01" value={maxSol} onChange={(e) => setMax(e.target.value)} mono suffix="SOL" />
        </Field>
        <Field label="Min delay between sends">
          <Input type="number" value={minDelay} onChange={(e) => setMinD(e.target.value)} mono suffix="ms" />
        </Field>
        <Field label="Max delay between sends">
          <Input type="number" value={maxDelay} onChange={(e) => setMaxD(e.target.value)} mono suffix="ms" />
        </Field>
      </div>
      <CostLine
        rows={[
          { label: `${to.length} send${to.length !== 1 ? "s" : ""} · average`, value: `${sol(avg)} SOL` },
          { label: "Worst case (all at max)", value: `${sol(max)} SOL` },
          { label: "Network fees", value: `~${sol(fees, 6)} SOL` },
          { label: "Available", value: `${sol(bal)} SOL`, tone: short_ && to.length ? "down" : undefined },
        ]}
        total={{ label: "Needed at most", value: `${sol(max + fees)} SOL`, tone: short_ && to.length ? "down" : undefined }}
        note={short_ && to.length ? "The source may run short before the last send; the server stops at the first failure." : undefined}
      />
      <InlineError>{s.err}</InlineError>
      {jobId ? <JobProgress jobId={jobId} /> : null}
      <Footer onClose={onClose} closeLabel={jobId ? "Close" : "Cancel"}>
        <Button variant="primary" icon="disperse" busy={s.busy} disabled={!f || !to.length} onClick={() => s.run(async () => setJobId((await post<JobCreated>("/api/fund/disperse", { from: f, to, minSol, maxSol, minDelay: Number(minDelay), maxDelay: Number(maxDelay) })).jobId))}>
          Disperse to {to.length} wallet{to.length !== 1 ? "s" : ""}
        </Button>
      </Footer>
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
    <Modal open={open} onClose={onClose} title="Consolidate SOL" description="Sweeps every selected wallet down to zero (minus the network fee) into one wallet." width={540}>
      <Field label="From wallets">
        <MultiPick wallets={wallets.filter((w) => w.address !== t)} value={from} onChange={setFrom} balances={balances} />
      </Field>
      <Field label="To">
        <WalletSelect value={t} onChange={setTo} wallets={wallets} balances={balances} />
      </Field>
      <CostLine
        rows={[
          { label: `Held by ${from.length} wallet${from.length !== 1 ? "s" : ""}`, value: `${sol(total)} SOL` },
          { label: "Network fees", value: `~${sol(from.length * TX_FEE, 6)} SOL` },
        ]}
        total={{ label: "Arrives", value: `≈ ${sol(Math.max(0, total - from.length * TX_FEE))} SOL` }}
      />
      <InlineError>{s.err}</InlineError>
      {jobId ? <JobProgress jobId={jobId} /> : null}
      <Footer onClose={onClose} closeLabel={jobId ? "Close" : "Cancel"}>
        <Button variant="primary" icon="consolidate" busy={s.busy} disabled={!t || !from.length} onClick={() => s.run(async () => setJobId((await post<JobCreated>("/api/fund/consolidate", { from, to: t })).jobId))}>
          Sweep {from.length} wallet{from.length !== 1 ? "s" : ""}
        </Button>
      </Footer>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Group */
export function GroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const s = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title="New group" description="A named set of wallets you can pick in one click as buyers, snipers or volume wallets." width={400}>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bundle A" />
      </Field>
      <InlineError>{s.err}</InlineError>
      <Footer onClose={onClose}>
        <Button
          variant="primary"
          icon="plus"
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
      </Footer>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Airdrop (devnet only) */
export function AirdropModal({ open, onClose, wallets, selected, active, balances }: Base) {
  const [addr, setAddr] = useState(selected[0] ?? active ?? "");
  const [amount, setAmount] = useState("1");
  const s = useSubmit();
  const target = addr || selected[0] || active || "";
  return (
    <Modal open={open} onClose={onClose} title="Request a devnet airdrop" description="Free test SOL from the devnet faucet. Only available while the cluster is set to devnet in Settings." width={420}>
      <Field label="Wallet">
        <WalletSelect value={target} onChange={setAddr} wallets={wallets} balances={balances} />
      </Field>
      <Field label="Amount" hint="The faucet usually allows up to 2 SOL per request.">
        <Input type="number" step="0.5" min={0} max={5} value={amount} onChange={(e) => setAmount(e.target.value)} mono suffix="SOL" />
      </Field>
      <InlineError>{s.err}</InlineError>
      <Footer onClose={onClose}>
        <Button
          variant="primary"
          icon="drop"
          busy={s.busy}
          disabled={!target || !(Number(amount) > 0)}
          onClick={() =>
            s.run(async () => {
              await post("/api/dev/airdrop", { address: target, sol: amount });
              refreshVaultDependents();
              toast(`Airdrop of ${amount} SOL requested`, "ok");
              onClose();
            })
          }
        >
          Request {amount} SOL
        </Button>
      </Footer>
    </Modal>
  );
}
