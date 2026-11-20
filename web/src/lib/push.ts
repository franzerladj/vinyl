// Push-Mitteilungen: Gerät anmelden, Einstellungen, Daten für den Zeitplan an den Server geben.
// Auf dem iPhone gehen Mitteilungen nur, wenn Crate zum Home-Bildschirm hinzugefügt ist (ab iOS 16.4).
import { db, getKV, setKV } from "./db";
import { VAPID_PUBLIC_KEY } from "../../../shared/pushKey";
import { APK, APK_SELF_UPDATE_FROM } from "../../../shared/appVersion";

export type PushKind = "friends" | "wants" | "lent" | "sets" | "sellers" | "tips" | "daily";
export type PushPrefs = Record<PushKind, boolean>;
/** „Platte des Tages“ kommt täglich und ist deshalb erst an, wenn man sie einschaltet (wie KIND_DEFAULT auf dem Server) */
export const DEFAULT_PREFS: PushPrefs = { friends: true, wants: true, lent: true, sets: true, sellers: true, tips: true, daily: false };
/** Gespeicherte Einstellungen kennen neuere Arten evtl. noch nicht: mit den Vorgaben auffüllen */
export const fullPrefs = (p?: Partial<PushPrefs> | null): PushPrefs => ({ ...DEFAULT_PREFS, ...(p ?? {}) });

const json = async <T,>(path: string, body?: unknown): Promise<T> => {
  const r = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "include", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(j.message ?? `Fehler ${r.status}`);
  return j;
};

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export type PushSupport = "ok" | "install" | "unsupported";
/** Was geht auf diesem Gerät? "install" = iPhone im Browser, erst zum Home-Bildschirm hinzufügen */
export function pushSupport(): PushSupport {
  // Die Android-App zeigt Mitteilungen selbst an, der Browser muss dafür nichts können
  if (nativePush()) return "ok";
  if (isIOS() && !isStandalone()) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// ---------- Android-App (Trusted Web Activity) ----------
// Die App startet mit ?app=android&v=<versionCode>. Ältere Versionen erkennt man am Verweis android-app://.
interface AppInfo { android: boolean; v: number }
export function noteAppLaunch() {
  try {
    const q = new URLSearchParams(location.search);
    const fromApp = q.get("app") === "android" || document.referrer.startsWith("android-app://de.feuerpfeil.crate");
    if (fromApp) localStorage.setItem("crate:app", JSON.stringify({ android: true, v: Number(q.get("v")) || 0 }));
  } catch {
    /* egal */
  }
}
export function appInfo(): AppInfo {
  try {
    return { android: false, v: 0, ...JSON.parse(localStorage.getItem("crate:app") ?? "{}") };
  } catch {
    return { android: false, v: 0 };
  }
}
/** Aktuelle Android-App (versionCode). Ältere bekommen auf Start einen Hinweis zum Aktualisieren. */
export const LATEST_APK = APK.code;
/** Versionsname je versionCode der Android-App (für die Anzeige) */
export const APK_NAMES: Record<number, string> = { [APK.code]: APK.name, 10: "1.9", 9: "1.8", 8: "1.7", 7: "1.6", 6: "1.5" };
export const apkName = (v: number) => APK_NAMES[v] ?? (v ? `Stand ${v}` : "ältere Version");
/**
 * Wie Crate gerade läuft. Wichtig zum Auseinanderhalten: Chrome kann die Seite auch selbst installieren
 * („App installieren“ im Chrome-Menü). Das ist eine zweite, eigene App mit eigenem Icon, das Google nur
 * langsam erneuert: wer dort das alte Logo sieht, hat nicht die Crate-App aus der APK vor sich.
 */
/** Eingebaute Browser von Instagram, Facebook, WhatsApp-Vorschau, Line, TikTok und Co.: Anmelden und Installieren klappen dort oft nicht */
export const inAppBrowser = () => /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat|Pinterest|LinkedInApp|GSA\/|; wv\)/i.test(navigator.userAgent);
/** Adresse, die auf Android dieselbe Seite im richtigen Chrome öffnet (aus der App oder einem eingebauten Browser heraus) */
export const openInChromeUrl = (path = "/") =>
  `intent://${location.host}${path}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(location.origin + path)};end`;

