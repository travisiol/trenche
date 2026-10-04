import { bad, json, readBody, route } from "@/server/api";
import { balances, importWallets, walletsResponse } from "@/server/wallets";
import type { WalletsImportRequest, WalletsImportResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST {lines[] (one key per line or comma-separated, ≤ 50), prefix? ("Imported")} → wallets + added/errors */
export const POST = route(async (req: Request) => {
  const body = await readBody<WalletsImportRequest>(req);
  if (!Array.isArray(body.lines) || body.lines.length === 0) bad("lines: a non-empty array of strings is required.");
  const r = importWallets(body.lines.map((l) => String(l)), body.prefix ? String(body.prefix) : undefined);
  await balances(true).catch(() => null);
  const res: WalletsImportResponse = { ...walletsResponse(), ...r };
  return json(res);
});
