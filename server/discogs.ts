// Discogs OAuth 1.0a (PLAINTEXT-Signatur über HTTPS, von Discogs offiziell unterstützt) und API-Aufrufe
import { randomBytes } from "node:crypto";
import { config } from "./config";
import type { Session } from "./session";

const API = "https://api.discogs.com";
const enc = encodeURIComponent;

function oauthHeader(params: Record<string, string>, tokenSecret = ""): string {
  const all: Record<string, string> = {
    oauth_consumer_key: config.discogsKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...params,
    oauth_signature: `${enc(config.discogsSecret)}&${enc(tokenSecret)}`,
  };
  return "OAuth " + Object.entries(all).map(([k, v]) => `${k}="${enc(v)}"`).join(", ");
}

export async function getRequestToken(callback: string) {
  const res = await fetch(`${API}/oauth/request_token`, {
    method: "GET",
    headers: {
      Authorization: oauthHeader({ oauth_callback: callback }),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.userAgent,
    },
  });
  if (!res.ok) throw new Error(`request_token ${res.status}: ${await res.text()}`);
  const p = new URLSearchParams(await res.text());
  return { token: p.get("oauth_token")!, secret: p.get("oauth_token_secret")! };
}

export const authorizeUrl = (token: string) => `https://www.discogs.com/oauth/authorize?oauth_token=${enc(token)}`;

export async function getAccessToken(token: string, secret: string, verifier: string) {
  const res = await fetch(`${API}/oauth/access_token`, {
    method: "POST",
    headers: {
      Authorization: oauthHeader({ oauth_token: token, oauth_verifier: verifier }, secret),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.userAgent,
    },
  });
  if (!res.ok) throw new Error(`access_token ${res.status}: ${await res.text()}`);
  const p = new URLSearchParams(await res.text());
  return { token: p.get("oauth_token")!, secret: p.get("oauth_token_secret")! };
}

export function authHeaders(s: Session | null): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": config.userAgent };
  if (s?.token) h.Authorization = oauthHeader({ oauth_token: s.token }, s.secret);
  else if (config.discogsPersonalToken) h.Authorization = `Discogs token=${config.discogsPersonalToken}`;
  return h;
}

export async function discogsFetch(s: Session | null, path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(s), ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string>) },
  });
}