export function runningAs(): string {
  const a = appInfo();
  if (a.android) return `Android-App ${apkName(a.v)}`;
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  if (standalone) return /Android/i.test(navigator.userAgent) ? "über Chrome installiert (nicht die Crate-App)" : "vom Home-Bildschirm";
  return "im Browser";
}
export const apkOutdated = () => appInfo().android && appInfo().v > 0 && appInfo().v < LATEST_APK;

/**
 * Ab App 1.10 aktualisiert sich die App selbst: sie lädt die neue Version, prüft sie und öffnet den
 * Installations-Dialog von Android (crate://update → UpdateActivity). Ältere Apps laden die Datei wie bisher.
 * Gemeint ist nur die Hülle. Der Inhalt der App kommt wie eine Webseite und erneuert sich ohnehin von selbst.
 */
export const canSelfUpdate = () => appInfo().android && appInfo().v >= APK_SELF_UPDATE_FROM;
export function updateApp() {
  location.href = "intent://update#Intent;scheme=crate;package=de.feuerpfeil.crate;end";
}

/** Ab App-Version 1.7 fragt die App selbst (Dialog, sonst Einstellungen) und meldet Chrome nie mehr „gesperrt“ */
export const appAsksItself = () => appInfo().android && appInfo().v >= 8;

/** Ab App-Version 1.5 öffnet ein Knopf direkt die Mitteilungs-Einstellungen von Android */
export const canOpenAndroidSettings = () => appInfo().android && appInfo().v >= 6;
export function openAndroidNotificationSettings() {
  location.href = "intent://notifications#Intent;scheme=crate;package=de.feuerpfeil.crate;end";
}

// ---------- Mitteilungen direkt in der Android-App (ab 1.9) ----------
// Chrome gab die Erlaubnis der App nicht verlässlich an die Seite weiter („gesperrt“, obwohl in Android erlaubt).
// Ab 1.9 braucht es Chrome dafür nicht mehr: die Seite holt beim Server ein Kennwort für dieses Gerät und reicht es
// über crate://push an die App. Die App fragt Android selbst nach der Erlaubnis, holt Mitteilungen beim Server ab
// (bei jedem Öffnen und etwa alle 15 Minuten) und zeigt sie an. `Notification.permission` spielt keine Rolle mehr.
export const nativePush = () => appInfo().android && appInfo().v >= 10;
const NATIVE_KEY = "crate:native-push";
export const nativeToken = (): string | null => {
  try {
    return localStorage.getItem(NATIVE_KEY);
  } catch {
    return null;
  }
};
const setNativeToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(NATIVE_KEY, t);
    else localStorage.removeItem(NATIVE_KEY);
  } catch {
    /* egal */
  }
};
const openApp = (query: string) => {
  location.href = `intent://push?${query}#Intent;scheme=crate;package=de.feuerpfeil.crate;end`;
};
/** Die App soll jetzt abholen (z. B. die Test-Mitteilung), nicht erst beim nächsten Durchlauf */
export const nativePollNow = () => openApp("poll=1");
export interface NativeStatus {
  known: boolean;
  linked: boolean;
  ok: boolean;
  /** Wann die App zuletzt abgeholt hat und wodurch (link, now, open, alarm, job, boot) */
  seen?: number | null;
  src?: string | null;
  /** Ist die App vom Akku-Sparen ausgenommen? Sonst schiebt Android das Abholen auf. */
  exempt?: boolean | null;
  /** Mitteilungen, die noch auf dem Server liegen */
  waiting?: number;
}
export const nativeStatus = (t: string) => json<NativeStatus>(`/api/push/native/status?t=${t}`);
/** Stand dieses Geräts, wenn die Mitteilungen über die App laufen (sonst null) */
export const myNativeStatus = async (): Promise<NativeStatus | null> => {
  const t = nativeToken();
  return nativePush() && t ? nativeStatus(t).catch(() => null) : null;
};
/** Die Akku-Ausnahme nachholen: derselbe Weg wie beim Einschalten, das Kennwort bleibt */
export function askBatteryExemption() {
  const t = nativeToken();
  if (t) openApp(`t=${t}`);
}

