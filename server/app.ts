// Alle API-Routen. Läuft als Cloudflare Pages Function und lokal unter Node.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readConfig, type Config, type Env } from "./env";
import { seal, SESSION_DAYS, unseal, type Session } from "./session";
import { authHeaders, authorizeUrl, discogsFetch, DiscogsBusy, getAccessToken, getRequestToken } from "./discogs";
import { ALL_KINDS, KIND_DEFAULT, kindOn, bundle, currentSlot, deviceCount, dueReminders, isPushEndpoint, loadUser, pickWants, notifyUser, saveUser, sendNative, sendPush, userKey, wantChange, type Message, type PushSub, type Stat, type UserRec, type WatchedWant } from "./push";
import { oauthHmacHeader, oauthHmacParams } from "./oauthSign";
import { recognizeRecordFree, tagVibesFree, type VibeInput } from "./ai";
import { DeezerBusy, fetchPreview, fetchPreviewById, lookupAudio, matchRelease, type ReleaseTrackIn } from "./audio";
import { lastfmTags } from "./lastfm";
import { profileEmpty, sanitizeProfile, type CrateProfile } from "../shared/profile";
import { buildIcs } from "../shared/ics";
import { pushOps } from "./devsync";
import { buzzStore, nativeStore, syncStore } from "./env";
import { APK } from "../shared/appVersion";
import { cleanText, validPost } from "./buzz";
import { cleanOwnPost, validRef } from "../shared/ownPost";
import { ANNOUNCE } from "../shared/announce";

type C = Context<{ Bindings: Env; Variables: { cfg: Config } }>;

export const app = new Hono<{ Bindings: Env; Variables: { cfg: Config } }>();
const SESSION = "crate_session";
const PENDING = "crate_oauth";

app.use("/api/*", async (c, next) => {
  c.set("cfg", readConfig(c.env ?? {}, c.req.url));
  // Schreibende Anfragen nur von der eigenen Seite (Schutz gegen Login-CSRF und fremde Formulare).
  // Server-zu-Server-Aufrufe (Zeitplan-Worker) schicken weder Origin noch Sec-Fetch-Site.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && crossSite(c.req.header("Sec-Fetch-Site"), c.req.header("Origin"), [new URL(c.req.url).origin, c.var.cfg.appUrl])) {
    return c.json({ message: "Anfrage von fremder Seite abgelehnt" }, 403);
  }
  await next();
});

/** Kommt die Anfrage von einer fremden Seite? */
export function crossSite(fetchSite: string | undefined, origin: string | undefined, own: string[]): boolean {
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  if (origin && !own.includes(origin)) return true;
  return false;
}

/** Vergleich in konstanter Zeit (für das Zeitplan-Geheimnis) */
function sameSecret(a: string | undefined, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const cookieOpts = (c: C) => ({ httpOnly: true, secure: c.var.cfg.appUrl.startsWith("https://"), sameSite: "Lax" as const, path: "/" });
/**
 * Widerruf: „Auf allen anderen Geräten abmelden“ legt je Konto einen Zeitpunkt im KV ab (`rev:<name>`).
 * Sitzungen, die davor ausgestellt wurden, gelten nicht mehr. Der Zeitpunkt wird je Worker eine Minute
 * gemerkt (sonst kostete jede signierte Discogs-Anfrage einen KV-Zugriff): der Widerruf greift also
 * nach spätestens ein bis zwei Minuten überall.
 */
const revCache = new Map<string, { at: number; until: number }>();
const REV_TTL = 60_000;
async function revokedAt(c: C, username: string): Promise<number> {
  const key = username.toLowerCase();
  const hit = revCache.get(key);
  if (hit && hit.until > Date.now()) return hit.at;
  const at = Number(await c.var.cfg.kv.get(`rev:${key}`).catch(() => null)) || 0;
  revCache.set(key, { at, until: Date.now() + REV_TTL });
  if (revCache.size > 2000) revCache.clear();
  return at;
}
const rawSession = async (c: C) => {
  const s = await unseal<Session>(c.var.cfg.sessionSecret, getCookie(c, SESSION));
  if (s?.username && (s.iat ?? 0) < (await revokedAt(c, s.username))) return null;
  return s;
};
/** Nur Sitzungen mit vom Server bei Discogs bestätigtem Namen zählen (alte unbestätigte werden nachgeprüft) */
const session = async (c: C) => {
  const s = await rawSession(c);
  if (s?.iat && Date.now() - s.iat > SESSION_DAYS * 86400_000) return null;
  return s && s.username && s.verified !== false ? s : null;
};
/**
 * Gültiger Discogs-Zugang, auch wenn der Name noch nicht bestätigt ist (Discogs bremst den Server oft aus).
 * Reicht für alles, was nur mit dem eigenen Discogs-Konto arbeitet: Signieren, Proxy, Audio, Last.fm.
 * Alles, was unter dem Namen gespeichert wird (Profil, Verzeichnis, Mitteilungen), braucht session().
 */
const tokenSession = async (c: C) => {
  const s = await rawSession(c);
  if (!s?.token || !s.secret || (s.iat && Date.now() - s.iat > SESSION_DAYS * 86400_000)) return null;
  return s;
};
const SESSION_AGE = SESSION_DAYS * 24 * 60 * 60;
/** Sitzung frisch versiegeln (neuer Zeitstempel) */
const setSession = async (c: C, s: Session) => setCookie(c, SESSION, await seal(c.var.cfg.sessionSecret, { ...s, iat: Date.now() }), { ...cookieOpts(c), maxAge: SESSION_AGE });

/** Bilderkennung und Vibes (Workers AI) nur mit gültigem Discogs-Zugang */
async function aiAccess(c: C): Promise<boolean> {
  return Boolean((await tokenSession(c)) && c.var.cfg.ai);
}

// ---------- Auth ----------
app.get("/api/auth/login", async (c) => {
  const cfg = c.var.cfg;
  if (!cfg.discogsKey) return c.text("DISCOGS_CONSUMER_KEY fehlt in der Server-Konfiguration", 500);
  let rt: { token: string; secret: string };
  try {
    rt = await getRequestToken(cfg, `${cfg.appUrl}/api/auth/callback`);
  } catch (e) {
    if (e instanceof DiscogsBusy) return c.redirect(`${cfg.appUrl}/?login=busy`);
    throw e;
  }
  setCookie(c, PENDING, await seal(cfg.sessionSecret, rt), { ...cookieOpts(c), maxAge: 900 });
  return c.redirect(authorizeUrl(rt.token));
});

app.get("/api/auth/callback", (c) => {
  // Den Tausch gegen den Access-Token macht die App (vom Gerät aus, siehe /api/auth/sign-access).
  // So scheitert die Anmeldung nicht an der gedrosselten Server-IP.
  const cfg = c.var.cfg;
  const token = c.req.query("oauth_token");
  const verifier = c.req.query("oauth_verifier");
  if (!token || !verifier) return c.redirect(`${cfg.appUrl}/?login=failed`);
  return c.redirect(`${cfg.appUrl}/?oauth_token=${encodeURIComponent(token)}&oauth_verifier=${encodeURIComponent(verifier)}`);
});

// ---------- Anmeldung direkt vom Gerät ----------
// Discogs drosselt pro IP. Cloudflare-IPs teilen sich viele Dienste, deshalb scheitert die
// Anmeldung vom Server aus oft mit 429. Hier schickt der Browser die drei Schritte selbst
// (eigene IP), der Server signiert nur und hält die Geheimnisse im verschlüsselten Cookie.
const API_BASE = "https://api.discogs.com";

/** Schritt 1: signierte Adresse für den Request-Token */
app.post("/api/auth/start", async (c) => {
  const cfg = c.var.cfg;
  if (!cfg.discogsKey) return c.json({ message: "DISCOGS_CONSUMER_KEY fehlt" }, 500);
  const url = `${API_BASE}/oauth/request_token`;
  const params = await oauthHmacParams({ method: "GET", url, consumerKey: cfg.discogsKey, consumerSecret: cfg.discogsSecret, extra: { oauth_callback: `${cfg.appUrl}/api/auth/callback` } });
  return c.json({ url: `${url}?${new URLSearchParams(params)}` });
});

/** Schritt 1b: Request-Token merken und zu Discogs weiterleiten */
app.post("/api/auth/pending", async (c) => {
  const cfg = c.var.cfg;
  const { token, secret } = await c.req.json<{ token: string; secret: string }>();
  if (!token || !secret) return c.json({ message: "Token fehlt" }, 400);
  setCookie(c, PENDING, await seal(cfg.sessionSecret, { token, secret }), { ...cookieOpts(c), maxAge: 900 });
  return c.json({ authorize: authorizeUrl(token) });
});

/** Schritt 2: signierte Anfrage für den Access-Token (Geheimnis des Request-Tokens bleibt im Cookie) */
app.post("/api/auth/sign-access", async (c) => {
  const cfg = c.var.cfg;
  const pending = await unseal<{ token: string; secret: string }>(cfg.sessionSecret, getCookie(c, PENDING));
  const { token, verifier } = await c.req.json<{ token: string; verifier: string }>();
  if (!pending || pending.token !== token || !verifier) return c.json({ message: "Anmeldung abgelaufen" }, 400);
  const url = `${API_BASE}/oauth/access_token`;
  const params = await oauthHmacParams({ method: "POST", url, consumerKey: cfg.discogsKey, consumerSecret: cfg.discogsSecret, token, tokenSecret: pending.secret, extra: { oauth_verifier: verifier } });
  return c.json({ url, body: params });
});

/** Schritt 3: Access-Token übernehmen. Der Server prüft den Namen bei Discogs, wenn das gerade geht. */
app.post("/api/auth/finish", async (c) => {
  const cfg = c.var.cfg;
  const { token, secret } = await c.req.json<{ token: string; secret: string }>();
  if (!token || !secret) return c.json({ message: "Token fehlt" }, 400);
  // Der Name kommt immer vom Server bei Discogs, nie vom Gerät
  const r = await discogsFetch(cfg, { token, secret, username: "" }, "/oauth/identity").catch(() => null);
  deleteCookie(c, PENDING, { path: "/" });
  if (!r || r.status === 429 || r.status >= 500) {
    // Discogs bremst gerade den Server: trotzdem anmelden, der Name wird im Hintergrund bestätigt.
    // Bis dahin geht alles, was nur das eigene Discogs-Konto braucht.
    await setSession(c, { token, secret, username: "", verified: false });
    return c.json({ username: null, verified: false });
  }
  if (!r.ok) return c.json({ message: "Discogs hat den Zugang nicht bestätigt" }, 401);
  const name = ((await r.json()) as { username: string }).username;
  await setSession(c, { token, secret, username: name, verified: true });
  return c.json({ username: name, verified: true });
});

/**
 * Vorläufiger Name vom Gerät (das Gerät fragt Discogs selbst, eigene IP). Gilt nur für die Anzeige
 * und Discogs-Pfade; gespeichert unter dem Namen wird erst nach der Bestätigung durch den Server.
 */
app.post("/api/auth/claim", async (c) => {
  const s = await tokenSession(c);
  if (!s) return c.json({ message: "nicht angemeldet" }, 401);
  if (s.verified !== false && s.username) return c.json({ username: s.username, verified: true });
  const { username } = await c.req.json<{ username: string }>();
  if (typeof username !== "string" || !/^[\w.\-]{1,40}$/.test(username)) return c.json({ message: "Name ungültig" }, 400);
  await setSession(c, { ...s, username, verified: false });
  return c.json({ username, verified: false });
});

/** Ältere Sitzungen ohne bestätigten Namen: der Server fragt Discogs selbst */
app.post("/api/auth/identity", async (c) => {
  const cfg = c.var.cfg;
  const s = await tokenSession(c);
  if (!s) return c.json({ message: "nicht angemeldet" }, 401);
  if (s.verified !== false && s.username) return c.json({ username: s.username, verified: true });
  const r = await discogsFetch(cfg, s, "/oauth/identity").catch(() => null);
  if (!r || r.status === 429) return c.json({ busy: true }, 503);
  if (!r.ok) return c.json({ message: "Zugang ungültig, bitte neu anmelden" }, 401);
  const username = ((await r.json()) as { username: string }).username;
  await setSession(c, { ...s, username, verified: true });
  return c.json({ username, verified: true });
});

/** Rückfall: Austausch über den Server (mit Wiederholungen); bei Überlastung bleibt der Verifier gültig */
app.post("/api/auth/exchange", async (c) => {
  const cfg = c.var.cfg;
  const pending = await unseal<{ token: string; secret: string }>(cfg.sessionSecret, getCookie(c, PENDING));
  const { token, verifier } = await c.req.json<{ token: string; verifier: string }>();
  if (!pending || pending.token !== token || !verifier) return c.json({ message: "Anmeldung abgelaufen" }, 400);
  try {
    const at = await getAccessToken(cfg, pending.token, pending.secret, verifier);
    const r = await discogsFetch(cfg, { token: at.token, secret: at.secret, username: "" }, "/oauth/identity");
    deleteCookie(c, PENDING, { path: "/" });
    if (!r.ok) {
      // Zugang ist da, nur der Name fehlt: Sitzung ohne Namen, der Server prüft ihn gleich über /api/auth/identity nach
      await setSession(c, { ...at, username: "", verified: false });
      return c.json({ username: null, verified: false });
    }
    const name = ((await r.json()) as { username: string }).username;
    await setSession(c, { ...at, username: name, verified: true });
    return c.json({ username: name, verified: true });
  } catch (e) {
    return c.json({ busy: e instanceof DiscogsBusy, message: (e as Error).message }, e instanceof DiscogsBusy ? 503 : 400);
  }
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, SESSION, { path: "/" });
  return c.json({ ok: true });
});

