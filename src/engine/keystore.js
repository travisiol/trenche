import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function scryptParams(t) {
  return {
    N: t.length < 10 || /^[0-9]+$/.test(t) ? 2 ** 17 : 2 ** 16,
    r: 8,
    p: 1,
    keyLen: 32,
  };
}

function deriveKey(t, e) {
  const r = scryptParams(t);
  return scryptSync(t, e, r.keyLen, {
    N: r.N,
    r: r.r,
    p: r.p,
    maxmem: 512 * 1024 * 1024,
  });
}

export function keystoreExists(t) {
  return existsSync(t);
}

export function passphraseIssue(t) {
  const e = String(t ?? "");
  if (e.length < 12) return "Passphrase too weak: at least 12 characters required (a memorable sentence works well).";
  if (/^(.)\1*$/.test(e)) return "Passphrase too weak: do not use a single repeated character.";
  if (/^[0-9]+$/.test(e)) return "Passphrase too weak: not digits only — add letters/words or use a passphrase.";
  if (/password|motdepasse|qwerty|azerty|letmein|iloveyou|welcome|123456|abcdef|000000/.test(e.toLowerCase()))
    return "Passphrase too weak: contains a very common word or sequence.";
  return null;
}

export function assertStrongPassphrase(t) {
  const e = passphraseIssue(t);
  if (e) throw new Error(e);
}

export function saveKeystore(t, e, r) {
  if (e.length < 4) throw new Error("Code too short (4 characters minimum).");
  const n = scryptParams(e),
    a = randomBytes(32),
    o = deriveKey(e, a),
    i = randomBytes(12),
    s = createCipheriv("aes-256-gcm", o, i),
    c = Buffer.from(JSON.stringify(r), "utf8"),
    d = Buffer.concat([s.update(c), s.final()]),
    l = s.getAuthTag(),
    u = {
      version: 1,
      kdf: "scrypt",
      kdfParams: {
        salt: a.toString("hex"),
        N: n.N,
        r: n.r,
        p: n.p,
        keyLen: n.keyLen,
      },
      cipher: "aes-256-gcm",
      iv: i.toString("hex"),
      tag: l.toString("hex"),
      ciphertext: d.toString("base64"),
    };
  if (
    (mkdirSync(dirname(t), {
      recursive: !0,
    }),
    existsSync(t))
  )
    try {
      copyFileSync(t, `${t}.bak`);
    } catch {}
  const p = `${t}.tmp`;
  (writeFileSync(p, JSON.stringify(u, null, 2), {
    mode: 384,
  }),
    renameSync(p, t),
    o.fill(0),
    c.fill(0));
}

export function loadKeystore(t, e) {
  const r = readFileSync(t, "utf8"),
    n = JSON.parse(r);
  if (n.version !== 1) throw new Error(`Unsupported keystore version: ${n.version}`);
  const a = Buffer.from(n.kdfParams.salt, "hex"),
    o = scryptSync(e, a, n.kdfParams.keyLen, {
      N: n.kdfParams.N,
      r: n.kdfParams.r,
      p: n.kdfParams.p,
      maxmem: 512 * 1024 * 1024,
    }),
    i = createDecipheriv("aes-256-gcm", o, Buffer.from(n.iv, "hex"));
  i.setAuthTag(Buffer.from(n.tag, "hex"));
  let s;
  try {
    s = Buffer.concat([i.update(Buffer.from(n.ciphertext, "base64")), i.final()]);
  } catch {
    throw (o.fill(0), new Error("Incorrect passphrase (or corrupted keystore)."));
  }
  o.fill(0);
  const c = JSON.parse(s.toString("utf8"));
  return (s.fill(0), c);
}

export function parseWalletLines(t) {
  const e = [],
    r = [],
    n = new Set();
  return (
    t.split(/\r?\n/).forEach((o, i) => {
      const s = o.trim();
      if (!s || s.startsWith("#") || s.startsWith("//")) return;
      const c = s
          .split(/[,;\t]|\s{2,}/)
          .map(h => h.trim())
          .filter(Boolean),
        d = c.findIndex(h => /^(0x)?[0-9a-fA-F]{64}$/.test(h));
      if (d === -1) {
        r.push(`Line ${i + 1}: no valid private key found (64 hex characters expected).`);
        return;
      }
      let l = c[d];
      if ((l.startsWith("0x") || (l = `0x${l}`), (l = l.toLowerCase()), n.has(l))) {
        r.push(`Line ${i + 1}: duplicate key, ignored.`);
        return;
      }
      n.add(l);
      const u = c.filter((h, g) => g !== d),
        p = d > 0 ? c[0] : `wallet-${e.length + 1}`,
        f = (d > 0 ? u.slice(1) : u).filter(h => /^[0-9]*\.?[0-9]+$/.test(h));
      e.push({
        label: p,
        privateKey: l,
        ethAmount: f[0],
        gwei: f[1],
        delayMs: f[2] !== void 0 ? Math.max(0, Math.round(Number(f[2]))) : void 0,
      });
    }),
    {
      entries: e,
      errors: r,
    }
  );
}

export function safeEqual(t, e) {
  const r = Buffer.from(t),
    n = Buffer.from(e);
  return r.length !== n.length ? !1 : timingSafeEqual(r, n);
}
