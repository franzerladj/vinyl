// Alle API-Routen. Läuft als Cloudflare Pages Function und lokal unter Node.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readConfig, type Config, type Env } from "./env";
import { seal, unseal, type Session } from "./session";
import { authHeaders, authorizeUrl, discogsFetch, DiscogsBusy, getAccessToken, getRequestToken } from "./discogs";
import { ALL_KINDS, bundle, currentSlot, dueReminders, isPushEndpoint, loadUser, pickWants, notifyUser, saveUser, sendPush, userKey, wantChange, type Message, type PushSub, type Stat, type UserRec, type WatchedWant } from "./push";
import { oauthHmacHeader, oauthHmacParams } from "./oauthSign";
import { recognizeRecord, recognizeRecordFree, tagVibes, tagVibesFree, type VibeInput } from "./ai";
import { fetchPreview, fetchPreviewById, lookupAudio, matchRelease, type ReleaseTrackIn } from "./audio";
import { lastfmTags } from "./lastfm";
import { profileEmpty, sanitizeProfile, type CrateProfile } from "../shared/profile";

type C = Context<{ Bindings: Env; Variables: { cfg: Config } }>;

export const app = new Hono<{ Bindings: Env; Variables: { cfg: Config } }>();
const SESSION = "crate_session";
const PENDING = "crate_oauth";

app.use("/api/*", async (c, next) => {
  c.set("cfg", readConfig(c.env ?? {}, c.req.url));
  await next();
});

const cookieOpts = (c: C) => ({ httpOnly: true, secure: c.var.cfg.appUrl.startsWith("https://"), sameSite: "Lax" as const, path: "/" });
const rawSession = (c: C) => unseal<Session>(c.var.cfg.sessionSecret, getCookie(c, SESSION));
/** Nur Sitzungen mit vom Server bei Discogs bestätigtem Namen zählen (alte unbestätigte werden nachgeprüft) */
const session = async (c: C) => {
  const s = await rawSession(c);
  return s && s.username && s.verified !== false ? s : null;
};

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
  const { token, secret } = await c.req.json<{ token: string; secret: string }>();
  if (!token || !secret) return c.json({ message: "Token fehlt" }, 400);
  // Der Name kommt immer vom Server bei Discogs, nie vom Gerät
  const r = await discogsFetch(cfg, { token, secret, username: "" }, "/oauth/identity").catch(() => null);
  if (!r || r.status === 429) return c.json({ busy: true, message: "Discogs ist gerade ausgelastet" }, 503);
  if (!r.ok) return c.json({ message: "Discogs hat den Zugang nicht bestätigt" }, 401);
  const name = ((await r.json()) as { username: string }).username;
  deleteCookie(c, PENDING, { path: "/" });
  setCookie(c, SESSION, await seal(cfg.sessionSecret, { token, secret, username: name, verified: true }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
  return c.json({ username: name, verified: true });
});