/** Alle anderen Geräte abmelden: ältere Sitzungen gelten nicht mehr, dieses Gerät bekommt eine frische */
app.post("/api/auth/revoke-others", async (c) => {
  const s = await session(c);
  if (!s) return c.json({ message: "nicht angemeldet" }, 401);
  const now = Date.now();
  const key = s.username.toLowerCase();
  await c.var.cfg.kv.put(`rev:${key}`, String(now));
  revCache.set(key, { at: now, until: now + REV_TTL });
  await setSession(c, s);
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  const features = {
    oauth: Boolean(cfg.discogsKey),
    freeAi: Boolean(cfg.ai),
    lastfm: Boolean(cfg.lastfmKey),
  };
  if (s) {
    // Gleitend verlängern: wer die App nutzt, bleibt angemeldet, ungenutzte Sitzungen laufen ab
    if (!s.iat || Date.now() - s.iat > 7 * 86400_000) await setSession(c, s);
    return c.json({ username: s.username, features, verified: true });
  }
  const t = await tokenSession(c);
  if (t) {
    // Angemeldet, Name noch nicht vom Server bestätigt: nicht abmelden, sondern weiterarbeiten
    if (!t.iat || Date.now() - t.iat > 7 * 86400_000) await setSession(c, t);
    return c.json({ username: t.username || null, features, verified: false, needIdentity: true });
  }
  if (getCookie(c, SESSION)) console.warn("auth: Sitzungs-Cookie nicht lesbar oder abgelaufen");
  if (cfg.discogsPersonalToken) {
    const r = await discogsFetch(cfg, null, "/oauth/identity");
    if (r.ok) return c.json({ username: ((await r.json()) as { username: string }).username, features, personalToken: true });
  }
  return c.json({ username: null, features }, 401);
});

// ---------- Signierte Direktanfragen ----------
// Der Browser schickt Anfragen selbst an api.discogs.com (eigene IP, eigenes Limit).
// Der Server liefert nur die HMAC-Signatur für genau diese Anfrage.
app.post("/api/sign", async (c) => {
  const cfg = c.var.cfg;
  const s = await tokenSession(c);
  if (!s) return c.json({ mode: "proxy" });
  const { method, path } = await c.req.json<{ method: string; path: string }>();
  if (!path || !allowedPath(path) || !["GET", "POST", "PUT", "DELETE"].includes(method)) return c.json({ message: "Pfad nicht erlaubt" }, 403);
  const url = `https://api.discogs.com${path}`;
  const authorization = await oauthHmacHeader({ method, url, consumerKey: cfg.discogsKey, consumerSecret: cfg.discogsSecret, token: s.token, tokenSecret: s.secret });
  return c.json({ mode: "direct", url, authorization });
});

// ---------- Discogs-Proxy (Rückfallebene) ----------
const ALLOWED = /^\/(users|database|releases|masters|artists|labels|marketplace\/(stats|price_suggestions|listings)|oauth\/identity)(\/|$|\?)/;

