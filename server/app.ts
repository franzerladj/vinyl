// Alle API-Routen. Läuft als Cloudflare Pages Function und lokal unter Node.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readConfig, type Config, type Env } from "./env";
import { seal, unseal, type Session } from "./session";
import { authorizeUrl, discogsFetch, DiscogsBusy, getAccessToken, getRequestToken } from "./discogs";
import { oauthHmacHeader } from "./oauthSign";
import { recognizeRecord, recognizeRecordFree, tagVibes, tagVibesFree, type VibeInput } from "./ai";
import { fetchPreview, lookupAudio } from "./audio";
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
  return s && aiAllowlist.includes(s.username.toLowerCase()) ? anthropicKey : null;
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

app.get("/api/auth/callback", async (c) => {
  const cfg = c.var.cfg;
  const pending = await unseal<{ token: string; secret: string }>(cfg.sessionSecret, getCookie(c, PENDING));
  const verifier = c.req.query("oauth_verifier");
  if (!pending || !verifier || c.req.query("oauth_token") !== pending.token) return c.redirect(`${cfg.appUrl}/?login=failed`);
  let at: { token: string; secret: string };
  try {
    at = await getAccessToken(cfg, pending.token, pending.secret, verifier);
  } catch (e) {
    // Der Verifier ist nur einmal gültig, also neu anmelden lassen
    return c.redirect(`${cfg.appUrl}/?login=${e instanceof DiscogsBusy ? "busy" : "failed"}`);
  }
  const idRes = await discogsFetch(cfg, { token: at.token, secret: at.secret, username: "" }, "/oauth/identity");
  if (!idRes.ok) return c.redirect(`${cfg.appUrl}/?login=${idRes.status === 429 ? "busy" : "failed"}`);
  const identity = (await idRes.json()) as { username: string };
  deleteCookie(c, PENDING, { path: "/" });
  setCookie(c, SESSION, await seal(cfg.sessionSecret, { ...at, username: identity.username }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
  return c.redirect(`${cfg.appUrl}/`);
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
  if (s) return c.json({ username: s.username, features });
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

app.get("/api/audio/preview", (c) => fetchPreview(c.req.query("artist") ?? "", c.req.query("title") ?? "", Number(c.req.query("duration")) || null));

app.get("/api/lastfm/tags", async (c) => {
  if (!c.var.cfg.lastfmKey) return c.json({ message: "LASTFM_API_KEY fehlt" }, 501);
  return c.json(await lastfmTags(c.var.cfg, c.req.query("artist") ?? "", c.req.query("track") ?? ""));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ message: err.message }, 500);
});