/** Ältere Sitzungen ohne bestätigten Namen: der Server fragt Discogs selbst */
app.post("/api/auth/identity", async (c) => {
  const cfg = c.var.cfg;
  const s = await rawSession(c);
  if (!s) return c.json({ message: "nicht angemeldet" }, 401);
  if (s.verified !== false && s.username) return c.json({ username: s.username });
  const r = await discogsFetch(cfg, s, "/oauth/identity").catch(() => null);
  if (!r || r.status === 429) return c.json({ busy: true }, 503);
  if (!r.ok) return c.json({ message: "Zugang ungültig, bitte neu anmelden" }, 401);
  const username = ((await r.json()) as { username: string }).username;
  setCookie(c, SESSION, await seal(cfg.sessionSecret, { ...s, username, verified: true }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
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
    deleteCookie(c, PENDING, { path: "/" });
    if (!r.ok) {
      // Zugang ist da, nur der Name fehlt: Sitzung ohne Namen, der Server prüft ihn gleich über /api/auth/identity nach
      setCookie(c, SESSION, await seal(cfg.sessionSecret, { ...at, username: "", verified: false }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
      return c.json({ username: null, verified: false });
    }
    const name = ((await r.json()) as { username: string }).username;
    setCookie(c, SESSION, await seal(cfg.sessionSecret, { ...at, username: name, verified: true }), { ...cookieOpts(c), maxAge: 60 * 60 * 24 * 365 });
    return c.json({ username: name, verified: true });
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
  if (s) return c.json({ username: s.username, features, verified: true });
  if (await rawSession(c)) return c.json({ username: null, needIdentity: true, features }, 401);
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
  if (!(await session(c)) && !c.req.header("X-Anthropic-Key")) return c.json({ message: "Bitte anmelden" }, 401);
  const { image, mediaType } = await c.req.json<{ image: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }>();
  if (!image || image.length > 7_000_000) return c.json({ message: "Bild fehlt oder ist zu groß" }, 400);
  const key = await claudeKey(c);
  if (key) return c.json({ ...(await recognizeRecord(key, image, mediaType ?? "image/jpeg")), engine: "claude" });
  if (c.var.cfg.ai) return c.json({ ...(await recognizeRecordFree(c.var.cfg.ai, image, mediaType ?? "image/jpeg")), engine: "workers-ai" });
  return c.json({ message: "Keine Bilderkennung auf dem Server eingerichtet" }, 501);
});

app.post("/api/ai/vibes", async (c) => {
  if (!(await session(c)) && !c.req.header("X-Anthropic-Key")) return c.json({ message: "Bitte anmelden" }, 401);
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

// ---------- Push-Mitteilungen ----------
/** Nur bekannte Arten mit Ja/Nein übernehmen */
const cleanPrefs = (p: unknown): Partial<UserRec["prefs"]> => {
  const out: Partial<UserRec["prefs"]> = {};
  if (p && typeof p === "object") for (const k of ALL_KINDS) if (typeof (p as Record<string, unknown>)[k] === "boolean") out[k] = (p as Record<string, boolean>)[k];
  return out;
};
const emptyRec = (sess: string): UserRec => ({ subs: [], prefs: { friends: true, wants: true, lent: true, sets: true, sellers: true }, sess, wants: [], lent: [], sets: [], cursor: 0, sent: {}, updatedAt: Date.now() });

/** Gerät für Mitteilungen anmelden. Merkt sich den Discogs-Zugang (versiegelt), damit der Zeitplan Wants prüfen kann. */
app.post("/api/push/subscribe", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const { subscription, prefs } = await c.req.json<{ subscription: PushSub; prefs?: Partial<UserRec["prefs"]> }>();
  if (!subscription?.endpoint || !isPushEndpoint(subscription.endpoint) || typeof subscription.keys?.p256dh !== "string" || typeof subscription.keys?.auth !== "string") return c.json({ message: "ungültiges Abo" }, 400);
  const rec = (await loadUser(cfg.kv, s.username)) ?? emptyRec("");
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
  if (!rec.subs.length) await cfg.kv.delete(userKey(s.username));
  else await saveUser(cfg.kv, s.username, rec);
  return c.json({ ok: true });
});

app.get("/api/push/status", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  const rec = s?.username ? await loadUser(cfg.kv, s.username) : null;
  return c.json({ available: Boolean(cfg.push.privateJwk), devices: rec?.subs.length ?? 0, prefs: rec?.prefs ?? null });
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
  const body = await c.req.json<{ wants?: WatchedWant[]; lent?: UserRec["lent"]; sets?: UserRec["sets"]; currency?: string }>();
  if (body.wants && !Array.isArray(body.wants)) return c.json({ message: "ungültig" }, 400);
  if (body.lent && !Array.isArray(body.lent)) return c.json({ message: "ungültig" }, 400);
  if (body.sets && !Array.isArray(body.sets)) return c.json({ message: "ungültig" }, 400);
  if (body.wants) {
    const old = new Map(rec.wants.map((w) => [w.id, w]));
    rec.wants = body.wants.slice(0, 500).map((w) => ({ id: Number(w.id), t: String(w.t).slice(0, 120), a: String(w.a).slice(0, 80), target: Number.isFinite(Number(w.target)) && Number(w.target) > 0 ? Number(w.target) : null, n: old.get(Number(w.id))?.n ?? null, low: old.get(Number(w.id))?.low ?? null }));
  }
  if (body.lent) rec.lent = body.lent.slice(0, 200).map((l) => ({ id: Number(l.id), t: String(l.t).slice(0, 120), to: String(l.to).slice(0, 60), at: Number(l.at) }));
  if (body.sets) rec.sets = body.sets.slice(0, 100).filter((x) => /^\d{4}-\d\d-\d\d$/.test(x.date)).map((x) => ({ id: Number(x.id), name: String(x.name).slice(0, 80), date: x.date }));
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
  if (rec?.subs.length) {
    const n = await notifyUser(cfg.kv, cfg.push, friend, rec, "friends", { title: "Neue Freundschaft auf Crate", body: `${s.username} hat dich als Freund hinzugefügt. Tippen, um zurück zu folgen.`, url: `/friends?add=${encodeURIComponent(s.username)}`, tag: `friend-${s.username}` });
    return c.json({ ok: true, status: n ? "zugestellt" : "aus" });
  }
  // Noch keine Mitteilungen an: merken und nachreichen, sobald er sie einschaltet
  const key = `pending:${friend.toLowerCase()}`;
  const list = JSON.parse((await cfg.kv.get(key)) ?? "[]") as string[];
  await cfg.kv.put(key, JSON.stringify([...new Set([...list, s.username])].slice(-20)), { expirationTtl: 60 * 86_400 });
  return c.json({ ok: true, status: "wartet" });
});

app.post("/api/push/test", async (c) => {
  const cfg = c.var.cfg;
  const s = await session(c);
  if (!s?.username) return c.json({ message: "nicht angemeldet" }, 401);
  const rec = await loadUser(cfg.kv, s.username);
  if (!rec?.subs.length) return c.json({ message: "Auf diesem Gerät sind Mitteilungen aus" }, 404);
  let ok = 0;
  for (const sub of rec.subs) if ((await sendPush(cfg.push, sub, { title: "Crate", body: "So sehen Mitteilungen aus. Alles eingerichtet.", url: "/settings/notifications", tag: "test" })) === "ok") ok++;
  return c.json({ sent: ok, devices: rec.subs.length });
});

/** Für den Zeitplan-Worker: alle Nutzer mit Mitteilungen (er ruft dann für jeden /api/push/run?u= auf) */
app.post("/api/push/users", async (c) => {
  const cfg = c.var.cfg;
  if (!cfg.cronSecret || c.req.header("X-Cron-Secret") !== cfg.cronSecret) return c.json({ message: "nein" }, 403);
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
  if (!rec?.subs.length) return { u, skipped: true };
  const startSubs = new Set(rec.subs.map((x) => x.endpoint));
  let changed = false;
  for (const d of dueReminders(rec)) {
    budget -= rec.subs.length;
    await notifyUser(cfg.kv, cfg.push, u, rec, d.kind, d.msg);
    rec.sent[d.key] = Date.now();
    changed = true;
  }
  const msgs: Message[] = [];
  let checked = 0;
  if (rec.prefs.wants && rec.wants.length) {
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
  if (!cfg.cronSecret || c.req.header("X-Cron-Secret") !== cfg.cronSecret) return c.json({ message: "nein" }, 403);
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
app.get("/api/img", async (c) => {
  const u = c.req.query("u") ?? "";
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return c.text("ungültig", 400);
  }
  if (url.protocol !== "https:" || !/^(i|st|img)\.discogs\.com$/.test(url.hostname)) return c.text("nicht erlaubt", 403);
  const r = await fetch(url.toString(), { headers: { "User-Agent": c.var.cfg.userAgent } });
  const type = r.headers.get("Content-Type") ?? "";
  if (!r.ok || !type.startsWith("image/")) return c.text("Bild nicht ladbar", 502);
  return new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" } });
});