/** Pfad erst so lesen, wie Discogs ihn sieht: keine Punkt-Segmente, kein Backslash, kein kodierter Schrägstrich oder Punkt */
export function allowedPath(path: string): boolean {
  const q = path.indexOf("?");
  const pathPart = q < 0 ? path : path.slice(0, q);
  if (!pathPart.startsWith("/") || /\\|%2f|%2e|%5c/i.test(pathPart)) return false;
  let u: URL;
  try {
    u = new URL(`https://api.discogs.com${pathPart}`);
  } catch {
    return false;
  }
  // Normalisierung (z. B. /users/../) darf den Pfad nicht verändern
  if (u.host !== "api.discogs.com" || u.pathname !== pathPart) return false;
  return ALLOWED.test(path);
}

app.all("/api/discogs/*", async (c) => {
  const cfg = c.var.cfg;
  const s = await tokenSession(c);
  if (!s && !cfg.discogsPersonalToken) return c.json({ message: "Nicht angemeldet" }, 401);
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/discogs/, "") + url.search;
  const method = c.req.method;
  if (!allowedPath(path)) return c.json({ message: "Pfad nicht erlaubt" }, 403);
  // Persönlicher Token (nur lokal gedacht): ohne Anmeldung nur lesen
  if (!s && method !== "GET") return c.json({ message: "Nicht angemeldet" }, 401);
  const body = ["POST", "PUT"].includes(method) ? await c.req.text() : undefined;
  const r = await discogsFetch(cfg, s, path, { method, body: body || undefined });
  const headers = new Headers({ "Content-Type": r.headers.get("Content-Type") ?? "application/json" });
  for (const h of ["X-Discogs-Ratelimit", "X-Discogs-Ratelimit-Remaining", "X-Discogs-Ratelimit-Used"]) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(r.status === 204 ? null : await r.arrayBuffer(), { status: r.status, headers });
});

// ---------- Erkennung & Vibes ----------
app.post("/api/ai/recognize", async (c) => {
  if (!(await aiAccess(c))) return c.json({ message: "Bitte anmelden" }, 401);
  const { image, mediaType } = await c.req.json<{ image: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }>();
  if (!image || image.length > 7_000_000) return c.json({ message: "Bild fehlt oder ist zu groß" }, 400);
  return c.json({ ...(await recognizeRecordFree(c.var.cfg.ai!, image, mediaType ?? "image/jpeg")), engine: "workers-ai" });
});

app.post("/api/ai/vibes", async (c) => {
  if (!(await aiAccess(c))) return c.json({ message: "Bitte anmelden" }, 401);
  const { items } = await c.req.json<{ items: VibeInput[] }>();
  return c.json({ items: await tagVibesFree(c.var.cfg.ai!, (items ?? []).slice(0, 25)), engine: "workers-ai" });
});

// ---------- Audio-Daten ----------
// Nur für Angemeldete: die Routen nutzen Betreiber-Schlüssel und bis zu 45 Unteranfragen je Aufruf
// Hörproben bleiben offen: das Audio-Element (vor allem auf dem iPhone) schickt das Cookie nicht
// zuverlässig mit, und eine Hörprobe kostet nur ein bis zwei Deezer-Anfragen ohne Betreiber-Schlüssel.
for (const p of ["/api/audio/lookup", "/api/audio/release", "/api/lastfm/*"]) {
  app.use(p, async (c, next) => {
    if (!(await tokenSession(c))) return c.json({ message: "Bitte anmelden" }, 401);
    await next();
  });
}

/** Deezer bremst gerade: 503, damit das Gerät nichts als „nicht gefunden“ merkt und es später nochmal versucht */
const deezerBusy = (c: C) => {
  c.header("Retry-After", "5");
  return c.json({ message: "Deezer ist gerade ausgelastet" }, 503);
};

app.get("/api/audio/lookup", async (c) => {
  const title = c.req.query("title") ?? "";
  if (!title) return c.json({ message: "title fehlt" }, 400);
  try {
    return c.json(await lookupAudio(c.var.cfg, c.req.query("artist") ?? "", title, Number(c.req.query("duration")) || null));
  } catch (e) {
    if (e instanceof DeezerBusy) return deezerBusy(c);
    throw e;
  }
});

app.post("/api/audio/release", async (c) => {
  const { artist, title, tracks } = await c.req.json<{ artist: string; title: string; tracks: ReleaseTrackIn[] }>();
  if (!title || !Array.isArray(tracks)) return c.json({ message: "title und tracks nötig" }, 400);
  try {
    return c.json(await matchRelease(artist ?? "", title, tracks.slice(0, 40)));
  } catch (e) {
    if (e instanceof DeezerBusy) return deezerBusy(c);
    throw e;
  }
});

app.get("/api/audio/preview/:id", (c) => fetchPreviewById(Number(c.req.param("id"))));

app.get("/api/audio/preview", (c) => fetchPreview(c.req.query("artist") ?? "", c.req.query("title") ?? "", Number(c.req.query("duration")) || null, c.req.query("warm") === "1"));

app.get("/api/lastfm/tags", async (c) => {
  if (!c.var.cfg.lastfmKey) return c.json({ message: "LASTFM_API_KEY fehlt" }, 501);
  return c.json(await lastfmTags(c.var.cfg, c.req.query("artist") ?? "", c.req.query("track") ?? ""));
});

// ---------- Story-Bild für die Android-App ----------
// Die Webseite kann ein Bild nicht direkt an Instagram geben. Sie legt es kurz hier ab (10 Minuten,
// zufällige Adresse), die Android-App holt es einmal ab und reicht es an den Story-Editor weiter.
const STORY_MAX = 3 * 1024 * 1024;
app.post("/api/story", async (c) => {
  if (!(await tokenSession(c))) return c.json({ message: "nicht angemeldet" }, 401);
  const type = (c.req.header("content-type") ?? "").split(";")[0];
  if (type !== "image/jpeg" && type !== "image/png") return c.json({ message: "nur Bilder" }, 415);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (!buf.length || buf.length > STORY_MAX) return c.json({ message: "Bild zu groß" }, 413);
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  await c.var.cfg.kv.put(`story:${id}`, JSON.stringify({ t: type, d: btoa(bin) }), { expirationTtl: 600 });
  return c.json({ id });
});
app.get("/api/story/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-f0-9]{32}$/.test(id)) return c.json({ message: "nicht gefunden" }, 404);
  const raw = await c.var.cfg.kv.get(`story:${id}`);
  if (!raw) return c.json({ message: "nicht gefunden" }, 404);
  // Einmal abholen, dann ist es weg
  await c.var.cfg.kv.delete(`story:${id}`);
  const { t, d } = JSON.parse(raw) as { t: string; d: string };
  const bin = atob(d);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Response(out, { headers: { "Content-Type": t, "Cache-Control": "no-store" } });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ message: err.message }, 500);
});

// ---------- Push-Mitteilungen ----------
/** Nur bekannte Arten mit Ja/Nein übernehmen */
const cleanPrefs = (p: unknown): Partial<UserRec["prefs"]> => {
  const out: Partial<UserRec["prefs"]> = {};
  if (p && typeof p === "object") for (const k of ALL_KINDS) if (typeof (p as Record<string, unknown>)[k] === "boolean") out[k] = (p as Record<string, boolean>)[k];
  return out;
};
const emptyRec = (sess: string): UserRec => ({ subs: [], prefs: { ...KIND_DEFAULT }, sess, wants: [], lent: [], sets: [], cursor: 0, sent: {}, updatedAt: Date.now() });

/** Gerät für Mitteilungen anmelden. Merkt sich den Discogs-Zugang (versiegelt), damit der Zeitplan Wants prüfen kann. */
app.post("/api/push/subscribe", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const { subscription, prefs } = await c.req.json<{ subscription: PushSub; prefs?: Partial<UserRec["prefs"]> }>();
  if (!subscription?.endpoint || !isPushEndpoint(subscription.endpoint) || typeof subscription.keys?.p256dh !== "string" || typeof subscription.keys?.auth !== "string") return c.json({ message: "ungültiges Abo" }, 400);
  const known = await loadUser(cfg.kv, s.username);
  const rec = known ?? emptyRec("");
  // Wer Mitteilungen gerade erst einschaltet, hat die aktuelle Version schon: keine alte Update-Mitteilung nachreichen
  if (!deviceCount(known) && ANNOUNCE) rec.announce = ANNOUNCE.id;
  rec.sess = await seal(cfg.sessionSecret, { token: s.token, secret: s.secret, username: s.username });
  rec.subs = [...rec.subs.filter((x) => x.endpoint !== subscription.endpoint), { endpoint: subscription.endpoint, keys: subscription.keys, addedAt: Date.now() }].slice(-5);
  if (prefs) rec.prefs = { ...rec.prefs, ...cleanPrefs(prefs) };
  await saveUser(cfg.kv, s.username, rec);
  // Liegen gebliebene Freundschaftsanfragen nachreichen
  const pending = JSON.parse((await cfg.kv.get(`pending:${s.username.toLowerCase()}`)) ?? "[]") as string[];
  if (pending.length) {
    await cfg.kv.delete(`pending:${s.username.toLowerCase()}`);
    const names = [...new Set(pending)];
    await notifyUser(cfg.kv, cfg.push, s.username, rec, "friends", {
      title: names.length === 1 ? "Neue Freundschaft auf Crate" : `${names.length} neue Freundschaften auf Crate`,
      body: names.length === 1 ? `${names[0]} hat dich als Freund hinzugefügt.` : `${names.join(", ")} haben dich hinzugefügt.`,
      url: names.length === 1 ? `/friends?add=${encodeURIComponent(names[0])}` : "/friends",
      tag: "friends",
    });
  }
  return c.json({ ok: true, prefs: rec.prefs });
});