/** Warten, bis die App das Kennwort übernommen und dem Server gemeldet hat, ob Android Mitteilungen erlaubt */
async function waitForApp(token: string, ms: number): Promise<"ok" | "blocked" | "silent"> {
  const until = Date.now() + ms;
  let last: { linked: boolean; ok: boolean } | null = null;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1200));
    last = await nativeStatus(token).catch(() => last);
    // Die App meldet sich erst, wenn sie mit Dialog oder Einstellungen fertig ist
    if (last?.linked) return last.ok ? "ok" : "blocked";
  }
  return "silent";
}

async function enableNative(prefs: PushPrefs): Promise<PushPrefs> {
  const r = await json<{ token: string; prefs: PushPrefs }>("/api/push/native/start", { prefs, replace: nativeToken() ?? undefined });
  setNativeToken(r.token);
  // Ein altes Browser-Abo dieses Geräts braucht es nicht mehr (sonst käme alles doppelt)
  void currentWebSubscription().then(async (sub) => {
    if (!sub) return;
    await json("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  });
  openApp(`t=${r.token}`);
  // Die App fragt jetzt Android (Dialog oder Einstellungen). Das kann dauern, wenn man in die Einstellungen muss.
  const state = await waitForApp(r.token, 60_000);
  if (state === "blocked") throw new PushBlocked();
  // Meldet sie sich später doch noch (lange in den Einstellungen gewesen), schaltet resumePushIfWanted beim Zurückkommen ein
  if (state === "silent") throw new Error("Die App hat sich noch nicht gemeldet. Bitte Crate schließen, neu öffnen und den Schalter nochmal antippen.");
  await setKV("pushOn", true);
  await syncPushData();
  return r.prefs;
}

async function currentWebSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Mitteilungen sind gesperrt (Android oder Browser): die Oberfläche zeigt dann den Weg zum Erlauben */
export class PushBlocked extends Error {
  constructor() {
    super("Mitteilungen sind gesperrt");
  }
}

/** Mitteilungen einschalten (muss aus einem Tipp heraus aufgerufen werden) */
export async function enablePush(prefs: PushPrefs = DEFAULT_PREFS): Promise<PushPrefs> {
  // Die Frage nach der Erlaubnis zuerst und ohne Umweg: Safari fragt nur direkt aus dem Tipp heraus,
  // nach einem Warten auf den Speicher gälte der Tipp als verfallen und es sähe aus wie „gesperrt“.
  const asking = nativePush() || Notification.permission === "granted" ? null : Notification.requestPermission();
  // Wunsch merken: kommt die Erlaubnis später (z. B. aus den Android-Einstellungen zurück), schaltet Crate selbst ein
  await setKV("pushWanted", true);
  if (nativePush()) return enableNative(prefs);
  const perm = asking ? await asking : "granted";
  if (perm === "denied") throw new PushBlocked();
  if (perm !== "granted") throw new Error(appAsksItself() ? "Mitteilungen sind in Android noch aus. Tipp den Schalter nochmal an und erlaube sie." : "Ohne Erlaubnis gehen keine Mitteilungen");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const r = await json<{ prefs: PushPrefs }>("/api/push/subscribe", { subscription: sub.toJSON(), prefs });
  await setKV("pushOn", true);
  await syncPushData();
  return r.prefs;
}

/**
 * Beim Start und beim Zurückkommen in die App: war Mitteilungen gewünscht und ist die Erlaubnis jetzt da,
 * still einschalten. So reicht es, in Android zu erlauben und zurückzukommen.
 */
export async function resumePushIfWanted(): Promise<boolean> {
  if (nativePush()) {
    // Stand der App nachsehen: in Android erlaubt oder entzogen, auf einem anderen Gerät abgemeldet
    const t = nativeToken();
    const on = await getKV("pushOn", false);
    if (!t) {
      // Neue App, aber noch das alte Browser-Abo: der Schalter zeigt „aus“, bis man ihn einmal antippt
      if (on) await setKV("pushOn", false);
      return false;
    }
    const st = await nativeStatus(t).catch(() => null);
    if (!st) return false;
    const now = st.known && st.linked && st.ok;
    if (now === on) return false;
    await setKV("pushOn", now);
    if (!st.known) setNativeToken(null);
    if (now) await syncPushData();
    return now && Boolean(await getKV("pushWanted", false));
  }
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  if (!(await getKV("pushWanted", false))) return false;
  if ((await getKV("pushOn", false)) && (await currentSubscription())) return false;
  try {
    await enablePush(fullPrefs(await getKV<PushPrefs | null>("pushPrefs", null)));
    await sendTestPush().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function disablePush() {
  await setKV("pushWanted", false);
  const t = nativeToken();
  if (t) {
    await json("/api/push/native/stop", { token: t }).catch(() => undefined);
    setNativeToken(null);
  }
  const sub = await currentWebSubscription();
  await json("/api/push/unsubscribe", { endpoint: sub?.endpoint }).catch(() => undefined);
  await sub?.unsubscribe().catch(() => undefined);
  await setKV("pushOn", false);
}

export const pushStatus = () => json<{ available: boolean; devices: number; prefs: PushPrefs | null }>("/api/push/status");
export const savePushPrefs = (p: Partial<PushPrefs>) => json<{ prefs: PushPrefs }>("/api/push/prefs", p);
export async function sendTestPush(): Promise<{ sent: number; devices: number; fetched?: boolean }> {
  const r = await json<{ sent: number; devices: number }>("/api/push/test", {});
  const t = nativeToken();
  if (!nativePush() || !t) return r;
  // Die App soll sie gleich abholen statt beim nächsten Durchlauf. Danach nachsehen, ob sie es getan hat.
  nativePollNow();
  for (let i = 0; i < 6; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const st = await nativeStatus(t).catch(() => null);
    if (st && st.waiting === 0) return { ...r, fetched: true };
  }
  return { ...r, fetched: false };
}

const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Platte des Tages für die nächsten Tage: der Server kennt die Sammlung nicht, also rechnet das Gerät vor */
async function upcomingDaily(days = 7): Promise<{ d: string; id: number; t: string; a: string; why?: string }[]> {
  const { dailyPick } = await import("../../../shared/daily");
  const coll = (await db.collection.toArray()).map((c) => ({ id: c.releaseId, dateAdded: c.dateAdded }));
  if (!coll.length) return [];
  const since = dayOf(Date.now() - 60 * 864e5);
  const today = dayOf(Date.now());
  const sets = (await db.sets.toArray()).filter((s) => s.date && s.date >= since && s.date <= today);
  const played = new Set(((await db.tracks.bulkGet(sets.flatMap((s) => (s.played?.length ? s.played : s.trackIds)))).filter(Boolean) as { releaseId: number }[]).map((t) => t.releaseId));
  const out: { d: string; id: number; t: string; a: string; why?: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = dayOf(Date.now() + i * 864e5);
    const p = dailyPick(coll, d, played);
    const rel = p && (await db.releases.get(p.id));
    if (p && rel) out.push({ d, id: p.id, t: rel.title, a: rel.artist, why: p.reason || undefined });
  }
  return out;
}

/**
 * Was der Zeitplan auf dem Server braucht (nur wenn Mitteilungen an sind): Wants mit Wunschpreisen, verliehene
 * Platten, Sets von gestern bis in die Zukunft (Vorabend, Tag selbst, Tag danach), Zeitzone, Stand der Nadel
 * und, wer sie eingeschaltet hat, die Platte des Tages für die nächsten Tage.
 */
export async function syncPushData() {
  if (!(await getKV("pushOn", false))) return;
  const [wants, metas, recordMeta, sets, currency, prefs] = await Promise.all([db.wants.toArray(), db.wantMeta.toArray(), db.recordMeta.toArray(), db.sets.toArray(), getKV("currency", "EUR"), getKV<Partial<PushPrefs> | null>("pushPrefs", null)]);
  const targets = new Map(metas.map((m) => [m.releaseId, m.targetPrice ?? null]));
  const ids = [...new Set([...wants.map((w) => w.releaseId), ...recordMeta.filter((m) => m.lentTo).map((m) => m.releaseId)])];
  const rels = new Map((await db.releases.bulkGet(ids)).filter(Boolean).map((r) => [r!.id, r!]));
  const yesterday = dayOf(Date.now() - 864e5);
  const stylus = await import("./stylus").then((m) => m.computeStylus()).catch(() => null);
  const daily = fullPrefs(prefs).daily ? await upcomingDaily().catch(() => []) : [];
  await json("/api/push/sync", {
    currency,
    tz: new Date().getTimezoneOffset(),
    stylus: stylus?.wear != null ? { pct: stylus.wear, name: stylus.state.name } : null,
    daily,
    wants: wants.map((w) => ({ id: w.releaseId, t: rels.get(w.releaseId)?.title ?? `Release ${w.releaseId}`, a: rels.get(w.releaseId)?.artist ?? "", target: targets.get(w.releaseId) ?? null })),
    lent: recordMeta.filter((m) => m.lentTo).map((m) => ({ id: m.releaseId, t: `${rels.get(m.releaseId)?.artist ?? ""} – ${rels.get(m.releaseId)?.title ?? m.releaseId}`, to: m.lentTo!, at: m.lentAt ?? Date.now() })),
    sets: sets.filter((s) => s.date && s.date >= yesterday && s.id).map((s) => ({ id: s.id!, name: s.name, date: s.date!, start: s.start, n: s.crateIds?.length || undefined })),
  }).catch((e) => console.warn("Push-Sync", e));
}

/** Freund hinzugefügt: der andere bekommt eine Mitteilung (oder später, sobald er sie einschaltet) */
export async function notifyFriendAdded(friend: string): Promise<"zugestellt" | "wartet" | "aus" | "schon-gemeldet" | null> {
  try {
    return (await json<{ status: "zugestellt" | "wartet" | "aus" | "schon-gemeldet" }>("/api/push/friend-added", { friend })).status;
  } catch {
    return null;
  }
}

/** Mitteilung direkt vom Gerät (z. B. neue Angebote bei Lieblingshändlern nach dem Sync) */
export async function localNotify(kind: PushKind, title: string, body: string, url = "/") {
  if (nativePush()) {
    // In der Android-App: beim Server hinterlegen, die App zeigt es beim nächsten Abholen
    const t = nativeToken();
    if (!t || !(await getKV("pushOn", false))) return;
    if (!fullPrefs(await getKV<Partial<PushPrefs> | null>("pushPrefs", null))[kind]) return;
    await json("/api/push/native/self", { token: t, title, body, url, tag: kind }).catch(() => undefined);
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!(await getKV("pushOn", false))) return;
  const prefs = fullPrefs(await getKV<Partial<PushPrefs> | null>("pushPrefs", null));
  if (!prefs[kind]) return;
  const reg = await navigator.serviceWorker.getRegistration();
  await reg?.showNotification(title, { body, tag: kind, icon: "/icon-192.png", badge: "/badge-96.png", data: { url } });
}
