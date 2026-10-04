import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { HttpError, json, lamportsOf, readBody, requireAddress, route, solString } from "@/server/api";
import { readConn } from "@/server/engine";
import { explorerUrl, isDevnet, logActivity, store } from "@/server/store";
import type { AirdropRequest, AirdropResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const FAUCET_HINT = "The public devnet faucet is rate-limited per IP (a few SOL per day) and often dry: get test SOL at https://faucet.solana.com (GitHub login) and send it to this address instead.";

/** POST /api/dev/airdrop {wallet, sol} — devnet only: asks the cluster faucet (requestAirdrop) and waits for the confirmation */
export const POST = route(async (req: Request) => {
  const st = store();
  if (!isDevnet(st.settings)) throw new HttpError(409, "Airdrops exist on devnet only. Switch Settings → cluster to \"devnet\" first.");
  const body = await readBody<AirdropRequest>(req);
  const wallet = requireAddress(body.wallet, "wallet");
  const lamports = lamportsOf(body.sol ?? "1", "sol");
  if (lamports > BigInt(5 * LAMPORTS_PER_SOL)) throw new HttpError(400, "The faucet gives at most 5 SOL per request.");
  const conn = readConn();
  let signature: string;
  try {
    signature = await conn.requestAirdrop(new PublicKey(wallet), Number(lamports));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/429|limit|run dry|Too Many/i.test(msg)) throw new HttpError(429, `Faucet refused: airdrop limit reached or faucet dry. ${FAUCET_HINT}`);
    if (/Internal error/i.test(msg)) throw new HttpError(503, `Faucet unavailable (internal error on the RPC faucet). ${FAUCET_HINT}`);
    throw new HttpError(502, `Faucet error: ${msg.slice(0, 200)}`);
  }
  const t0 = Date.now();
  let confirmed = false;
  let err: string | null = null;
  while (Date.now() - t0 < 60_000) {
    const s = (await conn.getSignatureStatuses([signature]).catch(() => null))?.value?.[0];
    if (s?.err) {
      err = JSON.stringify(s.err);
      break;
    }
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
      confirmed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  const balance = await conn.getBalance(new PublicKey(wallet), "confirmed").catch(() => null);
  logActivity(st, { kind: "airdrop", ok: confirmed, message: confirmed ? `Airdrop ${solString(lamports)} SOL → ${wallet.slice(0, 6)}… confirmed (devnet)` : `Airdrop ${solString(lamports)} SOL → ${wallet.slice(0, 6)}… ${err ?? "not confirmed within 60 s"}`, wallets: [wallet], signature });
  const res: AirdropResponse = { wallet, sol: solString(lamports), signature, confirmed, error: confirmed ? null : (err ?? "not confirmed within 60 s"), cluster: "devnet", explorer: explorerUrl("tx", signature, st.settings), balance: balance === null ? null : solString(BigInt(balance)) };
  st.balances = null;
  return json(res, { status: confirmed ? 200 : 504 });
});
