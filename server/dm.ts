// Nachrichten unter Freunden: Text, Leihanfrage für eine Platte und die Antwort darauf.
// Eine Unterhaltung ist das Paar der beiden Namen (klein geschrieben, sortiert, mit „|“ verbunden).
// Auf Cloudflare: D1 (Binding SYNC, Schema unten und in migrations/0005_dm.sql). Lokal: Arbeitsspeicher.
import type { D1Like } from "./devsync";

/** text = Nachricht, borrow = „Kann ich mir die leihen?“, yes/no = Antwort auf die Leihanfrage */
export type DmKind = "text" | "borrow" | "yes" | "no";
export const DM_KINDS: DmKind[] = ["text", "borrow", "yes", "no"];

export interface Dm {
  id: number;
  from: string;
  to: string;
  kind: DmKind;
  text?: string | null;
  /** Platte, um die es geht (Leihanfrage, Antwort, oder einfach angehängt) */
  releaseId?: number | null;
  title?: string | null;
  thumb?: string | null;
  ts: number;
  read: boolean;
}
export interface DmThread {
  with: string;
  last: Dm;
  unread: number;
}

export interface DmStore {
  send(m: Omit<Dm, "id" | "read">): Promise<number>;
  /** Älteste zuerst, höchstens `limit`, optional nur Nachrichten vor `before` (id) */
  thread(a: string, b: string, limit: number, before?: number): Promise<Dm[]>;
  threads(user: string): Promise<DmThread[]>;
  unread(user: string): Promise<number>;
  markRead(user: string, other: string): Promise<void>;
  get(id: number): Promise<Dm | null>;
  remove(id: number): Promise<void>;
  sentSince(from: string, since: number): Promise<number>;
  /** Alles von und an diesen Nutzer löschen */
  clear(user: string): Promise<void>;
}

export const pairOf = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join("|");

export const DM_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS dm (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, release_id INTEGER, title TEXT, thumb TEXT, ts INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS dm_pair ON dm (pair, id)",
  "CREATE INDEX IF NOT EXISTS dm_recipient ON dm (recipient, seen)",
  "CREATE INDEX IF NOT EXISTS dm_sender ON dm (sender, ts)",
];

interface Row {
  id: number;
  sender: string;
  recipient: string;
  kind: DmKind;
  text: string | null;
  release_id: number | null;
  title: string | null;
  thumb: string | null;
  ts: number;
  seen: number;
}
const COLS = "id, sender, recipient, kind, text, release_id, title, thumb, ts, seen";
const fromRow = (x: Row): Dm => ({ id: x.id, from: x.sender, to: x.recipient, kind: x.kind, text: x.text, releaseId: x.release_id, title: x.title, thumb: x.thumb, ts: x.ts, read: Boolean(x.seen) });

