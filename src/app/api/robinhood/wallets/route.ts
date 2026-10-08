import { bad, json, readBody, route } from "@/server/api";
import { rhWallets } from "@/server/robinhood/pons";
import { evmCreate, evmGroupCreate, evmGroupDelete, evmGroupRename, evmGroups, evmImport, evmMove, evmRemove, evmRename, evmSetMain } from "@/server/robinhood/wallet";

export const dynamic = "force-dynamic";

/** Robinhood wallets with ETH balance + creator fees pending, and the groups */
export const GET = route(async () => json({ wallets: await rhWallets(), groups: evmGroups() }));

/** { action: "create", count, label?, group? } · { action: "import", keys, group? } · { action: "rename", address, label }
 *  · { action: "main", address } · { action: "remove", address } · { action: "move", addresses, group | null }
 *  · { action: "group-create", name } · { action: "group-rename", id, name } · { action: "group-delete", id } */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ action?: string; count?: number; label?: string; keys?: string; address?: string; addresses?: string[]; group?: string | null; id?: string; name?: string }>(req);
  const addr = String(b.address ?? "");
  const group = b.group ? String(b.group) : null;
  switch (b.action) {
    case "create":
      return json({ created: evmCreate(Number(b.count ?? 1), b.label, group) });
    case "import":
      return json(evmImport(String(b.keys ?? ""), group));
    case "rename":
      evmRename(addr, String(b.label ?? ""));
      return json({ ok: true });
    case "main":
      evmSetMain(addr);
      return json({ ok: true });
    case "move":
      if (!Array.isArray(b.addresses) || !b.addresses.length) bad("addresses: a non-empty list.");
      evmMove(b.addresses!.map(String), group);
      return json({ ok: true });
    case "group-create":
      return json({ group: evmGroupCreate(String(b.name ?? "")) });
    case "group-rename":
      evmGroupRename(String(b.id ?? ""), String(b.name ?? ""));
      return json({ ok: true });
    case "group-delete":
      evmGroupDelete(String(b.id ?? ""));
      return json({ ok: true });
    case "remove": {
      // a wallet still holding ETH or fees is not hidden: send them out first
      const w = (await rhWallets()).find((x) => x.address.toLowerCase() === addr.toLowerCase());
      if (w && (BigInt(w.balanceWei ?? "0") > BigInt(0) || BigInt(w.escrowWei ?? "0") > BigInt(0))) bad("This wallet still holds ETH (or unclaimed fees): send them to another wallet first.");
      evmRemove(addr);
      return json({ ok: true });
    }
    default:
      return bad("action: create, import, rename, main, move, remove, group-create, group-rename or group-delete.");
  }
});
