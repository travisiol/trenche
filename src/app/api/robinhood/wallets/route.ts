import { bad, json, readBody, route } from "@/server/api";
import { rhWallets } from "@/server/robinhood/pons";
import { evmCreate, evmImport, evmRemove, evmRename, evmSetMain } from "@/server/robinhood/wallet";

export const dynamic = "force-dynamic";

/** Robinhood wallets with ETH balance + creator fees pending */
export const GET = route(async () => json({ wallets: await rhWallets() }));

/** { action: "create", count, label? } · { action: "import", keys } · { action: "rename", address, label }
 *  · { action: "main", address } · { action: "remove", address } */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ action?: string; count?: number; label?: string; keys?: string; address?: string }>(req);
  const addr = String(b.address ?? "");
  switch (b.action) {
    case "create":
      return json({ created: evmCreate(Number(b.count ?? 1), b.label) });
    case "import":
      return json(evmImport(String(b.keys ?? "")));
    case "rename":
      evmRename(addr, String(b.label ?? ""));
      return json({ ok: true });
    case "main":
      evmSetMain(addr);
      return json({ ok: true });
    case "remove": {
      // a wallet still holding ETH or fees is not hidden: send them out first
      const w = (await rhWallets()).find((x) => x.address.toLowerCase() === addr.toLowerCase());
      if (w && (BigInt(w.balanceWei ?? "0") > BigInt(0) || BigInt(w.escrowWei ?? "0") > BigInt(0))) bad("This wallet still holds ETH (or unclaimed fees): send them to another wallet first.");
      evmRemove(addr);
      return json({ ok: true });
    }
    default:
      return bad("action: create, import, rename, main or remove.");
  }
});
