"use client";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Button, Card, Empty, Loading, Page, PageHeader, Segmented, StatCard, Tabs, cx, toast } from "@/components/ui";
import { GroupChip, WalletList } from "@/components/portfolio/WalletList";
import { AirdropModal, ConsolidateModal, CreateModal, DepositModal, DisperseModal, ExportModal, GroupModal, ImportModal, SendModal, type ModalKind } from "@/components/portfolio/WalletModals";
import { Activity, Holdings, usePositions } from "@/components/portfolio/Holdings";
import { useBalances, useSettings, useSolPrice, useVault, useWallets, walletsRes } from "@/lib/store";
import { del, failureMessage, useGet } from "@/lib/api";
import { signedSol, sol, usd } from "@/lib/format";
import type { IconKind } from "@/components/icons";
import type { DashboardResponse, Settings } from "@/lib/types";

type Period = "24h" | "7d" | "30d" | "all";
/** `cluster` is read defensively until the server contract ships it. */
type SettingsX = Settings & { cluster?: "mainnet" | "devnet" };

const ACTIONS: { kind: Exclude<ModalKind, null | "group" | "airdrop">; label: string; icon: IconKind; needs: "sign" | "wallet" | "two" }[] = [
  { kind: "import", label: "Import", icon: "import", needs: "sign" },
  { kind: "export", label: "Export", icon: "export", needs: "sign" },
  { kind: "deposit", label: "Deposit", icon: "qr", needs: "wallet" },
  { kind: "withdraw", label: "Withdraw", icon: "withdraw", needs: "sign" },
  { kind: "disperse", label: "Disperse", icon: "disperse", needs: "two" },
  { kind: "consolidate", label: "Consolidate", icon: "consolidate", needs: "two" },
  { kind: "transfer", label: "Transfer", icon: "transfer", needs: "two" },
];