app.post("/api/push/unsubscribe", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ ok: true });
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  const rec = await loadUser(cfg.kv, s.username);
  if (!rec) return c.json({ ok: true });
  rec.subs = endpoint ? rec.subs.filter((x) => x.endpoint !== endpoint) : [];
  // Ohne Geräte nichts mehr aufbewahren
  if (!deviceCount(rec)) await cfg.kv.delete(userKey(s.username));
  else await saveUser(cfg.kv, s.username, rec);
  return c.json({ ok: true });
});

app.get("/api/push/status", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  const rec = s?.username ? await loadUser(cfg.kv, s.username) : null;
  return c.json({ available: Boolean(cfg.push.privateJwk), devices: deviceCount(rec), prefs: rec?.prefs ?? null });
});

app.post("/api/push/prefs", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const rec = await loadUser(cfg.kv, s.username);
  if (!rec) return c.json({ message: "Mitteilungen sind aus" }, 404);
  rec.prefs = { ...rec.prefs, ...cleanPrefs(await c.req.json()) };
  await saveUser(cfg.kv, s.username, rec);
  return c.json({ prefs: rec.prefs });
});

/** Daten für den Zeitplan: Wants mit Wunschpreisen, verliehene Platten, Set-Termine */
app.post("/api/push/sync", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const rec = await loadUser(cfg.kv, s.username);
  if (!rec) return c.json({ ok: false });
  const body = await c.req.json<{ wants?: WatchedWant[]; lent?: UserRec["lent"]; sets?: UserRec["sets"]; currency?: string; tz?: number; stylus?: UserRec["stylus"] | null; daily?: UserRec["daily"] }>();
  if (body.wants && !Array.isArray(body.wants)) return c.json({ message: "ungültig" }, 400);
  if (body.lent && !Array.isArray(body.lent)) return c.json({ message: "ungültig" }, 400);
  if (body.sets && !Array.isArray(body.sets)) return c.json({ message: "ungültig" }, 400);
  if (body.wants) {
    const old = new Map(rec.wants.map((w) => [w.id, w]));
    rec.wants = body.wants.slice(0, 500).map((w) => ({ id: Number(w.id), t: String(w.t).slice(0, 120), a: String(w.a).slice(0, 80), target: Number.isFinite(Number(w.target)) && Number(w.target) > 0 ? Number(w.target) : null, n: old.get(Number(w.id))?.n ?? null, low: old.get(Number(w.id))?.low ?? null }));
  }
  if (body.lent) rec.lent = body.lent.slice(0, 200).map((l) => ({ id: Number(l.id), t: String(l.t).slice(0, 120), to: String(l.to).slice(0, 60), at: Number(l.at) }));
  if (body.sets)
    rec.sets = body.sets
      .slice(0, 100)
      .filter((x) => /^\d{4}-\d\d-\d\d$/.test(x.date))
      .map((x) => ({ id: Number(x.id), name: cleanText(String(x.name), 80), date: x.date, ...(typeof x.start === "string" && /^\d\d:\d\d$/.test(x.start) ? { start: x.start } : {}), ...(Number(x.n) > 0 ? { n: Math.min(999, Math.round(Number(x.n))) } : {}) }));
  // Zeitzone des Geräts (Minuten, wie getTimezoneOffset): Erinnerungen kommen zur Ortszeit
  if (typeof body.tz === "number" && Number.isFinite(body.tz) && Math.abs(body.tz) <= 14 * 60) rec.tz = Math.round(body.tz);
  if (body.stylus === null) delete rec.stylus;
  else if (body.stylus && Number.isFinite(Number(body.stylus.pct))) rec.stylus = { pct: Math.max(0, Math.min(1, Number(body.stylus.pct))), ...(body.stylus.name ? { name: cleanText(String(body.stylus.name), 60) } : {}) };
  if (Array.isArray(body.daily))
    rec.daily = body.daily
      .slice(0, 10)
      .filter((x) => x && /^\d{4}-\d\d-\d\d$/.test(String(x.d)) && Number(x.id) > 0)
      .map((x) => ({ d: String(x.d), id: Number(x.id), t: cleanText(String(x.t ?? ""), 120), a: cleanText(String(x.a ?? ""), 80), ...(x.why ? { why: cleanText(String(x.why), 80) } : {}) }));
  if (body.currency) rec.currency = body.currency.slice(0, 3);
  await saveUser(cfg.kv, s.username, rec);
  return c.json({ ok: true, wants: rec.wants.length });
});

/** Jemand hat jemanden als Freund hinzugefügt: Bescheid geben (einmal pro Paar und Monat) */
app.post("/api/push/friend-added", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const { friend } = await c.req.json<{ friend: string }>();
  if (!/^[\w.\-]{2,40}$/.test(friend ?? "") || friend.toLowerCase() === s.username.toLowerCase()) return c.json({ ok: false });
  const pairKey = `fa:${s.username.toLowerCase()}:${friend.toLowerCase()}`;
  if (await cfg.kv.get(pairKey)) return c.json({ ok: true, status: "schon-gemeldet" });
  await cfg.kv.put(pairKey, "1", { expirationTtl: 30 * 86_400 });
  const rec = await loadUser(cfg.kv, friend);
  if (rec && deviceCount(rec)) {
    const n = await notifyUser(cfg.kv, cfg.push, friend, rec, "friends", { title: "Neue Freundschaft auf Crate", body: `${s.username} hat dich als Freund hinzugefügt. Tippen, um zurück zu folgen.`, url: `/friends?add=${encodeURIComponent(s.username)}`, tag: `friend-${s.username}` });
    return c.json({ ok: true, status: n ? "zugestellt" : "aus" });
  }
  // Noch keine Mitteilungen an: merken und nachreichen, sobald er sie einschaltet
  const key = `pending:${friend.toLowerCase()}`;
  const list = JSON.parse((await cfg.kv.get(key)) ?? "[]") as string[];
  await cfg.kv.put(key, JSON.stringify([...new Set([...list, s.username])].slice(-20)), { expirationTtl: 60 * 86_400 });
  return c.json({ ok: true, status: "wartet" });
});

// ---------- Freundschaften: Anfrage, Annehmen, Ablehnen (nur mit bestätigtem Discogs-Namen) ----------
// Je Nutzer ein Eintrag im KV: wer befreundet ist, wer angefragt hat, wen man selbst angefragt hat.
interface Social { friends: string[]; in: { from: string; at: number }[]; out: string[] }
const socKey = (u: string) => `soc:${u.toLowerCase()}`;
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const without = (list: string[], u: string) => list.filter((x) => !sameName(x, u));
async function loadSocial(kv: Config["kv"], u: string): Promise<Social> {
  try {
    const j = JSON.parse((await kv.get(socKey(u))) ?? "null") as Partial<Social> | null;
    return { friends: j?.friends ?? [], in: j?.in ?? [], out: j?.out ?? [] };
  } catch {
    return { friends: [], in: [], out: [] };
  }
}
const saveSocial = (kv: Config["kv"], u: string, s: Social) =>
  s.friends.length || s.in.length || s.out.length ? kv.put(socKey(u), JSON.stringify({ friends: s.friends.slice(-500), in: s.in.slice(-100), out: s.out.slice(-100) })) : kv.delete(socKey(u));
