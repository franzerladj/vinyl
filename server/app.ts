// Alle API-Routen. Läuft als Cloudflare Pages Function und lokal unter Node.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readConfig, type Config, type Env } from "./env";
import { seal, unseal, type Session } from "./session";
import { authorizeUrl, discogsFetch, DiscogsBusy, getAccessToken, getRequestToken } from "./discogs";
import { oauthHmacHeader, oauthHmacParams } from "./oauthSign";
import { recognizeRecord, recognizeRecordFree, tagVibes, tagVibesFree, type VibeInput } from "./ai";
import { fetchPreview, fetchPreviewById, lookupAudio, matchRelease, type ReleaseTrackIn } from "./audio";
import { lastfmTags } from "./lastfm";

type C = Context<{ Bindings: Env; Variables: { cfg: Config } }>;

export const app = new Hono<{ Bindings: Env; Variables: { cfg: Config } }>();
const SESSION = "crate_session";
const PENDING = "crate_oauth";

app.use("/api/*", async (c, next) => {
  c.set("cfg", readConfig(c.env ?? {}, c.req.url));
  await next();
});

const cookieOpts = (c: C) => ({ httpOnly: true, secure: c.var.cfg.appUrl.startsWith("https://"), sameSite: "Lax" as const, path: "/" });
const session = (c: C) => unseal<Session>(c.var.cfg.sessionSecret, getCookie(c, SESSION));

/** Wer darf Claude nutzen? Eigener Key im Header oder Discogs-Name auf der Allowlist */
async function claudeKey(c: C): Promise<string | null> {
  const own = c.req.header("X-Anthropic-Key");
  if (own && own.startsWith("sk-ant-")) return own;
  const { anthropicKey, aiAllowlist } = c.var.cfg;
  if (!anthropicKey || aiAllowlist.length === 0) return null;
  if (aiAllowlist.includes("*")) return anthropicKey;
  const s = await session(c);
  // Nur bestätigte Benutzernamen (sonst könnte jemand einen fremden Namen angeben)
  return s && s.verified !== false && aiAllowlist.includes(s.username.toLowerCase()) ? anthropicKey : null;
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
  const { token, secret, username } = await c.req.json<{ token: string; secret: string; username?: string }>();
  if (!token || !secret) return c.json({ message: "Token fehlt" }, 400);
  let name = "";
  let verified = false;
  const r = await discogsFetch(cfg, { token, secret, username: "" }, "/oauth/identity").catch(() => null);
  if (r?.ok) {
    name = ((await r.json()) as { username: string }).username;
    verified = true;
  } else if (r && r.status !== 429) {
    return c.json({ message: "Discogs hat den Zugang nicht bestätigt" }, 401);
  } else name = (username ?? "").trim();
  deleteCookie(c, PENDING, { path: "/" });
  setCookie(c, SESSION, await seal(cfg.sessionSecret, { token, secret, username: name, verified }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
  return c.json({ username: name || null, verified });
});

/** Benutzername nachreichen, wenn der Server ihn beim Anmelden nicht abfragen konnte */
app.post("/api/auth/identity", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s) return c.json({ message: "nicht angemeldet" }, 401);
  if (s.verified !== false && s.username) return c.json({ username: s.username });
  const { username } = await c.req.json<{ username: string }>();
  if (!/^[\w.\-]{2,40}$/.test(username ?? "")) return c.json({ message: "ungültig" }, 400);
  setCookie(c, SESSION, await seal(cfg.sessionSecret, { ...s, username, verified: false }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
  return c.json({ username });
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
    const ok = r.ok;
    const name = ok ? ((await r.json()) as { username: string }).username : "";
    deleteCookie(c, PENDING, { path: "/" });
    setCookie(c, SESSION, await seal(cfg.sessionSecret, { ...at, username: name, verified: ok }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
    return c.json({ username: name || null, verified: ok });
  } catch (e) {
    return c.json({ busy: e instanceof DiscogsBusy, message: (e as Error).message }, e instanceof DiscogsBusy ? 503 : 400);
  }
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, SESSION, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  const features = {
    oauth: Boolean(cfg.discogsKey),
    claude: Boolean(await claudeKey(c)),
    freeAi: Boolean(cfg.ai),
    lastfm: Boolean(cfg.lastfmKey),
    keyLookup: Boolean(cfg.getSongBpmKey),
  };
  if (s?.username) return c.json({ username: s.username, features, verified: s.verified !== false });
  if (s) return c.json({ username: null, needIdentity: true, features }, 401);
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
  const s = await session(c);
  if (!s) return c.json({ mode: "proxy" });
  const { method, path } = await c.req.json<{ method: string; path: string }>();
  if (!path || !ALLOWED.test(path) || !["GET", "POST", "PUT", "DELETE"].includes(method)) return c.json({ message: "Pfad nicht erlaubt" }, 403);
  const url = `https://api.discogs.com${path}`;
  const authorization = await oauthHmacHeader({ method, url, consumerKey: cfg.discogsKey, consumerSecret: cfg.discogsSecret, token: s.token, tokenSecret: s.secret });
  return c.json({ mode: "direct", url, authorization });
});

// ---------- Discogs-Proxy (Rückfallebene) ----------
const ALLOWED = /^\/(users|database|releases|masters|artists|labels|marketplace\/(stats|price_suggestions|listings)|oauth\/identity)(\/|$|\?)/;

app.all("/api/discogs/*", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s && !cfg.discogsPersonalToken) return c.json({ message: "Nicht angemeldet" }, 401);
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/discogs/, "") + url.search;
  if (!ALLOWED.test(path)) return c.json({ message: "Pfad nicht erlaubt" }, 403);
  const method = c.req.method;
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
  const { image, mediaType } = await c.req.json<{ image: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }>();
  if (!image || image.length > 7_000_000) return c.json({ message: "Bild fehlt oder ist zu groß" }, 400);
  const key = await claudeKey(c);
  if (key) return c.json({ ...(await recognizeRecord(key, image, mediaType ?? "image/jpeg")), engine: "claude" });
  if (c.var.cfg.ai) return c.json({ ...(await recognizeRecordFree(c.var.cfg.ai, image, mediaType ?? "image/jpeg")), engine: "workers-ai" });
  return c.json({ message: "Keine Bilderkennung auf dem Server eingerichtet" }, 501);
});

