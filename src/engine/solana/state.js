import { Keypair } from "@solana/web3.js";
import { base58Encode, parseSolanaKey } from "./keys.js";
import { SOLANA_DEFAULTS, withSwqosOnly } from "./config.js";
import { makeConnection } from "./rpc.js";

export var SolanaState = class {
    unlocked = !1;
    keypairs = new Map();
    wallets = [];
    config = {
      ...SOLANA_DEFAULTS,
    };
    token = null;
    creator = null;
    tracked = [];
    track(e) {
      const r = e.trim();
      r && !this.tracked.includes(r) && this.tracked.unshift(r);
    }
    rows = [];
    connection() {
      return makeConnection(this.config);
    }
    sendConnection() {
      const e = withSwqosOnly(this.config.sendRpcUrl ?? "");
      return e
        ? makeConnection({
            rpcUrl: e,
          })
        : this.connection();
    }
    load(e) {
      (this.keypairs.clear(), (this.wallets = []));
      for (const r of e) {
        const n = parseSolanaKey(r.secret),
          a = n.publicKey.toBase58();
        (this.keypairs.set(a, n),
          this.wallets.push({
            label: r.label,
            address: a,
          }));
      }
      ((this.unlocked = !0), this.syncRows());
    }
    lock() {
      (this.keypairs.clear(), (this.wallets = []), (this.rows = []), (this.unlocked = !1));
    }
    keypair(e) {
      const r = this.keypairs.get(e);
      if (!r) throw new Error(`Unknown Solana wallet: ${e}`);
      return r;
    }
    syncRows() {
      const e = new Map(this.rows.map(r => [r.address, r]));
      this.rows = this.wallets.map(r => {
        const n = e.get(r.address);
        return {
          label: r.label,
          address: r.address,
          solAmount: n?.solAmount ?? "0",
          enabled: n?.enabled ?? !1,
          priority: n?.priority ?? "",
        };
      });
    }
    enabledRows() {
      return this.rows.filter(e => e.enabled && Number(e.solAmount) > 0);
    }
    planRows() {
      return this.enabledRows().map(e => ({
        label: e.label,
        signer: this.keypair(e.address),
        solIn: BigInt(Math.round(Number(e.solAmount) * 1e9)),
        cuPrice: Number(e.priority) > 0 ? Number(e.priority) : void 0,
      }));
    }
    publicWallets() {
      return this.wallets.map(e => ({
        ...e,
      }));
    }
  },
  solState = new SolanaState();

export function parseSolanaWalletLines(t) {
  const e = [],
    r = [],
    n = new Set();
  return (
    t.split(/\r?\n/).forEach((a, o) => {
      const i = a.trim();
      if (!i || i.startsWith("#") || i.startsWith("//")) return;
      let s, c, d;
      if (i.includes("[") && i.includes("]")) {
        const u = i.indexOf("["),
          p = i.indexOf("]");
        c = i.slice(u, p + 1);
        const f = i
          .slice(0, u)
          .replace(/[,;\t]+$/, "")
          .trim();
        f && (s = f);
        const h = i
          .slice(p + 1)
          .replace(/^[,;\t]+/, "")
          .trim();
        /^[0-9]*\.?[0-9]+$/.test(h) && (d = h);
      } else {
        const u = i
            .split(/[,;\t]|\s{2,}/)
            .map(g => g.trim())
            .filter(Boolean),
          p = u.findIndex(g => /^[1-9A-HJ-NP-Za-km-z]{32,120}$/.test(g));
        if (p === -1) {
          r.push(`Line ${o + 1}: no valid Solana key found.`);
          return;
        }
        ((c = u[p]), p > 0 && (s = u[0]));
        const h = u.filter((g, _) => _ !== p && _ !== (p > 0 ? 0 : -1)).find(g => /^[0-9]*\.?[0-9]+$/.test(g));
        h && (d = h);
      }
      if (!c) {
        r.push(`Line ${o + 1}: unreadable key.`);
        return;
      }
      let l;
      try {
        l = parseSolanaKey(c).publicKey.toBase58();
      } catch (u) {
        r.push(`Line ${o + 1}: ${u.message}`);
        return;
      }
      if (n.has(l)) {
        r.push(`Line ${o + 1}: duplicate wallet, ignored.`);
        return;
      }
      (n.add(l),
        e.push({
          label: s ?? `sol-${e.length + 1}`,
          secret: base58Encode(parseSolanaKey(c).secretKey),
          solAmount: d,
        }));
    }),
    {
      entries: e,
      errors: r,
    }
  );
}

export function generateSolanaWallets(t, e = "sol", start = 0) {
  const off = Number(start) || 0;
  return Array.from(
    {
      length: Math.max(1, Math.min(50, t)),
    },
    (r, n) => {
      const a = Keypair.generate();
      return {
        label: `${e}-${n + 1 + off}`,
        secret: base58Encode(a.secretKey),
        address: a.publicKey.toBase58(),
      };
    },
  );
}