const validName = (u: unknown): u is string => typeof u === "string" && /^[\w.\-]{2,40}$/.test(u);
/** Mitteilung an einen anderen Nutzer, falls er sie eingeschaltet hat */
async function tellFriend(cfg: Config, to: string, msg: Message) {
  const rec = await loadUser(cfg.kv, to);
  // Soziales soll sofort ankommen, nicht erst, wenn das Handy aufwacht
  if (rec && deviceCount(rec)) await notifyUser(cfg.kv, cfg.push, to, rec, "friends", { ...msg, urgent: true }).catch(() => 0);
}
async function befriend(cfg: Config, me: string, other: string, mine: Social, theirs: Social) {
  mine.friends = [...without(mine.friends, other), other];
  mine.out = without(mine.out, other);
  mine.in = mine.in.filter((x) => !sameName(x.from, other));
  theirs.friends = [...without(theirs.friends, me), me];
  theirs.out = without(theirs.out, me);
  theirs.in = theirs.in.filter((x) => !sameName(x.from, me));
  await Promise.all([saveSocial(cfg.kv, me, mine), saveSocial(cfg.kv, other, theirs)]);
}

app.get("/api/friends", async (c) => {
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  c.header("Cache-Control", "no-store");
  return c.json(await loadSocial(c.var.cfg.kv, s.username));
});

app.post("/api/friends/request", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const { to } = ((await c.req.json().catch(() => null)) ?? {}) as { to?: unknown };
  if (!validName(to) || sameName(to, s.username)) return c.json({ message: "Name ungültig" }, 400);
  const me = s.username;
  const [mine, theirs] = await Promise.all([loadSocial(cfg.kv, me), loadSocial(cfg.kv, to)]);
  if (mine.friends.some((x) => sameName(x, to))) return c.json({ status: "befreundet" });
  // Der andere hat schon angefragt: dann ist es eine Zusage
  if (mine.in.some((x) => sameName(x.from, to))) {
    await befriend(cfg, me, to, mine, theirs);
    await tellFriend(cfg, to, { title: "Ihr seid jetzt befreundet", body: `${me} hat deine Anfrage angenommen.`, url: `/friends/${encodeURIComponent(me)}`, tag: `friend-${me}` });
    return c.json({ status: "befreundet" });
  }
  if (mine.out.some((x) => sameName(x, to))) return c.json({ status: "angefragt" });
  if (mine.out.length >= 100) return c.json({ message: "Zu viele offene Anfragen" }, 400);
  mine.out = [...mine.out, to];
  theirs.in = [...theirs.in.filter((x) => !sameName(x.from, me)), { from: me, at: Date.now() }];
  await Promise.all([saveSocial(cfg.kv, me, mine), saveSocial(cfg.kv, to, theirs)]);
  await tellFriend(cfg, to, { title: "Freundschaftsanfrage", body: `${me} möchte auf Crate mit dir befreundet sein.`, url: "/friends", tag: `friend-${me}` });
  return c.json({ status: "angefragt" });
});

app.post("/api/friends/respond", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const { from, accept } = ((await c.req.json().catch(() => null)) ?? {}) as { from?: unknown; accept?: unknown };
  if (!validName(from)) return c.json({ message: "Name ungültig" }, 400);
  const me = s.username;
  const [mine, theirs] = await Promise.all([loadSocial(cfg.kv, me), loadSocial(cfg.kv, from)]);
  if (!mine.in.some((x) => sameName(x.from, from))) return c.json({ message: "Keine Anfrage von diesem Namen" }, 404);
  if (accept) {
    await befriend(cfg, me, from, mine, theirs);
    await tellFriend(cfg, from, { title: "Ihr seid jetzt befreundet", body: `${me} hat deine Anfrage angenommen.`, url: `/friends/${encodeURIComponent(me)}`, tag: `friend-${me}` });
    return c.json({ status: "befreundet" });
  }
  // Ablehnen bleibt still: der andere bekommt keine Mitteilung
  mine.in = mine.in.filter((x) => !sameName(x.from, from));
  theirs.out = without(theirs.out, me);
  await Promise.all([saveSocial(cfg.kv, me, mine), saveSocial(cfg.kv, from, theirs)]);
  return c.json({ status: "abgelehnt" });
});

/** Freundschaft beenden oder eigene Anfrage zurückziehen */
app.post("/api/friends/remove", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const { user } = ((await c.req.json().catch(() => null)) ?? {}) as { user?: unknown };
  if (!validName(user)) return c.json({ message: "Name ungültig" }, 400);
  const me = s.username;
  const [mine, theirs] = await Promise.all([loadSocial(cfg.kv, me), loadSocial(cfg.kv, user)]);
  mine.friends = without(mine.friends, user);
  mine.out = without(mine.out, user);
  mine.in = mine.in.filter((x) => !sameName(x.from, user));
  theirs.friends = without(theirs.friends, me);
  theirs.out = without(theirs.out, me);
  theirs.in = theirs.in.filter((x) => !sameName(x.from, me));
  await Promise.all([saveSocial(cfg.kv, me, mine), saveSocial(cfg.kv, user, theirs)]);
  return c.json({ ok: true });
});

// ---------- Mitteilungen in der Android-App ohne Browser (siehe server/native.ts) ----------
const NATIVE_TOKEN = /^[a-f0-9]{64}$/;
const newToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Einschalten: Kennwort für dieses Gerät ausstellen. Die Webseite reicht es über crate://push an die App. */
app.post("/api/push/native/start", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const body = await c.req.json<{ prefs?: Partial<UserRec["prefs"]>; replace?: string }>().catch(() => ({}) as { prefs?: Partial<UserRec["prefs"]>; replace?: string });
  const store = nativeStore(c.env ?? {});
  const user = s.username.toLowerCase();
  const known = await loadUser(cfg.kv, s.username);
  const rec = known ?? emptyRec("");
  if (!deviceCount(known) && ANNOUNCE) rec.announce = ANNOUNCE.id;
  rec.sess = await seal(cfg.sessionSecret, { token: s.token, secret: s.secret, username: s.username });
  let list = rec.native ?? [];
  // Das alte Kennwort dieses Geräts ersetzen (Schalter erneut angetippt)
  if (body.replace && NATIVE_TOKEN.test(body.replace) && list.includes(body.replace)) {
    await store.remove(body.replace);
    list = list.filter((t) => t !== body.replace);
  }
  const token = newToken();
  await store.link(token, user, Date.now());
  list = [...list, token];
  // Höchstens fünf Geräte: die ältesten fallen weg
  for (const old of list.slice(0, -5)) await store.remove(old);
  rec.native = list.slice(-5);
  if (body.prefs) rec.prefs = { ...rec.prefs, ...cleanPrefs(body.prefs) };
  await saveUser(cfg.kv, s.username, rec);
  // Erscheint, sobald die App das erste Mal abholt: so sieht man gleich, dass es geht
  await store.enqueue([token], { title: "Mitteilungen sind an", body: "Crate meldet sich ab jetzt direkt aus der App: Wantlist, Freunde, Gigs.", url: "/settings/notifications", tag: "welcome" });
  return c.json({ token, prefs: rec.prefs });
});

/** Hat die App das Kennwort übernommen, und erlaubt Android ihr Mitteilungen? */
app.get("/api/push/native/status", async (c) => {
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const t = c.req.query("t") ?? "";
  const d = NATIVE_TOKEN.test(t) ? await nativeStore(c.env ?? {}).device(t) : null;
  if (!d || d.user !== s.username.toLowerCase()) return c.json({ known: false, linked: false, ok: false });
  // seen, src, exempt und waiting zeigen in den Einstellungen, ob und wann die App zuletzt abgeholt hat
  return c.json({ known: true, linked: d.seen != null, ok: d.ok, seen: d.seen, src: d.src ?? null, v: d.v ?? null, exempt: d.exempt ?? null, waiting: await nativeStore(c.env ?? {}).waiting(t) });
});

app.post("/api/push/native/stop", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ ok: true });
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
  const store = nativeStore(c.env ?? {});
  const rec = await loadUser(cfg.kv, s.username);
  if (token && NATIVE_TOKEN.test(token)) {
    const d = await store.device(token);
    if (d?.user === s.username.toLowerCase()) await store.remove(token);
  }
  if (rec) {
    rec.native = (rec.native ?? []).filter((t) => t !== token);
    if (!deviceCount(rec)) await cfg.kv.delete(userKey(s.username));
    else await saveUser(cfg.kv, s.username, rec);
  }
  return c.json({ ok: true });
});

