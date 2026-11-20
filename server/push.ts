// Web Push: Versand (VAPID + aes128gcm nach RFC 8291/8292, nur Web Crypto) und Speicher der Abos.
// Gespeichert wird nur für Nutzer, die Mitteilungen einschalten: Push-Adressen, Wants mit
// Wunschpreisen, Erinnerungen und der Discogs-Zugang (verschlüsselt wie im Session-Cookie).

import { REVIEW_DAY } from "../shared/year";

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; cursor?: string; list_complete: boolean }>;
}

/** Lokaler Betrieb ohne Cloudflare: Speicher im Arbeitsspeicher */
export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushKind = "friends" | "wants" | "lent" | "sets" | "sellers" | "tips" | "daily";
export const ALL_KINDS: PushKind[] = ["friends", "wants", "lent", "sets", "sellers", "tips", "daily"];
/**
 * Was gilt, wenn jemand eine Art noch nie eingestellt hat (ältere Einträge kennen die neuen Arten nicht).
 * „Platte des Tages“ kommt täglich und ist deshalb erst an, wenn man sie einschaltet.
 */
export const KIND_DEFAULT: Record<PushKind, boolean> = { friends: true, wants: true, lent: true, sets: true, sellers: true, tips: true, daily: false };
export const kindOn = (rec: Pick<UserRec, "prefs">, kind: PushKind) => rec.prefs?.[kind] ?? KIND_DEFAULT[kind];

export interface WatchedWant {
  id: number;
  t: string;
  a: string;
  target?: number | null;
  /** zuletzt gesehen: Anzahl Angebote und günstigster Preis */
  n?: number | null;
  low?: number | null;
}

export interface UserRec {
  subs: (PushSub & { addedAt: number })[];
  /** Android-Apps, die ihre Mitteilungen selbst abholen (Kennwörter, siehe server/native.ts) */
  native?: string[];
  prefs: Record<PushKind, boolean>;
  /** Discogs-Zugang, versiegelt mit SESSION_SECRET */
  sess: string;
  currency?: string;
  wants: WatchedWant[];
  lent: { id: number; t: string; to: string; at: number }[];
  /** Anstehende Sets: Tag, Beginn (HH:MM) und wie viele Platten in der Kiste liegen */
  sets: { id: number; name: string; date: string; start?: string; n?: number }[];
  /** Abstand der Uhr des Geräts zu UTC in Minuten (wie Date.getTimezoneOffset: Berlin im Winter −60) */
  tz?: number;
  /** Wie weit die Nadel abgespielt ist (0 bis 1) und wie sie heißt */
  stylus?: { pct: number; name?: string };
  /** Platte des Tages für die nächsten Tage (rechnet das Gerät aus, der Server kennt die Sammlung nicht) */
  daily?: { d: string; id: number; t: string; a: string; why?: string }[];
  cursor: number;
  /** schon erinnert (Schlüssel → Zeitpunkt) */
  sent: Record<string, number>;
  /** Erinnerung ans Profil: Zeitpunkt, ab dem sie fällig ist. 0 = erledigt (Profil da oder schon erinnert), fehlt = noch nie geprüft */
  profileNudge?: number;
  /** Zuletzt zugestellte Update-Mitteilung (shared/announce.ts) */
  announce?: string;
  updatedAt: number;
}

export interface Message {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** Sofort zustellen, auch wenn das Handy ruht (Anfragen, Likes, Kommentare). Sonst darf der Push-Dienst warten. */
  urgent?: boolean;
}

const enc = new TextEncoder();
const b64u = (b: Bytes) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string): Bytes => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...a: Bytes[]): Bytes => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) (out.set(x, o), (o += x.length));
  return out;
};

