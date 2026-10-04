import { Keypair } from "@solana/web3.js";

var BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  BASE58_MAP = (() => {
    const t = {};
    for (let e = 0; e < BASE58_ALPHABET.length; e++) t[BASE58_ALPHABET[e]] = e;
    return t;
  })();

function base58Decode(t) {
  if (t.length === 0) return new Uint8Array();
  const e = [0];
  for (const r of t) {
    const n = BASE58_MAP[r];
    if (n === void 0) throw new Error(`Invalid base58 character: "${r}"`);
    let a = n;
    for (let o = 0; o < e.length; o++) ((a += e[o] * 58), (e[o] = a & 255), (a >>= 8));
    for (; a > 0;) (e.push(a & 255), (a >>= 8));
  }
  for (let r = 0; r < t.length && t[r] === "1"; r++) e.push(0);
  return new Uint8Array(e.reverse());
}

export function base58Encode(t) {
  if (t.length === 0) return "";
  const e = [0];
  for (const n of t) {
    let a = n;
    for (let o = 0; o < e.length; o++) ((a += e[o] << 8), (e[o] = a % 58), (a = (a / 58) | 0));
    for (; a > 0;) (e.push(a % 58), (a = (a / 58) | 0));
  }
  let r = "";
  for (let n = 0; n < t.length && t[n] === 0; n++) r += "1";
  for (let n = e.length - 1; n >= 0; n--) r += BASE58_ALPHABET[e[n]];
  return r;
}

export function parseSolanaKey(t) {
  let e = t.trim(),
    r;
  if (e.startsWith("[")) {
    const n = JSON.parse(e);
    if (!Array.isArray(n) || n.some(a => typeof a != "number")) throw new Error("Invalid Solana key array.");
    r = Uint8Array.from(n);
  } else r = base58Decode(e);
  if (r.length === 64) return Keypair.fromSecretKey(r);
  if (r.length === 32) return Keypair.fromSeed(r);
  throw new Error(`Unexpected Solana key length: ${r.length} bytes (32 or 64 expected).`);
}
