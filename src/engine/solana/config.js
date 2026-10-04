// RPC de lecture Solana par défaut : publicnode (gratuit, sans clé, au head) — bien plus fiable
// que le mainnet-beta public rate-limité. Pré-rempli dans le champ RPC + fallback. (19/09)
export var SOLANA_PUBLIC_RPC = "https://solana-rpc.publicnode.com";

export var HELIUS_SENDER_URL = "https://sender.helius-rpc.com/fast?swqos_only=true",
  SOLANA_DEFAULTS = {
    cluster: "mainnet-beta",
    rpcUrl: "https://solana-rpc.publicnode.com",
    sendRpcUrl: HELIUS_SENDER_URL,
    slippageBps: 1e3,
    priorityMicroLamports: 2e6,
    maxPriorityMicroLamports: 5e7,
    spreadMs: 0,
  };

export function normalizeSolanaRpc(t) {
  const e = (t ?? "").trim();
  return e
    ? /^https?:\/\//i.test(e)
      ? e
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e)
        ? `https://mainnet.helius-rpc.com/?api-key=${e}`
        : e
    : "";
}

export var JITO_TIP_ACCOUNTS = [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
    "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
    "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
    "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
    "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
    "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
    "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
    "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
    "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
  ],
  SENDER_TIP_LAMPORTS = 5000n,
  isHeliusSender = t => /sender\.helius-rpc\.com/i.test(t);

export function withSwqosOnly(t) {
  const e = t?.trim();
  return !e || !isHeliusSender(e)
    ? (e ?? "")
    : /[?&]swqos_only=/i.test(e)
      ? e
      : e + (e.includes("?") ? "&" : "?") + "swqos_only=true";
}
