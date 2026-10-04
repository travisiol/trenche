/** Minimal base58 (Bitcoin alphabet) for the browser: decode a pasted secret key, encode its public half. */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = new Map<string, number>(ALPHABET.split("").map((c, i) => [c, i]));

export function decodeBase58(s: string): Uint8Array {
  const str = s.trim();
  if (!str) return new Uint8Array();
  const bytes: number[] = [0];
  for (const ch of str) {
    const v = MAP.get(ch);
    if (v === undefined) throw new Error(`Invalid base58 character "${ch}"`);
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function encodeBase58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const b of bytes) {
    if (b !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/**
 * A Solana secret key is 64 bytes: seed ‖ public key. Accepts base58 or a JSON byte array and returns the
 * public key (base58) — no signing library needed to show which mint address a pasted keypair controls.
 */
export function mintAddressOfSecret(secret: string): string {
  const s = secret.trim();
  let bytes: Uint8Array;
  if (s.startsWith("[")) {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n < 256)) throw new Error("Byte array must hold 0–255 integers");
    bytes = Uint8Array.from(arr as number[]);
  } else bytes = decodeBase58(s);
  if (bytes.length !== 64) throw new Error(`Expected a 64-byte secret key, got ${bytes.length} bytes`);
  return encodeBase58(bytes.subarray(32));
}
