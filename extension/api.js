// Zugriff auf Crate und Discogs aus dem Hintergrund-Skript.
// Crate: mit der bestehenden Anmeldung (Cookie der Crate-Seite, die Erweiterung hat dafür die Berechtigung).
// Discogs: nur über die Schnittstelle (api.discogs.com), jede Anfrage von Crate signiert wie in der App.
// Discogs-Webseiten werden nie ausgelesen (API-Bedingungen): von dort kommt nur die Plattennummer aus der Adresse.
import { CRATE } from "./config.js";

const SIX_HOURS = 6 * 3600_000;
const store = {
  get: async (k, d) => (await chrome.storage.local.get(k))[k] ?? d,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  del: (k) => chrome.storage.local.remove(k),
};

export class NotSignedIn extends Error {
  constructor() {
    super("Nicht bei Crate angemeldet");
    this.name = "NotSignedIn";
  }
}

async function crate(path, body, method) {
  const r = await fetch(CRATE + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) throw new NotSignedIn();
  if (!r.ok) throw new Error(`Crate antwortet mit ${r.status}`);
  return r.json();
}

/** Wer ist angemeldet? Kurz gemerkt, damit nicht jede Seite neu fragt. */
let meCache = null;
export async function me(force = false) {
  if (!force && meCache && Date.now() - meCache.at < 60_000) return meCache.v;
  const j = await crate("/api/me").catch((e) => {
    if (e instanceof NotSignedIn) return null;
    throw e;
  });
  const v = j?.username ? { username: j.username, verified: j.verified !== false } : null;
  // „Abgemeldet“ nicht merken: wer sich gerade in Crate angemeldet hat, soll das Feld sofort sehen
  meCache = v ? { at: Date.now(), v } : null;
  const before = await store.get("user", null);
  // Anderes Konto: nichts vom vorigen behalten
  if ((v?.username ?? null) !== before) {
    await chrome.storage.local.clear();
    await store.set("user", v?.username ?? null);
  }
  return v;
}

/** Eine Anfrage an die Discogs-Schnittstelle, von Crate signiert (wie in der App) */
export async function discogs(method, path, body) {
  const s = await crate("/api/sign", { method, path });
  const init = { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
  let r;
  if (s.mode === "direct") r = await fetch(s.url, { ...init, headers: { ...init.headers, Authorization: s.authorization } });
  else r = await fetch(`${CRATE}/api/discogs${path}`, { ...init, credentials: "include" });
  if (r.status === 401 || r.status === 403) throw new NotSignedIn();
  if (r.status === 404) return null;
  if (r.status === 429) throw new Error("Discogs braucht eine kurze Pause. Gleich noch einmal versuchen.");
  if (!r.ok) throw new Error(`Discogs antwortet mit ${r.status}`);
  return r.status === 204 ? {} : r.json();
}

const user = async () => {
  const m = await me();
  if (!m) throw new NotSignedIn();
  return encodeURIComponent(m.username);
};

/** Nummern der Wantlist, höchstens sechs Stunden alt (Vorgabe von Discogs für gemerkte Daten) */
export async function wantIds(force = false) {
  const c = await store.get("wants", null);
  if (!force && c && Date.now() - c.at < SIX_HOURS) return new Set(c.ids);
  const u = await user();
  const ids = [];
  for (let page = 1; page <= 40; page++) {
    const j = await discogs("GET", `/users/${u}/wants?per_page=100&page=${page}`);
    for (const w of j?.wants ?? []) ids.push(w.id);
    if (!j || page >= (j.pagination?.pages ?? 1)) break;
  }
  await store.set("wants", { ids, at: Date.now() });
  return new Set(ids);
}

async function folders() {
  const c = await store.get("folders", null);
  if (c && Date.now() - c.at < SIX_HOURS) return c.map;
  const j = await discogs("GET", `/users/${await user()}/collection/folders`);
  const map = Object.fromEntries((j?.folders ?? []).filter((f) => f.id > 1).map((f) => [f.id, f.name]));
  await store.set("folders", { map, at: Date.now() });
  return map;
}

const grade = (v) => (typeof v === "string" ? (/\(([^)]+)\)/.exec(v)?.[1] ?? v) : "");
const marks = (note, name) => [...String(note ?? "").matchAll(new RegExp(`\\[${name}: ([^\\]]+)\\]`, "g"))].map((m) => m[1].trim());

