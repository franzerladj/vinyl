// Verschlüsselte Session im httpOnly-Cookie (AES-256-GCM über Web Crypto).
// Läuft gleich auf Cloudflare Workers und Node 20+. Keine Datenbank nötig.

export interface Session {
  token: string;
  secret: string;
  username: string;
  /** false = Benutzername kam vom Browser und ist noch nicht vom Server bei Discogs bestätigt */
  verified?: boolean;
}

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function getKey(secret: string) {
  const s = secret || "dev-only-insecure-secret";
  let k = keyCache.get(s);
  if (!k) {
    k = crypto.subtle.digest("SHA-256", enc.encode(s)).then((h) => crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]));
    keyCache.set(s, k);
  }
  return k;
}

const b64url = (buf: Uint8Array) => btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal(secret: string, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(secret), enc.encode(JSON.stringify(data))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

export async function unseal<T>(secret: string, value: string | undefined): Promise<T | null> {
  if (!value) return null;
  try {
    const buf = fromB64url(value);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await getKey(secret), buf.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}
