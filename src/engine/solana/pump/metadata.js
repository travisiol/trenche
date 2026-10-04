export async function uploadPumpMetadata(t) {
  const e = new FormData();
  if (t.imageBase64) {
    const a = Buffer.from(t.imageBase64, "base64");
    e.append(
      "file",
      new Blob([a], {
        type: t.imageType || "image/png",
      }),
      "logo.png",
    );
  }
  (e.append("name", t.name),
    e.append("symbol", t.symbol),
    e.append("description", t.description ?? ""),
    t.twitter && e.append("twitter", t.twitter),
    t.telegram && e.append("telegram", t.telegram),
    t.website && e.append("website", t.website),
    e.append("showName", "true"));
  const r = await fetch("https://pump.fun/api/ipfs", {
    method: "POST",
    body: e,
  });
  if (!r.ok) throw new Error(`Metadata upload rejected (${r.status}). Retry or paste a URI yourself.`);
  const n = await r.json();
  if (!n.metadataUri) throw new Error("pump.fun response without metadataUri.");
  return n.metadataUri;
}

export function parseMintMetadata(t) {
  const e = Buffer.from(t),
    r = a => {
      const o = e.readUInt32LE(a);
      if (o > 200) throw new Error("too long");
      return [e.subarray(a + 4, a + 4 + o).toString("utf8"), a + 4 + o];
    },
    n = a => /^[\x20-\x7e]*$/.test(a);
  for (let a = 82; a < e.length - 8; a++)
    try {
      const [o, i] = r(a);
      if (o.length < 1 || o.length > 32 || !n(o)) continue;
      const [s, c] = r(i);
      if (s.length < 1 || s.length > 16 || !n(s)) continue;
      const [d] = r(c);
      if (!n(d)) continue;
      return {
        name: o,
        symbol: s,
        uri: d,
      };
    } catch {}
  return null;
}

export function ipfsToHttp(t) {
  const e = (t ?? "").trim();
  return e.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${e.slice(7)}` : e;
}
