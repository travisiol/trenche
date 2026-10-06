import { json, route } from "@/server/api";
import { bridgeHistory, resumeBridges } from "@/server/robinhood/bridge";
import { CHAIN_ID, EXPLORER } from "@/server/robinhood/chain";
import { rhStatus } from "@/server/robinhood/pons";
import { evmKeystorePath, rhDir } from "@/server/robinhood/wallet";

export const dynamic = "force-dynamic";

/** Robinhood Chain wallet (created on first call), balance, Pons launches, bridge history */
export const GET = route(async () => {
  resumeBridges();
  const s = await rhStatus();
  return json({ ...s, chainId: CHAIN_ID, explorer: EXPLORER, folder: rhDir(), keystore: evmKeystorePath(), bridges: bridgeHistory().slice(0, 30) });
});
