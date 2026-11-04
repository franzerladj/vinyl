import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readFile } from "node:fs/promises";
import { config } from "./config";
import { seal, unseal, type Session } from "./session";
import { authorizeUrl, discogsFetch, getAccessToken, getRequestToken } from "./discogs";
import { aiEnabled, recognizeRecord, tagVibes, type VibeInput } from "./ai";
import { lookupAudio } from "./audio";

const app = new Hono();
const SESSION = "crate_session";
const PENDING = "crate_oauth";
const secure = config.appUrl.startsWith("https://");
const cookieOpts = { httpOnly: true, secure, sameSite: "Lax" as const, path: "/" };

const session = (c: Parameters<typeof getCookie>[0]) => unseal<Session>(getCookie(c, SESSION));

// ---------- Auth ----------
app.get("/api/auth/login", async (c) => {
  if (!config.discogsKey) return c.text("DISCOGS_CONSUMER_KEY fehlt in der Server-Konfiguration", 500);
  const callback = `${config.appUrl}/api/auth/callback`;
  const rt = await getRequestToken(callback);
  setCookie(c, PENDING, seal(rt), { ...cookieOpts, maxAge: 900 });
  return c.redirect(authorizeUrl(rt.token));
});

app.get("/api/auth/callback", async (c) => {
  const pending = unseal<{ token: string; secret: string }>(getCookie(c, PENDING));
  const verifier = c.req.query("oauth_verifier");
  if (!pending || !verifier || c.req.query("oauth_token") !== pending.token) {
    return c.redirect(`${config.appUrl}/?login=failed`);
  }
  const at = await getAccessToken(pending.token, pending.secret, verifier);
  const idRes = await discogsFetch({ token: at.token, secret: at.secret, username: "" }, "/oauth/identity");
  const identity = (await idRes.json()) as { username: string };
  deleteCookie(c, PENDING, { path: "/" });
  setCookie(c, SESSION, seal({ ...at, username: identity.username }), { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
  return c.redirect(`${config.appUrl}/`);
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, SESSION, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const s = session(c);
  const features = { ai: aiEnabled(), keyLookup: Boolean(config.getSongBpmKey), oauth: Boolean(config.discogsKey) };
  if (s) return c.json({ username: s.username, features });
  if (config.discogsPersonalToken) {
    const r = await discogsFetch(null, "/oauth/identity");
    if (r.ok) return c.json({ username: ((await r.json()) as { username: string }).username, features, personalToken: true });
  }
  return c.json({ username: null, features }, 401);
});

// ---------- Discogs-Proxy ----------
const ALLOWED = /^\/(users|database|releases|masters|artists|labels|marketplace\/(stats|price_suggestions|listings)|oauth\/identity)(\/|$|\?)/;

app.all("/api/discogs/*", async (c) => {
  const s = session(c);
  if (!s && !config.discogsPersonalToken) return c.json({ message: "Nicht angemeldet" }, 401);
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/discogs/, "") + url.search;
  if (!ALLOWED.test(path)) return c.json({ message: "Pfad nicht erlaubt" }, 403);
  const method = c.req.method;
  const body = ["POST", "PUT"].includes(method) ? await c.req.text() : undefined;
  const r = await discogsFetch(s, path, { method, body: body || undefined });
  const headers = new Headers({ "Content-Type": r.headers.get("Content-Type") ?? "application/json" });
  for (const h of ["X-Discogs-Ratelimit", "X-Discogs-Ratelimit-Remaining", "X-Discogs-Ratelimit-Used"]) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(r.status === 204 ? null : await r.arrayBuffer(), { status: r.status, headers });
});

// ---------- KI ----------
app.post("/api/ai/recognize", async (c) => {
  if (!aiEnabled()) return c.json({ message: "ANTHROPIC_API_KEY ist nicht gesetzt" }, 501);
  const { image, mediaType } = await c.req.json<{ image: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }>();
  if (!image || image.length > 7_000_000) return c.json({ message: "Bild fehlt oder ist zu groß" }, 400);
  return c.json(await recognizeRecord(image, mediaType ?? "image/jpeg"));
});

app.post("/api/ai/vibes", async (c) => {
  if (!aiEnabled()) return c.json({ message: "ANTHROPIC_API_KEY ist nicht gesetzt" }, 501);
  const { items } = await c.req.json<{ items: VibeInput[] }>();
  return c.json({ items: await tagVibes((items ?? []).slice(0, 60)) });
});

// ---------- BPM/Key ----------
app.get("/api/audio/lookup", async (c) => {
  const artist = c.req.query("artist") ?? "";
  const title = c.req.query("title") ?? "";
  if (!title) return c.json({ message: "title fehlt" }, 400);
  return c.json(await lookupAudio(artist, title));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ message: err.message }, 500);
});

// ---------- Frontend (Produktion) ----------
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("*", async (c) => c.html(await readFile("./web/dist/index.html", "utf8")));
}

serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`[crate] läuft auf http://localhost:${i.port}`));