export function d1Dm(db: D1Like): DmStore {
  return {
    async send(m) {
      const r = await db
        .prepare("INSERT INTO dm (pair, sender, recipient, kind, text, release_id, title, thumb, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(pairOf(m.from, m.to), m.from, m.to, m.kind, m.text ?? null, m.releaseId ?? null, m.title ?? null, m.thumb ?? null, m.ts)
        .first<{ id: number }>();
      return r?.id ?? 0;
    },
    async thread(a, b, limit, before) {
      const r = before
        ? await db.prepare(`SELECT ${COLS} FROM dm WHERE pair = ? AND id < ? ORDER BY id DESC LIMIT ?`).bind(pairOf(a, b), before, limit).all<Row>()
        : await db.prepare(`SELECT ${COLS} FROM dm WHERE pair = ? ORDER BY id DESC LIMIT ?`).bind(pairOf(a, b), limit).all<Row>();
      return r.results.map(fromRow).reverse();
    },
    async threads(user) {
      const [last, open] = await Promise.all([
        db.prepare(`SELECT ${COLS} FROM dm WHERE id IN (SELECT MAX(id) FROM dm WHERE sender = ? OR recipient = ? GROUP BY pair) ORDER BY id DESC LIMIT 60`).bind(user, user).all<Row>(),
        db.prepare("SELECT sender, COUNT(*) AS n FROM dm WHERE recipient = ? AND seen = 0 GROUP BY sender").bind(user).all<{ sender: string; n: number }>(),
      ]);
      const n = new Map(open.results.map((x) => [x.sender, x.n]));
      return last.results.map(fromRow).map((m) => {
        const other = m.from === user ? m.to : m.from;
        return { with: other, last: m, unread: n.get(other) ?? 0 };
      });
    },
    async unread(user) {
      const r = await db.prepare("SELECT COUNT(*) AS n FROM dm WHERE recipient = ? AND seen = 0").bind(user).first<{ n: number }>();
      return r?.n ?? 0;
    },
    async markRead(user, other) {
      await db.prepare("UPDATE dm SET seen = 1 WHERE recipient = ? AND sender = ? AND seen = 0").bind(user, other).run();
    },
    async get(id) {
      const r = await db.prepare(`SELECT ${COLS} FROM dm WHERE id = ?`).bind(id).first<Row>();
      return r ? fromRow(r) : null;
    },
    async remove(id) {
      await db.prepare("DELETE FROM dm WHERE id = ?").bind(id).run();
    },
    async sentSince(from, since) {
      const r = await db.prepare("SELECT COUNT(*) AS n FROM dm WHERE sender = ? AND ts > ?").bind(from, since).first<{ n: number }>();
      return r?.n ?? 0;
    },
    async clear(user) {
      await db.prepare("DELETE FROM dm WHERE sender = ? OR recipient = ?").bind(user, user).run();
    },
  };
}

export function memoryDm(): DmStore {
  let all: Dm[] = [];
  let seq = 0;
  return {
    async send(m) {
      all.push({ ...m, id: ++seq, read: false });
      return seq;
    },
    async thread(a, b, limit, before) {
      const p = pairOf(a, b);
      return all.filter((m) => pairOf(m.from, m.to) === p && (!before || m.id < before)).slice(-limit);
    },
    async threads(user) {
      const by = new Map<string, Dm>();
      for (const m of all) if (m.from === user || m.to === user) by.set(m.from === user ? m.to : m.from, m);
      return [...by.entries()].map(([other, last]) => ({ with: other, last, unread: all.filter((m) => m.to === user && m.from === other && !m.read).length })).sort((a, b) => b.last.id - a.last.id);
    },
    async unread(user) {
      return all.filter((m) => m.to === user && !m.read).length;
    },
    async markRead(user, other) {
      all = all.map((m) => (m.to === user && m.from === other ? { ...m, read: true } : m));
    },
    async get(id) {
      return all.find((m) => m.id === id) ?? null;
    },
    async remove(id) {
      all = all.filter((m) => m.id !== id);
    },
    async sentSince(from, since) {
      return all.filter((m) => m.from === from && m.ts > since).length;
    },
    async clear(user) {
      all = all.filter((m) => m.from !== user && m.to !== user);
    },
  };
}

/** Text der Mitteilung zu einer Nachricht: was auf dem Sperrbildschirm steht */
export function dmNotice(name: string, m: Pick<Dm, "kind" | "text" | "title">): { title: string; body: string } {
  const what = m.title ?? "eine Platte";
  if (m.kind === "borrow") return { title: `${name} möchte sich eine Platte leihen`, body: m.text ? `${what}: ${m.text}` : what };
  if (m.kind === "yes") return { title: `${name}: Klar, kannst du haben`, body: m.text ? `${what}: ${m.text}` : what };
  if (m.kind === "no") return { title: `${name}: Gerade nicht`, body: m.text ? `${what}: ${m.text}` : what };
  return { title: name, body: m.text || what };
}