/** Mitteilung vom eigenen Gerät (z. B. neue Pressung nach dem Abgleich): wartet, bis die App abholt */
app.post("/api/push/native/self", async (c) => {
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const b = await c.req.json<{ token?: string; title?: string; body?: string; url?: string; tag?: string }>().catch(() => ({}) as { token?: string; title?: string; body?: string; url?: string; tag?: string });
  const store = nativeStore(c.env ?? {});
  const d = b.token && NATIVE_TOKEN.test(b.token) ? await store.device(b.token) : null;
  if (!d || d.user !== s.username.toLowerCase() || !b.title) return c.json({ ok: false });
  const url = typeof b.url === "string" && b.url.startsWith("/") && !b.url.startsWith("//") ? b.url.slice(0, 200) : "/";
  await store.enqueue([b.token!], { title: cleanText(b.title, 120), body: cleanText(b.body ?? "", 400), url, tag: cleanText(b.tag ?? "", 40) || undefined });
  return c.json({ ok: true });
});

/**
 * Die App holt ab. Ohne Anmeldung: das Kennwort ist der Ausweis (die App hat kein Cookie).
 * 410 = dieses Gerät ist abgemeldet, die App hört auf zu fragen.
 */
app.get("/api/push/native/poll", async (c) => {
  const t = c.req.query("t") ?? "";
  const store = nativeStore(c.env ?? {});
  const d = NATIVE_TOKEN.test(t) ? await store.device(t) : null;
  c.header("Cache-Control", "no-store");
  if (!d) return c.json({ message: "abgemeldet" }, 410);
  const ok = c.req.query("ok") === "1";
  const now = Date.now();
  // Jeden Abruf festhalten (rund hundert Schreibvorgänge am Tag je Gerät): so sieht man, ob die App wirklich abholt
  const src = (c.req.query("src") ?? "").replace(/[^a-z]/g, "").slice(0, 8) || undefined;
  const ex = c.req.query("ex");
  await store.touch(t, ok, now, { src, v: Number(c.req.query("v")) || undefined, exempt: ex === "1" ? true : ex === "0" ? false : undefined });
  // Solange Android nichts zeigen lässt, bleibt alles liegen
  const messages = ok ? await store.take(t) : [];
  // Die App erfährt hier auch, ob es eine neuere Version von ihr gibt, und bietet dann das Update an
  return c.json({ messages, every: 15, apk: APK.code, apkName: APK.name });
});

app.post("/api/push/test", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const rec = await loadUser(cfg.kv, s.username);
  if (!rec || !deviceCount(rec)) return c.json({ message: "Auf diesem Gerät sind Mitteilungen aus" }, 404);
  const test: Message = { title: "Crate", body: "So sehen Mitteilungen aus. Alles eingerichtet.", url: "/settings/notifications", tag: "test", urgent: true };
  let ok = await sendNative(cfg.push, rec, test);
  for (const sub of rec.subs) if ((await sendPush(cfg.push, sub, test)) === "ok") ok++;
  return c.json({ sent: ok, devices: deviceCount(rec) });
});

/** Für den Zeitplan-Worker: alle Nutzer mit Mitteilungen (er ruft dann für jeden /api/push/run?u= auf) */
app.post("/api/push/users", async (c) => {
  const cfg = c.var.cfg;
  if (!sameSecret(c.req.header("X-Cron-Secret"), cfg.cronSecret)) return c.json({ message: "nein" }, 403);
  const users: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await cfg.kv.list({ prefix: "u:", cursor });
    users.push(...page.keys.map((k) => k.name.slice(2)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return c.json({ users });
});

/** Einen Nutzer prüfen: fällige Erinnerungen und eine Runde Wants (wichtige zuerst) */
async function runUser(cfg: Config, u: string, budget: number) {
  const rec = await loadUser(cfg.kv, u);
  if (!rec || !deviceCount(rec)) return { u, skipped: true };
  const startSubs = new Set(rec.subs.map((x) => x.endpoint));
  let changed = false;
  for (const d of dueReminders(rec)) {
    budget -= rec.subs.length;
    await notifyUser(cfg.kv, cfg.push, u, rec, d.kind, d.msg);
    rec.sent[d.key] = Date.now();
    changed = true;
  }
  // Update-Mitteilung: jeder bekommt sie genau einmal, unabhängig von den gewählten Arten
  if (ANNOUNCE && rec.announce !== ANNOUNCE.id) {
    budget -= rec.subs.length;
    const keep: UserRec["subs"] = [];
    await sendNative(cfg.push, rec, { title: ANNOUNCE.title, body: ANNOUNCE.body, url: ANNOUNCE.url, tag: "update" });
    for (const sub of rec.subs) if ((await sendPush(cfg.push, sub, { title: ANNOUNCE.title, body: ANNOUNCE.body, url: ANNOUNCE.url, tag: "update" })) !== "gone") keep.push(sub);
    rec.subs = keep;
    rec.announce = ANNOUNCE.id;
    changed = true;
  }
  const msgs: Message[] = [];
  let checked = 0;
  if (kindOn(rec, "wants") && rec.wants.length) {
    const sess = await unseal<Session>(cfg.sessionSecret, rec.sess);
    const picks = pickWants(rec.wants, currentSlot()).slice(0, Math.max(0, budget - rec.subs.length - 1));
    for (const idx of picks) {
      const w = rec.wants[idx];
      const r = await fetch(`https://api.discogs.com/marketplace/stats/${w.id}?curr_abbr=${rec.currency ?? "EUR"}`, { headers: authHeaders(cfg, sess) }).catch(() => null);
      checked++;
      if (!r || r.status === 429) break; // Discogs gerade gedrosselt: nächste Runde weiter
      if (!r.ok) continue;
      const st = (await r.json()) as Stat;
      const m = wantChange(w, st, rec.currency ?? "EUR");
      if (m) msgs.push(m);
      const n = st.num_for_sale ?? 0;
      const low = st.lowest_price?.value ?? null;
      // Nur speichern, wenn sich etwas geändert hat (schont das Schreib-Kontingent)
      if (w.n !== n || w.low !== low) {
        rec.wants[idx] = { ...w, n, low };
        changed = true;
      }
    }
  }
  const b = bundle(msgs);
  if (b) await notifyUser(cfg.kv, cfg.push, u, rec, "wants", b);
  for (const [k, t] of Object.entries(rec.sent))
    if (Date.now() - t > 120 * 86_400_000) {
      delete rec.sent[k];
      changed = true;
    }
  if (changed) {
    // Kurz vor dem Speichern neu lesen: Geräte, die während der Runde dazukamen, nicht überschreiben
    const fresh = await loadUser(cfg.kv, u);
    if (fresh) {
      const removed = new Set([...startSubs].filter((e) => !rec.subs.some((x) => x.endpoint === e)));
      rec.subs = fresh.subs.filter((x) => !removed.has(x.endpoint));
      rec.native = fresh.native;
      rec.prefs = fresh.prefs;
      rec.sess = fresh.sess;
    }
    await saveUser(cfg.kv, u, rec);
  }
  return { u, checked, sent: msgs.length };
}

/**
 * Zeitplan (alle 10 Minuten vom Worker crate-cron). Mit ?u= nur dieser Nutzer:
 * jeder Aufruf hat sein eigenes Budget an Unteranfragen (~50 bei Cloudflare).
 */
app.post("/api/push/run", async (c) => {
  const cfg = c.var.cfg;
  if (!sameSecret(c.req.header("X-Cron-Secret"), cfg.cronSecret)) return c.json({ message: "nein" }, 403);
  const u = c.req.query("u");
  if (u) return c.json(await runUser(cfg, u, 45));
  // Ohne Nutzer: alle nacheinander mit geteiltem Budget (Rückfall für alte Worker)
  const keys = (await cfg.kv.list({ prefix: "u:" })).keys.map((k) => k.name.slice(2));
  const done = [];
  for (const name of keys.slice(0, 3)) done.push(await runUser(cfg, name, 14));
  return c.json({ users: keys.length, done });
});

// ---------- Freunde finden: freiwilliges Crate-Verzeichnis ----------
// Discogs bietet keine Personensuche. Wer möchte, wird für andere Crate-Nutzer auffindbar.
// Schlüssel: dir:<name klein> (Discogs-Name) und dirn:<echter Name normalisiert>:<name> für die Suche nach Teilen.
interface DirEntry {
  username: string;
  name?: string;
  avatar?: string;
  location?: string;
  records?: number;
}
/**
 * Suchwörter eines Nutzers aus Echtname (Verzeichnis) und DJ-Name (Profil) gemeinsam neu aufbauen.
 * Die aktuellen Wörter stehen unter dirk:<name>, damit nichts doppelt gelöscht oder vergessen wird.
 */
async function rebuildNameKeys(cfg: Config, u: string) {
  const [dir, prof, prev] = await Promise.all([cfg.kv.get(`dir:${u}`), cfg.kv.get(`prof:${u}`), cfg.kv.get(`dirk:${u}`)]);
  const old = JSON.parse(prev ?? "[]") as string[];
  const names = dir ? [(JSON.parse(dir) as DirEntry).name ?? "", prof ? ((JSON.parse(prof) as CrateProfile).djName ?? "") : ""] : [];
  const parts = [...new Set(names.flatMap((n) => norm(n).split(" ").slice(0, 4)).filter((x) => x.length > 1))];
  for (const p of old) if (!parts.includes(p)) await cfg.kv.delete(`dirn:${p}:${u}`);
  for (const p of parts) if (!old.includes(p)) await cfg.kv.put(`dirn:${p}:${u}`, u);
  if (parts.length) await cfg.kv.put(`dirk:${u}`, JSON.stringify(parts));
  else await cfg.kv.delete(`dirk:${u}`);
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

app.post("/api/dir/me", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const b = await c.req.json<{ visible: boolean } & Omit<DirEntry, "username">>();
  const u = s.username.toLowerCase();
  if (!b.visible) {
    await cfg.kv.delete(`dir:${u}`);
    await rebuildNameKeys(cfg, u);
    return c.json({ visible: false });
  }
  const e: DirEntry = { username: s.username, name: b.name?.slice(0, 80) || undefined, avatar: /^https:\/\/(i|st|img)\.discogs\.com\//.test(b.avatar ?? "") ? b.avatar!.slice(0, 300) : undefined, location: b.location?.slice(0, 80) || undefined, records: Number(b.records) || undefined };
  await cfg.kv.put(`dir:${u}`, JSON.stringify(e));
  // Vor- und Nachname (und DJ-Name aus dem Profil) einzeln suchbar machen
  await rebuildNameKeys(cfg, u);
  return c.json({ visible: true });
});

app.get("/api/dir/me", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ visible: false });
  return c.json({ visible: Boolean(await cfg.kv.get(`dir:${s.username.toLowerCase()}`)) });
});

