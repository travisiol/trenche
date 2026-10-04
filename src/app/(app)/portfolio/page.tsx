"use client";
import { useState } from "react";
import { Icon3D } from "@/components/Icon3D";
import { ApiError, Button, Empty, Panel, Segmented, Spinner, Stat, Tabs, cx, toast } from "@/components/ui";
import { GroupChip, WalletList } from "@/components/portfolio/WalletList";
import { ConsolidateModal, CreateModal, DepositModal, DisperseModal, ExportModal, GroupModal, ImportModal, SendModal, type ModalKind } from "@/components/portfolio/WalletModals";
import { Activity, Holdings, usePositions } from "@/components/portfolio/Holdings";
import { useBalances, useSolPrice, useVault, useWallets, walletsRes } from "@/lib/store";
import { del, failureMessage, useGet } from "@/lib/api";
import { signedSol, sol, usd } from "@/lib/format";

import type { DashboardResponse } from "@/lib/ui-types";

type Period = "24h" | "7d" | "30d" | "all";

export default function PortfolioPage() {
  const vault = useVault();
  const wallets = useWallets();
  const balances = useBalances();
  const price = useSolPrice();
  const [modal, setModal] = useState<ModalKind>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unit, setUnit] = useState<"USD" | "SOL">("USD");
  const [period, setPeriod] = useState<Period>("24h");
  const [bottom, setBottom] = useState<"holdings" | "activity">("holdings");

  const canSign = vault.data?.unlocked ?? false;
  const all = wallets.data?.wallets ?? [];
  const live = all.filter((w) => !w.archived);
  const archived = all.filter((w) => w.archived);
  const groups = wallets.data?.groups ?? [];
  const active = wallets.data?.active ?? null;
  const bal = balances.data ?? null;
  const totalSol = live.reduce((n, w) => n + Number(bal?.[w.address] ?? w.sol ?? 0), 0);
  const positions = usePositions(live.map((w) => w.address));
  const posSol = (positions.data ?? []).reduce((n, p) => n + Number(p.valueSol), 0);
  const openPnl = (positions.data ?? []).reduce((n, p) => n + Number(p.pnlSol), 0);
  const dash = useGet<DashboardResponse>(live.length ? "/api/dashboard" : null, 30000);
  const win = dash.data?.pnl[period] ?? null;
  const winSol = win ? Number(win.realisedSol) : null;
  const solUsd = price.data?.usd ?? null;
  const show = (s: number) => (unit === "SOL" || !solUsd ? `${sol(s)} SOL` : usd(s * solUsd, 2));

  const select = (addr: string, multi: boolean) =>
    setSelected((s) => {
      const n = multi ? new Set(s) : new Set<string>();
      if (s.has(addr) && (multi || s.size === 1)) n.delete(addr);
      else n.add(addr);
      return n;
    });
  const sel = [...selected];
  const base = { wallets: live, selected: sel, active, balances: bal };

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 p-4 min-h-0">
      {/* ------------------------------------------------ left: wallets */}
      <div className="flex flex-col gap-4 min-h-0">
        <Panel
          title="Developer wallets"
          icon={<Icon3D name="portfolio" size={22} />}
          actions={
            <>
              <span className="mono text-[11px] text-text-3">{live.length}</span>
              <Button size="xs" variant="primary" onClick={() => setModal("create")} disabled={!canSign}>
                + Create
              </Button>
            </>
          }
          bodyClassName="p-2 overflow-y-auto max-h-[52vh]"
        >
          {wallets.error ? (
            <ApiError error={wallets.error} retry={wallets.refresh} />
          ) : wallets.loading && !wallets.data ? (
            <div className="flex items-center gap-2 text-xs text-text-3 p-3">
              <Spinner size={14} /> Loading wallets…
            </div>
          ) : !live.length ? (
            <Empty
              icon={<Icon3D name="portfolio" size={48} />}
              title="No wallet yet"
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => setModal("create")} disabled={!canSign}>
                    Create wallets
                  </Button>
                  <Button size="sm" onClick={() => setModal("import")} disabled={!canSign}>
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
        </Panel>

        <Panel
          title="Groups"
          actions={
            <Button size="xs" onClick={() => setModal("group")}>
              + Group
            </Button>
          }
          bodyClassName="p-2 flex flex-col gap-1.5"
        >
          {!groups.length ? (
            <p className="text-[11px] text-text-3 px-2 py-2">Group wallets to pick them as a set when launching (bundle, snipers, volume). Use a wallet&apos;s menu to assign it.</p>
          ) : (
            groups.map((g) => (
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
            ))
          )}
        </Panel>

        {archived.length ? (
          <Panel title="Archived" actions={<span className="mono text-[11px] text-text-3">{archived.length}</span>} bodyClassName="p-2 max-h-48 overflow-y-auto">
            <WalletList wallets={archived} groups={groups} active={active} balances={bal} selected={selected} onSelect={select} canSign={canSign} />
          </Panel>
        ) : null}
      </div>

      {/* ------------------------------------------------ right */}
      <div className="flex flex-col gap-4 min-h-0">
        <Panel glow bodyClassName="p-5">
          <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
            <Stat big label="Total balance" value={show(totalSol)} sub={unit === "USD" && solUsd ? `${sol(totalSol)} SOL · ${live.length} wallets` : solUsd ? usd(totalSol * solUsd, 2) : `${live.length} wallets`} />
            <Stat big label="Positions" value={show(posSol)} sub={positions.error ? "positions unavailable" : `${(positions.data ?? []).filter((p) => Number(p.amount) > 0).length} tokens`} />
            <Stat big label="Open PnL" value={signedSol(openPnl) + (unit === "SOL" || !solUsd ? " SOL" : "")} sub={unit === "USD" && solUsd ? usd(openPnl * solUsd, 2) : undefined} tone={openPnl > 0 ? "up" : openPnl < 0 ? "down" : undefined} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="label">PnL</span>
                <Segmented size="xs" value={period} onChange={setPeriod} options={(["24h", "7d", "30d", "all"] as Period[]).map((p) => ({ value: p, label: p }))} />
              </div>
              <div className={cx("num text-2xl font-semibold tracking-tight", winSol !== null && winSol > 0 ? "text-up" : winSol !== null && winSol < 0 ? "text-down" : "")}>
                {winSol === null ? "—" : unit === "USD" && solUsd ? usd(winSol * solUsd, 2) : `${signedSol(winSol)} SOL`}
              </div>
              <div className="text-[11px] text-text-3 mt-0.5 truncate max-w-[30ch]" title={dash.error ? failureMessage(dash.error) : "Realised from this app's journal: sells − buys"}>
                {dash.error ? failureMessage(dash.error) : win ? `${win.trades} trades · bought ${sol(win.buysSol)} · sold ${sol(win.sellsSol)}` : live.length ? "loading…" : "no wallet"}
              </div>
            </div>
            <div className="ml-auto">
              <Segmented value={unit} onChange={setUnit} options={[{ value: "USD", label: "USD" }, { value: "SOL", label: "SOL" }]} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-line">
            <Button variant="primary" onClick={() => setModal("create")} disabled={!canSign}>
              Create
            </Button>
            <Button onClick={() => setModal("import")} disabled={!canSign}>
              Import
            </Button>
            <Button onClick={() => setModal("export")} disabled={!canSign || !live.length}>
              Export{sel.length ? ` (${sel.length})` : ""}
            </Button>
            <Button onClick={() => setModal("deposit")} disabled={!live.length}>
              Deposit
            </Button>
            <Button onClick={() => setModal("withdraw")} disabled={!canSign || !live.length}>
              Withdraw
            </Button>
            <Button onClick={() => setModal("disperse")} disabled={!canSign || live.length < 2}>
              Disperse
            </Button>
            <Button onClick={() => setModal("consolidate")} disabled={!canSign || live.length < 2}>
              Consolidate
            </Button>
            <Button onClick={() => setModal("transfer")} disabled={!canSign || live.length < 2}>
              Transfer
            </Button>
            {sel.length ? (
              <span className="ml-auto self-center text-[11px] text-text-3">
                {sel.length} selected · <button className="text-accent" onClick={() => setSelected(new Set())}>clear</button>
              </span>
            ) : (
              <span className="ml-auto self-center text-[11px] text-text-3 hidden xl:inline">Click a wallet to select, Ctrl-click for several.</span>
            )}
          </div>
        </Panel>

        <Panel className="flex-1 min-h-[320px]" bodyClassName="p-0 flex flex-col min-h-0">
          <Tabs
            value={bottom}
            onChange={setBottom}
            tabs={[
              { value: "holdings", label: "Holdings", count: (positions.data ?? []).filter((p) => Number(p.amount) > 0).length || undefined },
              { value: "activity", label: "Activity" },
            ]}
          />
          <div className="flex-1 overflow-y-auto">{bottom === "holdings" ? <Holdings wallets={live.map((w) => w.address)} /> : <Activity />}</div>
        </Panel>
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
    </div>
  );
}
