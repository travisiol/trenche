import { Connection, PublicKey } from "@solana/web3.js";
import { associatedTokenAddress } from "./pump/pdas.js";
import { SOLANA_PUBLIC_RPC } from "./config.js";

export function makeConnection(t) {
  const e = t.rpcUrl?.trim() || SOLANA_PUBLIC_RPC;
  return new Connection(e, {
    commitment: "confirmed",
    // Ne PAS re-taper en boucle sur un 429 : ça amplifie l'orage de rate-limit. On échoue vite
    // (les lectures gardent leur dernière valeur côté client). Sa demande du 19/09.
    disableRetryOnRateLimit: !0,
  });
}

export async function getSolBalance(t, e) {
  const r = await t.getBalance(new PublicKey(e), "confirmed");
  return BigInt(r);
}

var sleep = t => new Promise(e => setTimeout(e, t));

export async function readSolanaBalances(t, e, r, n, a = 3) {
  if (e.length === 0) return [];
  let o = new PublicKey(r),
    i = e.map(l => new PublicKey(l)),
    s = i.map(l => associatedTokenAddress(l, o, n)),
    c;
  for (let l = 0; l < a; l++)
    try {
      const u = await t.getMultipleAccountsInfo([...i, ...s], "confirmed"),
        p = e.length;
      return e.map((f, h) => {
        let g = u[p + h],
          _ = 0n;
        if (g?.data)
          try {
            _ = Buffer.from(g.data).readBigUInt64LE(64);
          } catch {
            _ = null;
          }
        return {
          owner: f,
          sol: BigInt(u[h]?.lamports ?? 0),
          tokens: _,
        };
      });
    } catch (u) {
      ((c = u), l < a - 1 && (await sleep(300 * 2 ** l)));
    }
  const d = c?.message ?? "RPC silent";
  if (/429|Too Many Requests/i.test(d))
    return e.map(l => ({
      owner: l,
      sol: 0n,
      tokens: null,
    }));
  throw new Error(`Balances unreadable: ${d}`);
}