app.get("/api/dir/search", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ results: [] }, 401);
  const q = norm(c.req.query("q") ?? "").split(" ")[0] ?? "";
  if (q.length < 2) return c.json({ results: [] });
  const me = s.username.toLowerCase();
  const [byUser, byName] = await Promise.all([cfg.kv.list({ prefix: `dir:${q}` }), cfg.kv.list({ prefix: `dirn:${q}` })]);
  const names = [...new Set([...byUser.keys.map((k) => k.name.slice(4)), ...byName.keys.map((k) => k.name.split(":")[2])])].filter((u) => u && u !== me).slice(0, 8);
  // Mit Crate-Profil anreichern: DJ-Name und Anfang der Bio für die Vorschläge
  const results = (
    await Promise.all(
      names.map(async (u) => {
        const [d, p] = await Promise.all([cfg.kv.get(`dir:${u}`), cfg.kv.get(profKey(u))]);
        if (!d) return null;
        const prof = p ? (JSON.parse(p) as CrateProfile) : null;
        return { ...(JSON.parse(d) as DirEntry), djName: prof?.djName, bio: prof?.bio?.slice(0, 90) };
      }),
    )
  ).filter(Boolean);
  return c.json({ results });
});

// ---------- Crate-Profil (für Freunde sichtbar, nur für angemeldete Crate-Nutzer) ----------
const profKey = (u: string) => `prof:${u.toLowerCase()}`;

app.get("/api/profile/me", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  return c.json({ profile: JSON.parse((await cfg.kv.get(profKey(s.username))) ?? "null") });
});

// ---------- Soziales im Freunde-Feed: Reaktionen, Kommentare, Empfehlungen, Aktivität ----------
// Nur unter Freunden (Server prüft die Freundschaft) und nur mit bestätigtem Discogs-Namen.
const low = (u: string) => u.toLowerCase();
async function buzzContext(c: C) {
  const s = await session(c);
  if (!s?.username) return null;
  const soc = await loadSocial(c.var.cfg.kv, s.username);
  return { me: low(s.username), name: s.username, friends: soc.friends.map(low), store: buzzStore(c.env ?? {}) };
}
const BUZZ_DAYS = 120;

app.get("/api/buzz", async (c) => {
  const b = await buzzContext(c);
  if (!b) return c.json({ message: "nicht angemeldet" }, 401);
  c.header("Cache-Control", "no-store");
  const since = Date.now() - BUZZ_DAYS * 86_400_000;
  const [posts, inbox] = await Promise.all([b.store.forOwners([b.me, ...b.friends].slice(0, 400), since), b.store.inbox(b.me, 60)]);
  return c.json({ ...posts, inbox, unread: inbox.filter((i) => !i.read).length });
});

app.post("/api/buzz/react", async (c) => {
  const b = await buzzContext(c);
  if (!b) return c.json({ message: "nicht angemeldet" }, 401);
  const j = ((await c.req.json().catch(() => null)) ?? {}) as { owner?: unknown; post?: unknown; on?: unknown; title?: unknown; releaseId?: unknown };
  if (!validName(j.owner) || !validPost(j.post)) return c.json({ message: "ungültig" }, 400);
  const owner = low(j.owner);
  if (owner !== b.me && !b.friends.includes(owner)) return c.json({ message: "Nur unter Freunden" }, 403);
  const on = j.on !== false;
  const changed = await b.store.react({ owner, post: j.post, from: b.me, ts: Date.now() }, on);
  if (changed && on && owner !== b.me) {
    const title = cleanText(j.title, 140) || null;
    await b.store.notify({ to: owner, from: b.me, kind: "react", post: j.post, releaseId: Number(j.releaseId) || null, title, ts: Date.now() });
    await tellFriend(c.var.cfg, owner, { title: `${b.name} gefällt deine Platte`, body: title ?? "Schau in Crate nach", url: "/friends", tag: `react-${b.me}` });
  }
  return c.json({ ok: true, on });
});

app.post("/api/buzz/comment", async (c) => {
  const b = await buzzContext(c);
  if (!b) return c.json({ message: "nicht angemeldet" }, 401);
  const j = ((await c.req.json().catch(() => null)) ?? {}) as { owner?: unknown; post?: unknown; text?: unknown; title?: unknown; releaseId?: unknown };
  const text = cleanText(j.text, 280);
  if (!validName(j.owner) || !validPost(j.post) || !text) return c.json({ message: "ungültig" }, 400);
  const owner = low(j.owner);
  if (owner !== b.me && !b.friends.includes(owner)) return c.json({ message: "Nur unter Freunden" }, 403);
  // Bremse gegen Unfug: höchstens 40 Kommentare je Stunde
  if ((await b.store.commentsSince(b.me, Date.now() - 3_600_000)) >= 40) return c.json({ message: "Kurz Pause, das waren viele Kommentare" }, 429);
  const ts = Date.now();
  const id = await b.store.comment({ owner, post: j.post, from: b.me, text, ts });
  if (owner !== b.me) {
    const title = cleanText(j.title, 140) || null;
    await b.store.notify({ to: owner, from: b.me, kind: "comment", post: j.post, releaseId: Number(j.releaseId) || null, title, text, ts });
    await tellFriend(c.var.cfg, owner, { title: `${b.name} schreibt zu deiner Platte`, body: text, url: "/friends", tag: `comment-${id}` });
  }
  return c.json({ id, owner, post: j.post, from: b.me, text, ts });
});

app.delete("/api/buzz/comment/:id", async (c) => {
  const b = await buzzContext(c);
  if (!b) return c.json({ message: "nicht angemeldet" }, 401);
  const cm = await b.store.getComment(Number(c.req.param("id")) || 0);
  // Löschen darf, wer ihn geschrieben hat, und wem der Beitrag gehört
  if (!cm || (cm.from !== b.me && cm.owner !== b.me)) return c.json({ message: "nicht gefunden" }, 404);
  await b.store.deleteComment(cm.id);
  return c.json({ ok: true });
});