type Bytes = Uint8Array<ArrayBuffer>;

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** Nutzlast verschlüsseln (aes128gcm, RFC 8291). Exportiert für Tests. */
export async function encryptPayload(sub: PushSub, payload: Bytes, fixed?: { salt: Bytes; keyPair: CryptoKeyPair }) {
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  const as = fixed?.keyPair ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** VAPID-JWT (ES256) für den Push-Dienst des Abos */
async function vapidAuth(endpoint: string, privateJwk: JsonWebKey, publicKey: string, subject: string) {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

export interface PushConfig {
  privateJwk: JsonWebKey | null;
  publicKey: string;
  subject: string;
  /** Warteschlange für Android-Apps, die selbst abholen */
  native?: { enqueue(tokens: string[], msg: Message): Promise<void> };
}

/** Geräte, die Mitteilungen bekommen: Browser-Abos und Android-Apps */
export const deviceCount = (rec: UserRec | null | undefined) => (rec ? rec.subs.length + (rec.native?.length ?? 0) : 0);

/** An die Android-Apps eines Nutzers (wartet dort, bis die App abholt) */
export async function sendNative(cfg: PushConfig, rec: UserRec, msg: Message): Promise<number> {
  if (!rec.native?.length || !cfg.native) return 0;
  try {
    await cfg.native.enqueue(rec.native, msg);
    return rec.native.length;
  } catch {
    return 0;
  }
}

/** Eine Mitteilung an ein Abo schicken. Gibt "gone" zurück, wenn das Abo nicht mehr existiert. */
export async function sendPush(cfg: PushConfig, sub: PushSub, msg: Message): Promise<"ok" | "gone" | "error"> {
  if (!cfg.privateJwk) return "error";
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(msg)));
    const r = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuth(sub.endpoint, cfg.privateJwk, cfg.publicKey, cfg.subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(24 * 3600),
        Urgency: msg.urgent ? "high" : "normal",
        ...(msg.tag ? { Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
      },
      body,
    });
    if (r.status === 404 || r.status === 410) return "gone";
    return r.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

export const userKey = (u: string) => `u:${u.toLowerCase()}`;

export async function loadUser(kv: KV, u: string): Promise<UserRec | null> {
  const raw = await kv.get(userKey(u));
  return raw ? (JSON.parse(raw) as UserRec) : null;
}

export async function saveUser(kv: KV, u: string, rec: UserRec) {
  await kv.put(userKey(u), JSON.stringify({ ...rec, updatedAt: Date.now() }));
}

/** An alle Geräte eines Nutzers schicken, abgelaufene Abos entfernen */
export async function notifyUser(kv: KV, cfg: PushConfig, u: string, rec: UserRec, kind: PushKind, msg: Message): Promise<number> {
  if (!kindOn(rec, kind) || !deviceCount(rec)) return 0;
  let sent = await sendNative(cfg, rec, msg);
  const keep: UserRec["subs"] = [];
  for (const s of rec.subs) {
    const r = await sendPush(cfg, s, msg);
    if (r !== "gone") keep.push(s);
    if (r === "ok") sent++;
  }
  if (keep.length !== rec.subs.length) {
    // Im selben Objekt ändern, damit ein späteres Speichern die toten Abos nicht zurückholt
    rec.subs = keep;
    await saveUser(kv, u, rec);
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Regelmäßige Prüfung (Zeitplan): Wants, verliehene Platten, Set-Termine
// ---------------------------------------------------------------------------
export interface Stat {
  lowest_price?: { value: number; currency: string } | null;
  num_for_sale?: number;
}

const fmt = (v: number, cur = "EUR") => new Intl.NumberFormat("de-DE", { style: "currency", currency: cur }).format(v);

/** Was hat sich bei einer Want geändert? Reine Funktion, damit testbar. */
export function wantChange(w: WatchedWant, s: Stat, cur = "EUR"): Message | null {
  const n = s.num_for_sale ?? 0;
  const low = s.lowest_price?.value ?? null;
  const name = `${w.a} – ${w.t}`;
  const url = `/release/${w.id}`;
  if (w.n === 0 && n > 0) return { title: "Wieder verfügbar", body: `${name}${low != null ? ` ab ${fmt(low, cur)}` : ""}`, url, tag: `want-${w.id}` };
  if (low != null && w.target && low <= w.target && (w.low == null || w.low > w.target)) return { title: "Unter deinem Wunschpreis", body: `${name} gibt es jetzt ab ${fmt(low, cur)} (Wunsch: ${fmt(w.target, cur)})`, url, tag: `want-${w.id}` };
  if (low != null && w.low != null && low <= w.low * 0.85 && w.low - low >= 2) return { title: "Preis gefallen", body: `${name}: ${fmt(w.low, cur)} → ${fmt(low, cur)}`, url, tag: `want-${w.id}` };
  return null;
}

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Erinnerungen, die jetzt fällig sind. Reine Funktion, damit testbar. Gerechnet wird in der Ortszeit des Geräts
 * (rec.tz), sonst käme „Heute ist dein Set“ in anderen Zeitzonen mitten in der Nacht.
 *  - verliehene Platten nach 3, 6 und 10 Wochen
 *  - Set: am Vorabend (Kiste, Nadel), am Tag selbst, am Tag danach (was lief?)
 *  - Jahresrückblick ab dem 15. Dezember, einmal
 *  - Profil noch leer: ein einziges Mal, drei Tage nach dem Einschalten
 *  - Platte des Tages am Vormittag (nur wer sie eingeschaltet hat)
 */
export function dueReminders(rec: UserRec, now = Date.now()): { key: string; kind: PushKind; msg: Message }[] {
  const out: { key: string; kind: PushKind; msg: Message }[] = [];
  const add = (key: string, kind: PushKind, msg: Message) => {
    if (!rec.sent[key] && kindOn(rec, kind)) out.push({ key, kind, msg });
  };
  for (const l of rec.lent ?? []) {
    const weeks = (now - l.at) / (7 * DAY);
    // Nur die höchste erreichte Stufe melden (wer erst nach 10 Wochen einträgt, bekommt nicht 3 Meldungen)
    const reached = [10, 6, 3].find((w) => weeks >= w);
    if (reached) add(`lent-${l.id}-${reached}`, "lent", { title: "Verliehene Platte", body: `${l.t} ist seit ${reached} Wochen bei ${l.to}.`, url: `/release/${l.id}`, tag: `lent-${l.id}` });
  }
  // Ortszeit: ohne Angabe Mitteleuropa (Winter)
  const local = now - (rec.tz ?? -60) * 60_000;
  const today = isoDay(local);
  const tomorrow = isoDay(local + DAY);
  const yesterday = isoDay(local - DAY);
  const hour = new Date(local).getUTCHours();
  const worn = rec.stylus && rec.stylus.pct >= 0.9 ? ` Deine Nadel${rec.stylus.name ? ` (${rec.stylus.name})` : ""} hat schon ${Math.round(rec.stylus.pct * 100)} % ihrer Stunden.` : "";
  for (const s of rec.sets ?? []) {
    const crate = s.n ? `${s.n} ${s.n === 1 ? "Platte" : "Platten"} in der Kiste.` : "";
    const url = `/sets/${s.id}`;
    const tag = `set-${s.id}`;
    // Am Vorabend: Zeit zum Packen. Hier zählt auch die Nadel.
    if (s.date === tomorrow && hour >= 18) add(`setpre-${s.id}-${s.date}`, "sets", { title: `Morgen${s.start ? ` um ${s.start}` : ""}: ${s.name}`, body: `${crate || "Kiste schon gepackt?"}${worn || " Nadeln und Kopfhörer nicht vergessen."}`.trim(), url, tag });
    // Am Tag selbst ab dem Vormittag
    if (s.date === today && hour >= 10) add(`set-${s.id}-${s.date}`, "sets", { title: s.start ? `Heute um ${s.start}: ${s.name}` : "Heute ist dein Set", body: `${s.start ? "" : `${s.name}: `}${crate ? `${crate} ` : ""}Platten einpacken nicht vergessen.`, url, tag });
    // Am Tag danach: festhalten, was lief (zählt für Verlauf und Nadel-Stunden)
    if (s.date === yesterday && hour >= 11) add(`setpost-${s.id}-${s.date}`, "sets", { title: `Wie lief ${s.name}?`, body: "Hak ab, was du gespielt hast. Das zählt für deinen Verlauf und die Nadel-Stunden.", url, tag });
  }
  // Jahresrückblick: erscheint am 15. Dezember (REVIEW_DAY), einmal im Jahr
  const year = today.slice(0, 4);
  if (today.slice(5, 7) === "12" && Number(today.slice(8, 10)) >= REVIEW_DAY && hour >= 10)
    add(`year-${year}`, "tips", { title: `Dein Jahr auf Platte ist da`, body: `Rückblick ${year}: was dazukam, was am meisten lief, wo du aufgelegt hast. Einmal durchblättern?`, url: "/year", tag: "year" });
  // Profil noch leer: einmal, ein paar Tage nach dem Einschalten, am frühen Abend. Kein zweites Mal (profileNudge wird dann 0).
  if (rec.profileNudge && now >= rec.profileNudge && hour >= 17)
    add("profile", "tips", { title: "Dein Profil ist noch leer", body: "DJ-Name, Styles, Setup: in einer Minute gemacht. Dann sehen deine Freunde, wer du bist.", url: "/settings/profile", tag: "profile" });
  // Platte des Tages am Vormittag
  const pick = (rec.daily ?? []).find((d) => d.d === today);
  if (pick && hour >= 9) add(`daily-${today}`, "daily", { title: "Platte des Tages", body: `${pick.a} – ${pick.t}${pick.why ? `. ${pick.why}` : ""}`, url: `/release/${pick.id}`, tag: "daily" });
  return out;
}

/** Mehrere Want-Meldungen zu einer Mitteilung bündeln */
export function bundle(msgs: Message[]): Message | null {
  if (!msgs.length) return null;
  if (msgs.length === 1) return msgs[0];
  return { title: `${msgs.length} Neuigkeiten auf deiner Wantlist`, body: msgs.map((m) => `${m.title}: ${m.body}`).join("\n").slice(0, 300), url: "/wants", tag: "wants" };
}

/**
 * Welche Wants in dieser Runde prüfen? Wichtige (ohne Angebot, mit Wunschpreis, noch nie geprüft)
 * kommen viel öfter dran als der Rest. Die Runde ergibt sich aus der Uhrzeit, so muss kein Zeiger
 * gespeichert werden.
 */
export function pickWants(wants: WatchedWant[], slot: number, hotN = 20, normalN = 10): number[] {
  const hot: number[] = [];
  const normal: number[] = [];
  wants.forEach((w, i) => ((w.n == null || w.n === 0 || w.target) ? hot : normal).push(i));
  const take = (list: number[], n: number) => {
    if (list.length <= n) return list;
    const start = (slot * n) % list.length;
    return Array.from({ length: n }, (_, k) => list[(start + k) % list.length]);
  };
  return [...take(hot, hotN), ...take(normal, normalN)];
}

export const SLOT_MINUTES = 10;
export const currentSlot = (now = Date.now()) => Math.floor(now / (SLOT_MINUTES * 60_000));

/** Nur echte Push-Dienste als Ziel zulassen (sonst könnte man den Server beliebige Adressen anfragen lassen) */
export function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^(fcm\.googleapis\.com|android\.googleapis\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}