app.post("/api/ai/vibes", async (c) => {
  const { items } = await c.req.json<{ items: VibeInput[] }>();
  const list = (items ?? []).slice(0, 60);
  const key = await claudeKey(c);
  if (key) return c.json({ items: await tagVibes(key, list), engine: "claude" });
  if (c.var.cfg.ai) return c.json({ items: await tagVibesFree(c.var.cfg.ai, list.slice(0, 25)), engine: "workers-ai" });
  return c.json({ message: "Keine KI auf dem Server eingerichtet" }, 501);
});

// ---------- Audio-Daten ----------
app.get("/api/audio/lookup", async (c) => {
  const title = c.req.query("title") ?? "";
  if (!title) return c.json({ message: "title fehlt" }, 400);
  return c.json(await lookupAudio(c.var.cfg, c.req.query("artist") ?? "", title, Number(c.req.query("duration")) || null));
});

app.post("/api/audio/release", async (c) => {
  const { artist, title, tracks } = await c.req.json<{ artist: string; title: string; tracks: ReleaseTrackIn[] }>();
  if (!title || !Array.isArray(tracks)) return c.json({ message: "title und tracks nötig" }, 400);
  return c.json(await matchRelease(artist ?? "", title, tracks.slice(0, 40)));
});

app.get("/api/audio/preview/:id", (c) => fetchPreviewById(Number(c.req.param("id"))));

app.get("/api/audio/preview", (c) => fetchPreview(c.req.query("artist") ?? "", c.req.query("title") ?? "", Number(c.req.query("duration")) || null));

app.get("/api/lastfm/tags", async (c) => {
  if (!c.var.cfg.lastfmKey) return c.json({ message: "LASTFM_API_KEY fehlt" }, 501);
  return c.json(await lastfmTags(c.var.cfg, c.req.query("artist") ?? "", c.req.query("track") ?? ""));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ message: err.message }, 500);
});