app.post("/api/buzz/recommend", async (c) => {
  const b = await buzzContext(c);
  if (!b) return c.json({ message: "nicht angemeldet" }, 401);
  const j = ((await c.req.json().catch(() => null)) ?? {}) as { to?: unknown; releaseId?: unknown; title?: unknown; text?: unknown };
  const releaseId = Number(j.releaseId);
  const title = cleanText(j.title, 140);
  if (!validName(j.to) || !Number.isInteger(releaseId) || releaseId <= 0 || !title) return c.json({ message: "ungültig" }, 400);
  const to = low(j.to);
  if (!b.friends.includes(to)) return c.json({ message: "Nur unter Freunden" }, 403);
  const text = cleanText(j.text, 280) || null;
  await b.store.notify({ to, from: b.me, kind: "recommend", releaseId, title, text, ts: Date.now() });
  await tellFriend(c.var.cfg, to, { title: `${b.name} empfiehlt dir eine Platte`, body: text ? `${title}: ${text}` : title, url: `/release/${releaseId}`, tag: `rec-${b.me}-${releaseId}` });
  return c.json({ ok: true });
});

// Eigener Beitrag im Feed der Freunde: Set gespielt, Platte des Moments
app.post("/api/buzz/post", async (c) => {
  const b = await buzzContext(c);
  if (!b) return c.json({ message: "nicht angemeldet" }, 401);
  const j = ((await c.req.json().catch(() => null)) ?? {}) as { kind?: unknown; ref?: unknown; data?: unknown; remove?: unknown };
  if ((j.kind !== "set" && j.kind !== "spot") || !validRef(j.ref)) return c.json({ message: "ungültig" }, 400);
  if (j.remove === true) {
    await b.store.removePost(b.me, j.kind, j.ref);
    return c.json({ ok: true });
  }
  const data = cleanOwnPost(j.kind, j.data);
  if (!data) return c.json({ message: "ungültig" }, 400);
  await b.store.post({ owner: b.me, kind: j.kind, ref: j.ref, data, ts: Date.now() });
  // Freunden Bescheid geben: einmal je Beitrag (spätere Änderungen daran melden nichts mehr)
  const cfg = c.var.cfg;
  const told = `fp:${b.me}:${j.kind}:${j.ref}`;
  if (!(await cfg.kv.get(told))) {
    await cfg.kv.put(told, "1", { expirationTtl: 60 * 86_400 });
    const d = data as { name?: string; tracks?: number; title?: string; artist?: string };
    const msg: Message =
      j.kind === "set"
        ? { title: `${b.name} hat ein Set gespielt`, body: `${d.name ?? "Set"}${d.tracks ? ` · ${d.tracks} Tracks` : ""}`, url: `/friends/${encodeURIComponent(b.name)}`, tag: `post-${b.me}` }
        : { title: `${b.name}: Platte des Moments`, body: [d.artist, d.title].filter(Boolean).join(" – "), url: `/friends/${encodeURIComponent(b.name)}`, tag: `post-${b.me}` };
    // Höchstens 20 Freunde je Beitrag (Cloudflare begrenzt die Unteranfragen je Aufruf)
    await Promise.all(b.friends.slice(0, 20).map((f) => tellFriend(cfg, f, msg)));
  }
  return c.json({ ok: true });
});

app.post("/api/buzz/read", async (c) => {
  const b = await buzzContext(c);
  if (!b) return c.json({ message: "nicht angemeldet" }, 401);
  await b.store.markRead(b.me);
  return c.json({ ok: true });
});

// ---------- Alles löschen (App Store / Play Store: Konto- und Datenlöschung in der App) ----------
app.delete("/api/me", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const u = s.username.toLowerCase();
  // Mitteilungen, Verzeichnis, Profil, wartende Freundes-Hinweise, Abgleich
  await Promise.all([cfg.kv.delete(userKey(u)), cfg.kv.delete(`dir:${u}`), cfg.kv.delete(profKey(u)), cfg.kv.delete(`pending:${u}`)]);
  await rebuildNameKeys(cfg, u);
  let cursor: string | undefined;
  do {
    const r = await cfg.kv.list({ prefix: `fa:${u}:`, cursor });
    await Promise.all(r.keys.map((k) => cfg.kv.delete(k.name)));
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  // Freundschaften: bei allen Beteiligten austragen
  const soc = await loadSocial(cfg.kv, u);
  for (const other of [...new Set([...soc.friends, ...soc.out, ...soc.in.map((x) => x.from)])].slice(0, 200)) {
    const t = await loadSocial(cfg.kv, other);
    await saveSocial(cfg.kv, other, { friends: without(t.friends, u), out: without(t.out, u), in: t.in.filter((x) => !sameName(x.from, u)) });
  }
  await cfg.kv.delete(socKey(u));
  await syncStore(c.env ?? {}).clear(u);
  await buzzStore(c.env ?? {}).clear(u);
  await nativeStore(c.env ?? {}).clear(u);
  deleteCookie(c, SESSION, { path: "/" });
  return c.json({ ok: true });
});

// ---------- Abgleich zwischen Geräten (nur mit bestätigtem Discogs-Namen) ----------
const syncUser = (s: Session) => s.username!.toLowerCase();
app.post("/api/sync/push", async (c) => {
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const body = (await c.req.json().catch(() => null)) as { ops?: unknown } | null;
  const r = await pushOps(syncStore(c.env ?? {}), syncUser(s), body?.ops);
  if ("error" in r) return c.json({ message: r.error }, 400);
  return c.json(r);
});
app.delete("/api/sync", async (c) => {
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  await syncStore(c.env ?? {}).clear(syncUser(s));
  return c.json({ ok: true });
});
app.get("/api/sync/pull", async (c) => {
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const since = Math.max(0, Number(c.req.query("since")) || 0);
  const { rows, seq } = await syncStore(c.env ?? {}).since(syncUser(s), since, 800);
  c.header("Cache-Control", "no-store");
  return c.json({ seq, more: rows.length === 800, rows: rows.map((r) => ({ t: r.t, k: r.k, v: r.v, ts: r.ts })) });
});

app.post("/api/profile/me", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const p = { ...sanitizeProfile(await c.req.json()), updatedAt: Date.now() };
  const empty = profileEmpty(p);
  const u = s.username.toLowerCase();
  if (empty) await cfg.kv.delete(profKey(u));
  else await cfg.kv.put(profKey(u), JSON.stringify(p));
  // DJ-Name in der Suche findbar machen (nur wer im Verzeichnis ist)
  await rebuildNameKeys(cfg, u);
  return c.json({ profile: empty ? null : p });
});

app.get("/api/profile/:u", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const u = c.req.param("u");
  if (!/^[\w.\-]{2,40}$/.test(u)) return c.json({ profile: null });
  return c.json({ profile: JSON.parse((await cfg.kv.get(profKey(u))) ?? "null") });
});

// ---------- Bilder für Teilen-Karten ----------
// Discogs-Cover haben keine CORS-Freigabe; zum Zeichnen auf ein Canvas reicht der Server sie durch.
// Nur Discogs-Bildserver, damit das kein offener Proxy ist.
/** Gig als .ics: iPhone und Mac öffnen „Zum Kalender hinzufügen“, Android und Outlook laden die Datei */
app.get("/api/ics", async (c) => {
  if (!(await tokenSession(c))) return c.text("Bitte anmelden", 401);
  const q = (k: string, max: number) => (c.req.query(k) ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max);
  const date = q("d", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.text("Datum fehlt", 400);
  const time = (k: string) => (/^\d{1,2}:\d{2}$/.test(q(k, 5)) ? q(k, 5) : undefined);
  const uid = /^[\w.@-]{1,80}$/.test(q("u", 80)) ? q("u", 80) : `gig-${date}@crate`;
  const ics = buildIcs({ uid, title: q("t", 120) || "Gig", date, start: time("s"), end: time("e"), location: q("l", 160) || undefined, description: q("n", 1500) || undefined, alarmMinutes: Number(q("a", 4)) || undefined });
  const name = (q("t", 60) || "gig").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "gig";
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.ics"`, "Cache-Control": "no-store" } });
});

app.get("/api/img", async (c) => {
  const u = c.req.query("u") ?? "";
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return c.text("ungültig", 400);
  }
  if (url.protocol !== "https:" || url.port || url.username || !/^(i|st|img)\.discogs\.com$/.test(url.hostname)) return c.text("nicht erlaubt", 403);
  const r = await fetch(url.toString(), { headers: { "User-Agent": c.var.cfg.userAgent }, redirect: "manual" });
  const type = r.headers.get("Content-Type") ?? "";
  if (!r.ok || !type.startsWith("image/")) return c.text("Bild nicht ladbar", 502);
  return new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" } });
});