/** Alles zu einer Platte: in der Sammlung? auf der Wantlist? Preis? dazu, was Crate selbst weiß */
export async function release(id) {
  const u = await user();
  const [coll, wants, info, stats, own, fmap] = await Promise.all([
    discogs("GET", `/users/${u}/collection/releases/${id}`),
    wantIds().catch(() => new Set()),
    discogs("GET", `/releases/${id}`).catch(() => null),
    discogs("GET", `/marketplace/stats/${id}`).catch(() => null),
    crate(`/api/ext/release/${id}`).catch(() => null),
    folders().catch(() => ({})),
  ]);
  const copies = (coll?.releases ?? []).map((c) => {
    const note = (c.notes ?? []).find((n) => n.field_id === 3)?.value ?? "";
    return {
      folder: fmap[c.folder_id] ?? null,
      more: marks(note, "Ordner"),
      media: grade((c.notes ?? []).find((n) => n.field_id === 1)?.value),
      sleeve: grade((c.notes ?? []).find((n) => n.field_id === 2)?.value),
      paid: marks(note, "Bezahlt")[0] ?? null,
      added: c.date_added ?? null,
    };
  });
  return {
    id,
    title: info?.title ?? null,
    artist: (info?.artists ?? []).map((a) => String(a.name).replace(/\s\(\d+\)$/, "")).join(", ") || null,
    year: info?.year || null,
    label: info?.labels?.[0] ? `${String(info.labels[0].name).replace(/\s\(\d+\)$/, "")} · ${info.labels[0].catno}` : null,
    thumb: info?.thumb || null,
    copies,
    want: wants.has(id),
    price: stats?.lowest_price?.value != null ? { value: stats.lowest_price.value, currency: stats.lowest_price.currency, n: stats.num_for_sale ?? 0 } : null,
    crate: own,
    at: Date.now(),
  };
}

/** Suche nach Text (Artist, Titel, Katalognummer): Discogs sagt bei jedem Treffer gleich dazu, ob er dir gehört */
export async function search(q) {
  const text = String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (text.length < 2) return [];
  const j = await discogs("GET", `/database/search?type=release&per_page=8&q=${encodeURIComponent(text)}`);
  return (j?.results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year || null,
    label: [r.label?.[0], r.catno].filter(Boolean).join(" · "),
    format: (r.format ?? []).slice(0, 3).join(", "),
    country: r.country || null,
    thumb: r.thumb || null,
    have: Boolean(r.user_data?.in_collection),
    want: Boolean(r.user_data?.in_wantlist),
  }));
}

/** Auf die Wantlist setzen oder herunternehmen */
export async function setWant(id, on) {
  const u = await user();
  await discogs(on ? "PUT" : "DELETE", `/users/${u}/wants/${id}`);
  const c = await store.get("wants", null);
  if (c) await store.set("wants", { ...c, ids: on ? [...new Set([...c.ids, id])] : c.ids.filter((x) => x !== id) });
  return on;
}

/** Gibt es eine neuere Erweiterung zum Laden? (Als Ordner geladen aktualisiert sie sich nicht von selbst.) */
export async function newer() {
  try {
    const j = await (await fetch(`${CRATE}/download/crate-erweiterung.json`, { cache: "no-store" })).json();
    const mine = chrome.runtime.getManifest().version;
    const num = (v) => String(v).split(".").map(Number);
    const [a, b] = [num(j.version), num(mine)];
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) ? j.version : null;
    return null;
  } catch {
    return null;
  }
}

/** Zahl am Symbol: offene Freundschaftsanfragen, Neuigkeiten und ungelesene Nachrichten */
export async function counts() {
  const m = await me(true);
  if (!m?.verified) return { signedIn: Boolean(m), n: 0, requests: 0, news: 0, messages: 0 };
  const [buzz, soc] = await Promise.all([crate("/api/buzz").catch(() => null), crate("/api/friends").catch(() => null)]);
  const requests = soc?.in?.length ?? 0;
  const news = buzz?.unread ?? 0;
  const messages = buzz?.dm ?? 0;
  return { signedIn: true, username: m.username, n: requests + news + messages, requests, news, messages, newer: await newer() };
}
