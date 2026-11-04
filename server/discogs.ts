// Discogs OAuth 1.0a (PLAINTEXT-Signatur über HTTPS, von Discogs offiziell unterstützt) und API-Aufrufe
import type { Config } from "./env";
import type { Session } from "./session";

const API = "https://api.discogs.com";
const enc = encodeURIComponent;
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

function oauthHeader(cfg: Config, params: Record<string, string>, tokenSecret = ""): string {
  const all: Record<string, string> = {
    oauth_consumer_key: cfg.discogsKey,
    oauth_nonce: nonce(),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...params,
    oauth_signature: `${enc(cfg.discogsSecret)}&${enc(tokenSecret)}`,
  };
  return "OAuth " + Object.entries(all).map(([k, v]) => `${k}="${enc(v)}"`).join(", ");
}

export async function getRequestToken(cfg: Config, callback: string) {
  const res = await fetch(`${API}/oauth/request_token`, {
    headers: {
      Authorization: oauthHeader(cfg, { oauth_callback: callback }),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": cfg.userAgent,
    },
  });
  if (!res.ok) throw new Error(`request_token ${res.status}: ${await res.text()}`);
  const p = new URLSearchParams(await res.text());
  return { token: p.get("oauth_token")!, secret: p.get("oauth_token_secret")! };
}

export const authorizeUrl = (token: string) => `https://www.discogs.com/oauth/authorize?oauth_token=${enc(token)}`;

export async function getAccessToken(cfg: Config, token: string, secret: string, verifier: string) {
  const res = await fetch(`${API}/oauth/access_token`, {
    method: "POST",
    headers: {
      Authorization: oauthHeader(cfg, { oauth_token: token, oauth_verifier: verifier }, secret),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": cfg.userAgent,
    },
  });
  if (!res.ok) throw new Error(`access_token ${res.status}: ${await res.text()}`);
  const p = new URLSearchParams(await res.text());
  return { token: p.get("oauth_token")!, secret: p.get("oauth_token_secret")! };
}

export function authHeaders(cfg: Config, s: Session | null): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": cfg.userAgent };
  if (s?.token) h.Authorization = oauthHeader(cfg, { oauth_token: s.token }, s.secret);
  else if (cfg.discogsPersonalToken) h.Authorization = `Discogs token=${cfg.discogsPersonalToken}`;
  return h;
}

export function discogsFetch(cfg: Config, s: Session | null, path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(cfg, s), ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string>) },
  });
}
