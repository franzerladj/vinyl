// Mitteilungen für die Android-App ohne Browser: die App holt sie selbst ab (android/…/Poller.java).
// Je Gerät ein Kennwort (64 Hex-Zeichen), das die Webseite beim Einschalten bekommt und an die App reicht.
// Was der Server melden will, wartet hier, bis die App das nächste Mal fragt (etwa alle 15 Minuten und bei jedem Öffnen).
// Auf Cloudflare: D1 (Binding SYNC, Schema unten und in migrations/0003_native.sql). Lokal: Arbeitsspeicher.
import type { D1Like } from "./devsync";
import type { Message } from "./push";

export interface NativeDevice {
  user: string;
  /** Wann die App zuletzt abgeholt hat (null = noch nie, also noch nicht verbunden) */
  seen: number | null;
  /** Erlaubt Android der App gerade Mitteilungen? */
  ok: boolean;
}

export interface NativeStore {
  link(token: string, user: string, ts: number): Promise<void>;
  device(token: string): Promise<NativeDevice | null>;
  touch(token: string, ok: boolean, ts: number): Promise<void>;
  enqueue(tokens: string[], msg: Message, ts?: number): Promise<void>;
  /** Wartende Mitteilungen holen und entfernen (älteste zuerst) */
  take(token: string): Promise<Message[]>;
  remove(token: string): Promise<void>;
  /** Alle Geräte eines Nutzers entfernen */
  clear(user: string): Promise<void>;
}

export const NATIVE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS native_devices (token TEXT PRIMARY KEY, user TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER, ok INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS native_devices_user ON native_devices (user)",
  "CREATE TABLE IF NOT EXISTS native_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, ts INTEGER NOT NULL, msg TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS native_queue_token ON native_queue (token, id)",
];

/** Länger wartet nichts: wer drei Tage nicht abholt, bekommt Altes nicht mehr nachgereicht */
export const QUEUE_MAX_AGE = 3 * 86_400_000;
/** Höchstens so viele je Gerät auf einmal */
export const QUEUE_MAX = 12;

const slim = (m: Message): Message => ({ title: String(m.title).slice(0, 120), body: String(m.body).slice(0, 400), url: m.url, tag: m.tag });

export function d1Native(db: D1Like): NativeStore {
  return {
    async link(token, user, ts) {
      await db.prepare("INSERT INTO native_devices (token, user, created) VALUES (?, ?, ?) ON CONFLICT(token) DO NOTHING").bind(token, user, ts).run();
    },
    async device(token) {
      const r = await db.prepare("SELECT user, seen, ok FROM native_devices WHERE token = ?").bind(token).first<{ user: string; seen: number | null; ok: number }>();
      return r ? { user: r.user, seen: r.seen, ok: Boolean(r.ok) } : null;
    },
    async touch(token, ok, ts) {
      await db.prepare("UPDATE native_devices SET seen = ?, ok = ? WHERE token = ?").bind(ts, ok ? 1 : 0, token).run();
    },
    async enqueue(tokens, msg, ts = Date.now()) {
      if (!tokens.length) return;
      const text = JSON.stringify(slim(msg));
      await db.batch(tokens.map((t) => db.prepare("INSERT INTO native_queue (token, ts, msg) VALUES (?, ?, ?)").bind(t, ts, text)));
    },
    async take(token) {
      const r = await db.prepare("SELECT id, ts, msg FROM native_queue WHERE token = ? ORDER BY id").bind(token).all<{ id: number; ts: number; msg: string }>();
      if (!r.results.length) return [];
      await db.prepare("DELETE FROM native_queue WHERE token = ? AND id <= ?").bind(token, r.results[r.results.length - 1].id).run();
      return pick(r.results.map((x) => ({ ts: x.ts, msg: JSON.parse(x.msg) as Message })));
    },
    async remove(token) {
      await db.batch([db.prepare("DELETE FROM native_devices WHERE token = ?").bind(token), db.prepare("DELETE FROM native_queue WHERE token = ?").bind(token)]);
    },
    async clear(user) {
      await db.batch([db.prepare("DELETE FROM native_queue WHERE token IN (SELECT token FROM native_devices WHERE user = ?)").bind(user), db.prepare("DELETE FROM native_devices WHERE user = ?").bind(user)]);
    },
  };
}

/** Frische Mitteilungen, je Kennzeichen (tag) nur die neueste, höchstens QUEUE_MAX */
export function pick(rows: { ts: number; msg: Message }[], now = Date.now()): Message[] {
  const byTag = new Map<string, Message>();
  rows.forEach((r, i) => {
    if (now - r.ts > QUEUE_MAX_AGE) return;
    const key = r.msg.tag || `#${i}`;
    // Neuere ersetzt die ältere mit demselben Kennzeichen und rückt ans Ende
    byTag.delete(key);
    byTag.set(key, r.msg);
  });
  return [...byTag.values()].slice(-QUEUE_MAX);
}

export function memoryNative(): NativeStore {
  const devices = new Map<string, NativeDevice>();
  let queue: { token: string; ts: number; msg: Message }[] = [];
  return {
    async link(token, user) {
      if (!devices.has(token)) devices.set(token, { user, seen: null, ok: false });
    },
    async device(token) {
      const d = devices.get(token);
      return d ? { ...d } : null;
    },
    async touch(token, ok, ts) {
      const d = devices.get(token);
      if (d) devices.set(token, { ...d, seen: ts, ok });
    },
    async enqueue(tokens, msg, ts = Date.now()) {
      for (const token of tokens) queue.push({ token, ts, msg: slim(msg) });
    },
    async take(token) {
      const mine = queue.filter((q) => q.token === token);
      queue = queue.filter((q) => q.token !== token);
      return pick(mine);
    },
    async remove(token) {
      devices.delete(token);
      queue = queue.filter((q) => q.token !== token);
    },
    async clear(user) {
      for (const [t, d] of devices)
        if (d.user === user) {
          devices.delete(t);
          queue = queue.filter((q) => q.token !== t);
        }
    },
  };
}
