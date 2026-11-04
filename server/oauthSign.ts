// OAuth-1.0a-Signatur mit HMAC-SHA1 (Web Crypto). Die Signatur gilt nur für genau
// diese Methode + URL + Zeitstempel, verrät also keine Geheimnisse und kann dem
// Browser übergeben werden. So gehen Discogs-Anfragen von der IP des Nutzers aus.

/** Prozentkodierung nach RFC 3986, wie OAuth sie verlangt */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export function signatureBase(method: string, url: string, oauth: Record<string, string>) {
  const u = new URL(url);
  const params: [string, string][] = [];
  u.searchParams.forEach((v, k) => params.push([pct(k), pct(v)]));
  for (const [k, v] of Object.entries(oauth)) params.push([pct(k), pct(v)]);
  params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const base = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
  return [method.toUpperCase(), pct(base), pct(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
}

async function hmacSha1(key: string, data: string) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return btoa(String.fromCharCode(...sig));
}

export interface SignInput {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  extra?: Record<string, string>;
  /** nur für Tests */
  fixed?: { nonce: string; timestamp: string };
}

export async function oauthHmacHeader(i: SignInput): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: i.consumerKey,
    oauth_nonce: i.fixed?.nonce ?? nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: i.fixed?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(i.token ? { oauth_token: i.token } : {}),
    ...i.extra,
  };
  const base = signatureBase(i.method, i.url, oauth);
  const signature = await hmacSha1(`${pct(i.consumerSecret)}&${pct(i.tokenSecret ?? "")}`, base);
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}