export default function PortfolioPage() {
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const price = useSolPrice();
  const settings = useSettings();
  const [modal, setModal] = useState<ModalKind>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unit, setUnit] = useState<"USD" | "SOL">("USD");
  const [period, setPeriod] = useState<Period>("24h");
  const [bottom, setBottom] = useState<"holdings" | "activity">("holdings");
  const [showArchived, setShowArchived] = useState(false);

  const canSign = vault.data?.unlocked ?? false;
  const all = wallets.data?.wallets ?? [];
  const live = all.filter((w) => !w.archived);
  const archived = all.filter((w) => w.archived);
  const groups = wallets.data?.groups ?? [];
  const active = wallets.data?.active ?? null;
  const bal = balances.data ?? null;
  const totalSol = live.reduce((n, w) => n + Number(bal?.[w.address] ?? w.sol ?? 0), 0);
  const positions = usePositions(live.map((w) => w.address));
  const held = (positions.data ?? []).filter((p) => Number(p.amount) > 0);
  const posSol = held.reduce((n, p) => n + Number(p.valueSol), 0);
  const openPnl = (positions.data ?? []).reduce((n, p) => n + Number(p.pnlSol), 0);
  const dash = useGet<DashboardResponse>(live.length ? "/api/dashboard" : null, 30000);
  const win = dash.data?.pnl[period] ?? null;
  const winSol = win ? Number(win.realisedSol) : null;
  const solUsd = price.data?.usd ?? null;
  const show = (s: number) => (unit === "SOL" || !solUsd ? `${sol(s)} SOL` : usd(s * solUsd, 2));
  const showSigned = (s: number) => (unit === "SOL" || !solUsd ? `${signedSol(s)} SOL` : `${s > 0 ? "+" : ""}${usd(s * solUsd, 2)}`);
  const cluster = (settings.data as SettingsX | null)?.cluster;

  const select = (addr: string, multi: boolean) =>
    setSelected((s) => {
      const n = multi ? new Set(s) : new Set<string>();
      if (s.has(addr) && (multi || s.size === 1)) n.delete(addr);
      else n.add(addr);
      return n;
    });
  const sel = [...selected];
  const base = { wallets: live, selected: sel, active, balances: bal };
  const enabled = (needs: "sign" | "wallet" | "two") => (needs === "sign" ? canSign && live.length > 0 : needs === "wallet" ? live.length > 0 : canSign && live.length > 1);

  return (
    <Page>
      <PageHeader
        icon={<Icon3D name="portfolio" size={40} glow />}
        title="Portfolio"
        description="Your developer wallets, their SOL and the tokens they hold. Keys never leave this machine."
        actions={
          <>
            <Segmented value={unit} onChange={setUnit} options={[{ value: "USD", label: "USD" }, { value: "SOL", label: "SOL" }]} />
            <Button variant="primary" icon="plus" onClick={() => setModal("create")} disabled={!canSign} title={canSign ? undefined : "Unlock the vault first"}>
              Create wallets
            </Button>
          </>
        }
      />

      {/* stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total balance" value={show(totalSol)} sub={unit === "USD" && solUsd ? `${sol(totalSol)} SOL across ${live.length} wallet${live.length !== 1 ? "s" : ""}` : `${live.length} wallet${live.length !== 1 ? "s" : ""}`} />
        <StatCard label="Positions value" value={show(posSol)} sub={positions.error ? "Positions unavailable" : `${held.length} token${held.length !== 1 ? "s" : ""} held`} />
        <StatCard label="Open PnL" value={showSigned(openPnl)} tone={openPnl > 0 ? "up" : openPnl < 0 ? "down" : undefined} sub="Unrealised, on what you still hold" />
        <StatCard
          label="Realised PnL"
          value={winSol === null ? "—" : showSigned(winSol)}
          tone={winSol !== null && winSol > 0 ? "up" : winSol !== null && winSol < 0 ? "down" : undefined}
          sub={dash.error ? failureMessage(dash.error) : win ? `${win.trades} trades · bought ${sol(win.buysSol)} · sold ${sol(win.sellsSol)} SOL` : live.length ? "Loading…" : "No wallet yet"}
          right={<Segmented size="xs" value={period} onChange={setPeriod} options={(["24h", "7d", "30d", "all"] as Period[]).map((p) => ({ value: p, label: p }))} />}
        />
      </div>

      {/* toolbar */}
      <div className="panel px-4 py-3 flex flex-wrap items-center gap-2">
        {ACTIONS.map((a) => (
          <Button key={a.kind} size="sm" icon={a.icon} onClick={() => setModal(a.kind)} disabled={!enabled(a.needs)} title={!enabled(a.needs) ? (a.needs === "two" ? "Needs the vault unlocked and at least two wallets" : a.needs === "sign" ? "Needs the vault unlocked" : "Create a wallet first") : undefined}>
            {a.label}
            {a.kind === "export" && sel.length ? ` (${sel.length})` : ""}
          </Button>
        ))}
        {cluster === "devnet" ? (
          <Button size="sm" icon="drop" variant="auto" onClick={() => setModal("airdrop")} disabled={!live.length}>
            Airdrop
          </Button>
        ) : null}
        <span className="ml-auto hint">
          {sel.length ? (
            <>
              {sel.length} selected ·{" "}
              <button className="text-accent hover:underline" onClick={() => setSelected(new Set())}>
                clear
              </button>
            </>
          ) : (
            <span className="hidden md:inline">Click a wallet to select it, Ctrl-click for several.</span>
          )}
        </span>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[440px_1fr] gap-4 min-h-0">
        {/* ------------------------------------------------ left: wallets */}
        <div className="flex flex-col gap-4 min-h-0">
          <Card
            title="Wallets"
            description={`${live.length} active${archived.length ? ` · ${archived.length} archived` : ""}. Drag to reorder, click a name to rename.`}
            icon={<Icon3D name="portfolio" size={24} />}
            actions={
              <Button size="sm" icon="plus" onClick={() => setModal("group")}>
                Group
              </Button>
            }
            flush
            bodyClassName="p-3 gap-3"
          >
            {wallets.error ? (
              <ApiError error={wallets.error} retry={wallets.refresh} />
            ) : wallets.loading && !wallets.data ? (
              <Loading>Loading wallets…</Loading>
            ) : !live.length ? (
              <Empty
                icon={<Icon3D name="portfolio" size={56} />}
                title="No wallet yet"
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" icon="plus" onClick={() => setModal("create")} disabled={!canSign}>
                      Create wallets
                    </Button>
                    <Button size="sm" icon="import" onClick={() => setModal("import")} disabled={!canSign}>
                      Import keys
                    </Button>
                  </div>
                }
              >
                Generate fresh keypairs or import existing keys. Everything is encrypted into your local vault.
              </Empty>
            ) : (
              <WalletList wallets={live} groups={groups} active={active} balances={bal} selected={selected} onSelect={select} canSign={canSign} />
            )}

            {groups.length || live.length ? (
              <div className="flex flex-col gap-2 pt-3 border-t border-line">
                <div className="flex items-center gap-2">
                  <span className="label">Groups</span>
                  <span className="hint">Pick a group as a set of wallets when launching.</span>
                </div>
                {!groups.length ? (
                  <p className="hint">No group yet. Create one, then assign wallets from their ··· menu.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {groups.map((g) => (
                      <GroupChip
                        key={g.id}
                        g={g}
                        count={live.filter((w) => w.group === g.id).length}
                        onRemove={() =>
                          del(`/api/groups/${g.id}`)
                            .then(() => walletsRes.refresh())
                            .catch((e) => toast(failureMessage(e), "err"))
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {archived.length ? (
              <div className="pt-3 border-t border-line flex flex-col gap-2">
                <button className="flex items-center gap-2 text-sm text-text-2 hover:text-text" onClick={() => setShowArchived((s) => !s)}>
                  <span className={cx("transition-transform", showArchived ? "rotate-90" : "")}>▸</span>
                  Archived wallets <span className="mono text-text-3">{archived.length}</span>
                </button>
                {showArchived ? <WalletList wallets={archived} groups={groups} active={active} balances={bal} selected={selected} onSelect={select} canSign={canSign} /> : null}
              </div>
            ) : null}
          </Card>
        </div>

        {/* ------------------------------------------------ right: holdings / activity */}
        <Card className="min-h-[360px]" flush>
          <Tabs
            value={bottom}
            onChange={setBottom}
            tabs={[
              { value: "holdings", label: "Holdings", count: held.length || undefined },
              { value: "activity", label: "Activity" },
            ]}
          />
          <div className="flex-1 overflow-auto">{bottom === "holdings" ? <Holdings wallets={live.map((w) => w.address)} /> : <Activity />}</div>
        </Card>
      </div>

      <CreateModal open={modal === "create"} onClose={() => setModal(null)} groups={groups} />
      <ImportModal open={modal === "import"} onClose={() => setModal(null)} />
      <GroupModal open={modal === "group"} onClose={() => setModal(null)} />
      {modal === "export" ? <ExportModal open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "deposit" ? <DepositModal open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "withdraw" ? <SendModal kind="withdraw" open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "transfer" ? <SendModal kind="transfer" open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "disperse" ? <DisperseModal open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "consolidate" ? <ConsolidateModal open onClose={() => setModal(null)} {...base} /> : null}
      {modal === "airdrop" ? <AirdropModal open onClose={() => setModal(null)} {...base} /> : null}
    </Page>
  );
}
