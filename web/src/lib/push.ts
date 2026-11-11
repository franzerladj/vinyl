// Push-Mitteilungen: Gerät anmelden, Einstellungen, Daten für den Zeitplan an den Server geben.
// Auf dem iPhone gehen Mitteilungen nur, wenn Crate zum Home-Bildschirm hinzugefügt ist (ab iOS 16.4).
import { db, getKV, setKV } from "./db";
import { VAPID_PUBLIC_KEY } from "../../../shared/pushKey";

export type PushKind = "friends" | "wants" | "lent" | "sets" | "sellers";
export type PushPrefs = Record<PushKind, boolean>;
export const DEFAULT_PREFS: PushPrefs = { friends: true, wants: true, lent: true, sets: true, sellers: true };

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

/** Mitteilungen einschalten (muss aus einem Tipp heraus aufgerufen werden) */
export async function enablePush(prefs: PushPrefs = DEFAULT_PREFS): Promise<PushPrefs> {
  const perm = await Notification.requestPermission();
  // Die Anleitung steht auf der Mitteilungen-Seite (PushBlockedHelp), hier nur kurz
  if (perm !== "granted") throw new Error(perm === "denied" ? "Mitteilungen sind blockiert, Hilfe steht oben" : "Ohne Erlaubnis gehen keine Mitteilungen");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const r = await json<{ prefs: PushPrefs }>("/api/push/subscribe", { subscription: sub.toJSON(), prefs });
  await setKV("pushOn", true);
  await syncPushData();
  return r.prefs;
}

export async function disablePush() {
  const sub = await currentSubscription();
  await json("/api/push/unsubscribe", { endpoint: sub?.endpoint }).catch(() => undefined);
  await sub?.unsubscribe().catch(() => undefined);
  await setKV("pushOn", false);
}

export const pushStatus = () => json<{ available: boolean; devices: number; prefs: PushPrefs | null }>("/api/push/status");
export const savePushPrefs = (p: Partial<PushPrefs>) => json<{ prefs: PushPrefs }>("/api/push/prefs", p);
export const sendTestPush = () => json<{ sent: number; devices: number }>("/api/push/test", {});

/** Wants mit Wunschpreisen, verliehene Platten und Set-Termine an den Server geben (nur wenn Mitteilungen an sind) */
export async function syncPushData() {
  if (!(await getKV("pushOn", false))) return;
  const [wants, metas, recordMeta, sets, currency] = await Promise.all([db.wants.toArray(), db.wantMeta.toArray(), db.recordMeta.toArray(), db.sets.toArray(), getKV("currency", "EUR")]);
  const targets = new Map(metas.map((m) => [m.releaseId, m.targetPrice ?? null]));
  const ids = [...new Set([...wants.map((w) => w.releaseId), ...recordMeta.filter((m) => m.lentTo).map((m) => m.releaseId)])];
  const rels = new Map((await db.releases.bulkGet(ids)).filter(Boolean).map((r) => [r!.id, r!]));
  const today = new Date().toISOString().slice(0, 10);
  await json("/api/push/sync", {
    currency,
    wants: wants.map((w) => ({ id: w.releaseId, t: rels.get(w.releaseId)?.title ?? `Release ${w.releaseId}`, a: rels.get(w.releaseId)?.artist ?? "", target: targets.get(w.releaseId) ?? null })),
    lent: recordMeta.filter((m) => m.lentTo).map((m) => ({ id: m.releaseId, t: `${rels.get(m.releaseId)?.artist ?? ""} – ${rels.get(m.releaseId)?.title ?? m.releaseId}`, to: m.lentTo!, at: m.lentAt ?? Date.now() })),
    sets: sets.filter((s) => s.date && s.date >= today && s.id).map((s) => ({ id: s.id!, name: s.name, date: s.date! })),
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
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!(await getKV("pushOn", false))) return;
  const prefs = await getKV<PushPrefs>("pushPrefs", DEFAULT_PREFS);
  if (!prefs[kind]) return;
  const reg = await navigator.serviceWorker.getRegistration();
  await reg?.showNotification(title, { body, tag: kind, icon: "/icon-192.png", badge: "/badge-96.png", data: { url } });
}
