import { bad, json, readBody, route } from "@/server/api";
import { exportEvmKey } from "@/server/robinhood/wallet";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const b = await readBody<{ passphrase?: string; address?: string }>(req);
  if (typeof b.passphrase !== "string" || !b.passphrase) bad("passphrase required to export the key.");
  return json(exportEvmKey(b.passphrase!, b.address || null));
});
