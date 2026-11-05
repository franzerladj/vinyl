// Regressionstests aus dem Sicherheits-Audit: Login-CSRF, KI-Tor, Proxys ohne Anmeldung, Signier-Pfade
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedPath, app, crossSite } from "../server/app";
import { seal } from "../server/session";
import { sanitizeProfile } from "../shared/profile";

const SECRET = "x".repeat(40);
const ORIGIN = "https://crate.test";
const calls: string[] = [];
const aiRuns: string[] = [];
const env = { SESSION_SECRET: SECRET, APP_URL: ORIGIN, DISCOGS_CONSUMER_KEY: "ck", DISCOGS_CONSUMER_SECRET: "cs", LASTFM_API_KEY: "lf", AI: { run: async (m: string) => (aiRuns.push(m), { response: "{}" }) } };

vi.stubGlobal("fetch", async (u: string | URL | Request) => {
  const url = String(u instanceof Request ? u.url : u);
  calls.push(url);
  if (url.includes("/oauth/identity")) return new Response(JSON.stringify({ username: "attacker" }), { status: 200 });
  return new Response(JSON.stringify({ data: [], toptags: { tag: [] } }), { status: 200 });
});
afterEach(() => {
  calls.length = 0;
  aiRuns.length = 0;
});

const req = (path: string, init: RequestInit = {}) => app.request(`${ORIGIN}${path}`, init, env);
const sessionCookie = async () => `crate_session=${await seal(SECRET, { token: "t", secret: "s", username: "franz", verified: true })}`;

describe("Login-CSRF", () => {
  it("lehnt ein fremdes Formular auf /api/auth/finish ab und setzt keine Sitzung", async () => {
    const r = await req("/api/auth/finish", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      body: '{"token":"AT","secret":"ATS","x":"="}',
    });
    expect(r.status).toBe(403);
    expect(r.headers.get("Set-Cookie")).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("lässt die eigene App weiter anmelden", async () => {
    const r = await req("/api/auth/finish", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" }, body: '{"token":"AT","secret":"ATS"}' });
    expect(r.status).toBe(200);
    expect(r.headers.get("Set-Cookie")).toContain("crate_session=");
  });
  it("erkennt fremde Seiten an Sec-Fetch-Site oder Origin", () => {
    expect(crossSite("cross-site", undefined, [ORIGIN])).toBe(true);
    expect(crossSite("same-site", undefined, [ORIGIN])).toBe(true);
    expect(crossSite(undefined, "https://evil.example", [ORIGIN])).toBe(true);
    expect(crossSite("same-origin", ORIGIN, [ORIGIN])).toBe(false);
    expect(crossSite(undefined, undefined, [ORIGIN])).toBe(false); // Zeitplan-Worker
  });
});

describe("KI nur mit Anmeldung oder eigenem Schlüssel", () => {
  it("ein beliebiger X-Anthropic-Key öffnet die Betreiber-KI nicht mehr", async () => {
    for (const path of ["/api/ai/vibes", "/api/ai/recognize"]) {
      const r = await req(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Anthropic-Key": "x" }, body: '{"items":[{"id":"a","artist":"x","title":"y","styles":[]}],"image":"AAAA"}' });
      expect(r.status).toBe(401);
    }
    expect(aiRuns).toHaveLength(0);
  });
  it("angemeldet läuft Workers AI weiter", async () => {
    const r = await req("/api/ai/vibes", { method: "POST", headers: { "Content-Type": "application/json", Cookie: await sessionCookie() }, body: '{"items":[{"id":"a","artist":"x","title":"y","styles":[]}]}' });
    expect(r.status).toBe(200);
    expect(aiRuns.length).toBeGreaterThan(0);
  });
});

describe("Audio und Last.fm nur für Angemeldete", () => {
  it("anonym: 401 und keine ausgehenden Anfragen", async () => {
    for (const [path, init] of [
      ["/api/lastfm/tags?artist=a&track=b", {}],
      ["/api/audio/lookup?artist=a&title=b", {}],
      ["/api/audio/preview/123", {}],
      ["/api/audio/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"title":"t","tracks":[]}' }],
    ] as const) {
      expect((await req(path, init)).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });
  it("angemeldet geht es", async () => {
    expect((await req("/api/lastfm/tags?artist=a&track=b", { headers: { Cookie: await sessionCookie() } })).status).toBe(200);
  });
});

describe("Signier-Pfade", () => {
  it("lässt normale Pfade durch", () => {
    expect(allowedPath("/users/franz/wants?page=2&per_page=100")).toBe(true);
    expect(allowedPath("/database/search?q=AC%2FDC%20'Back'&type=release")).toBe(true);
    expect(allowedPath("/marketplace/stats/123?curr_abbr=EUR")).toBe(true);
  });
  it("lehnt Punkt-Segmente, Backslash und kodierte Trenner ab", () => {
    for (const p of ["/users/../marketplace/orders", "/users/%2e%2e/inventory/upload", "/users/x\\..\\..\\oauth/access_token", "/users/x%2F..%2F..%2Fmarketplace/orders", "/marketplace/orders", "users/x"]) {
      expect(allowedPath(p)).toBe(false);
    }
  });
});

describe("Profil", () => {
  it("akzeptiert keine geerbten Schlüssel als Spielweise", () => {
    for (const plays of ["__proto__", "toString", "constructor"]) expect(sanitizeProfile({ links: [], styles: [], plays: plays as never }).plays).toBeUndefined();
    expect(sanitizeProfile({ links: [], styles: [], plays: "vinyl" }).plays).toBe("vinyl");
  });
});
