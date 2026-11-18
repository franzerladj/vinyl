// Soziales rund um den Freunde-Feed: Reaktionen und Kommentare auf Beiträge, Empfehlungen, Aktivitäts-Liste.
// Ein Beitrag ist „Freund + Art + Tag“ (wie im Feed gebündelt), z. B. owner „kumpel“, post „coll|2026-11-17“.
// Auf Cloudflare: D1 (Binding SYNC, Schema unten und in migrations/0002_buzz.sql). Lokal: Arbeitsspeicher.
import type { D1Like } from "./devsync";
import type { OwnPost } from "../shared/ownPost";

export interface Reaction {
  owner: string;
  post: string;
  from: string;
  ts: number;
}
export interface Comment {
  id: number;
  owner: string;
  post: string;
  from: string;
  text: string;
  ts: number;
}
export type InboxKind = "react" | "comment" | "recommend";
export interface InboxItem {
  id: number;
  to: string;
  from: string;
  kind: InboxKind;
  /** Beitrag (bei Reaktion/Kommentar) */
  post?: string | null;
  releaseId?: number | null;
  /** Titel der Platte zum Anzeigen, z. B. „Theo Parrish – Sound Sculptures“ */
  title?: string | null;
  text?: string | null;
  ts: number;
  read: boolean;
}

export interface BuzzStore {
  /** true, wenn sich etwas geändert hat (neu gesetzt bzw. entfernt) */
  react(r: Reaction, on: boolean): Promise<boolean>;
  comment(c: Omit<Comment, "id">): Promise<number>;
  getComment(id: number): Promise<Comment | null>;
  deleteComment(id: number): Promise<void>;
  commentsSince(from: string, since: number): Promise<number>;
  forOwners(owners: string[], since: number): Promise<{ reactions: Reaction[]; comments: Comment[]; posts: OwnPost[] }>;
  /** Eigener Beitrag (Set gespielt, Platte des Moments): je Besitzer, Art und Bezug einer */
  post(p: OwnPost): Promise<void>;
  removePost(owner: string, kind: string, ref: string): Promise<void>;
  notify(i: Omit<InboxItem, "id" | "read">): Promise<void>;
  inbox(user: string, limit: number): Promise<InboxItem[]>;
  markRead(user: string): Promise<void>;
  /** Alles von und über diesen Nutzer löschen */
  clear(user: string): Promise<void>;
}

export const BUZZ_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS buzz_reactions (owner TEXT NOT NULL, post TEXT NOT NULL, sender TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (owner, post, sender))",
  "CREATE TABLE IF NOT EXISTS buzz_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, post TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS buzz_comments_owner ON buzz_comments (owner, ts)",
  "CREATE TABLE IF NOT EXISTS buzz_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, sender TEXT NOT NULL, kind TEXT NOT NULL, post TEXT, release_id INTEGER, title TEXT, text TEXT, ts INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS buzz_inbox_recipient ON buzz_inbox (recipient, ts)",
  "CREATE TABLE IF NOT EXISTS buzz_posts (owner TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (owner, kind, ref))",
];

export function d1Buzz(db: D1Like): BuzzStore {
  type RawC = { id: number; owner: string; post: string; sender: string; text: string; ts: number };
  const toC = (r: RawC): Comment => ({ id: r.id, owner: r.owner, post: r.post, from: r.sender, text: r.text, ts: r.ts });
  return {
    async react(r, on) {
      const had = await db.prepare("SELECT 1 AS x FROM buzz_reactions WHERE owner = ? AND post = ? AND sender = ?").bind(r.owner, r.post, r.from).first<{ x: number }>();
      if (on === Boolean(had)) return false;
      if (on) await db.prepare("INSERT INTO buzz_reactions (owner, post, sender, ts) VALUES (?, ?, ?, ?)").bind(r.owner, r.post, r.from, r.ts).run();
      else await db.prepare("DELETE FROM buzz_reactions WHERE owner = ? AND post = ? AND sender = ?").bind(r.owner, r.post, r.from).run();
      return true;
    },
    async comment(c) {
      const row = await db.prepare("INSERT INTO buzz_comments (owner, post, sender, text, ts) VALUES (?, ?, ?, ?, ?) RETURNING id").bind(c.owner, c.post, c.from, c.text, c.ts).first<{ id: number }>();
      return row?.id ?? 0;
    },
    async getComment(id) {
      const r = await db.prepare("SELECT id, owner, post, sender, text, ts FROM buzz_comments WHERE id = ?").bind(id).first<RawC>();
      return r ? toC(r) : null;
    },
    async deleteComment(id) {
      await db.prepare("DELETE FROM buzz_comments WHERE id = ?").bind(id).run();
    },
    async commentsSince(from, since) {
      return (await db.prepare("SELECT COUNT(*) AS n FROM buzz_comments WHERE sender = ? AND ts > ?").bind(from, since).first<{ n: number }>())?.n ?? 0;
    },
    async forOwners(owners, since) {
      const reactions: Reaction[] = [];
      const comments: Comment[] = [];
      const posts: OwnPost[] = [];
      // D1 erlaubt höchstens 100 Platzhalter
      for (let i = 0; i < owners.length; i += 80) {
        const part = owners.slice(i, i + 80);
        const q = part.map(() => "?").join(",");
        const r = await db.prepare(`SELECT owner, post, sender, ts FROM buzz_reactions WHERE owner IN (${q}) AND ts > ?`).bind(...part, since).all<{ owner: string; post: string; sender: string; ts: number }>();
        reactions.push(...r.results.map((x) => ({ owner: x.owner, post: x.post, from: x.sender, ts: x.ts })));
        const c = await db.prepare(`SELECT id, owner, post, sender, text, ts FROM buzz_comments WHERE owner IN (${q}) AND ts > ? ORDER BY ts`).bind(...part, since).all<RawC>();
        comments.push(...c.results.map(toC));
        const p = await db.prepare(`SELECT owner, kind, ref, data, ts FROM buzz_posts WHERE owner IN (${q}) AND ts > ? ORDER BY ts DESC`).bind(...part, since).all<{ owner: string; kind: OwnPost["kind"]; ref: string; data: string; ts: number }>();
        posts.push(...p.results.map((x) => ({ owner: x.owner, kind: x.kind, ref: x.ref, data: JSON.parse(x.data), ts: x.ts })));
      }
      return { reactions, comments, posts };
    },
    async post(p) {
      await db.prepare("INSERT INTO buzz_posts (owner, kind, ref, data, ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, kind, ref) DO UPDATE SET data = excluded.data").bind(p.owner, p.kind, p.ref, JSON.stringify(p.data), p.ts).run();
    },
    async removePost(owner, kind, ref) {
      await db.prepare("DELETE FROM buzz_posts WHERE owner = ? AND kind = ? AND ref = ?").bind(owner, kind, ref).run();
    },
    async notify(i) {
      await db.prepare("INSERT INTO buzz_inbox (recipient, sender, kind, post, release_id, title, text, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(i.to, i.from, i.kind, i.post ?? null, i.releaseId ?? null, i.title ?? null, i.text ?? null, i.ts).run();
    },
    async inbox(user, limit) {
      const r = await db
        .prepare("SELECT id, recipient, sender, kind, post, release_id, title, text, ts, seen FROM buzz_inbox WHERE recipient = ? ORDER BY ts DESC LIMIT ?")
        .bind(user, limit)
        .all<{ id: number; recipient: string; sender: string; kind: InboxKind; post: string | null; release_id: number | null; title: string | null; text: string | null; ts: number; seen: number }>();
      return r.results.map((x) => ({ id: x.id, to: x.recipient, from: x.sender, kind: x.kind, post: x.post, releaseId: x.release_id, title: x.title, text: x.text, ts: x.ts, read: Boolean(x.seen) }));
    },
    async markRead(user) {
      await db.prepare("UPDATE buzz_inbox SET seen = 1 WHERE recipient = ? AND seen = 0").bind(user).run();
    },
    async clear(user) {
      await db.batch([
        db.prepare("DELETE FROM buzz_reactions WHERE owner = ? OR sender = ?").bind(user, user),
        db.prepare("DELETE FROM buzz_comments WHERE owner = ? OR sender = ?").bind(user, user),
        db.prepare("DELETE FROM buzz_inbox WHERE recipient = ? OR sender = ?").bind(user, user),
        db.prepare("DELETE FROM buzz_posts WHERE owner = ?").bind(user),
      ]);
    },
  };
}

export function memoryBuzz(): BuzzStore {
  let reactions: Reaction[] = [];
  let comments: Comment[] = [];
  let inbox: InboxItem[] = [];
  let posts: OwnPost[] = [];
  let seq = 0;
  return {
    async react(r, on) {
      const i = reactions.findIndex((x) => x.owner === r.owner && x.post === r.post && x.from === r.from);
      if (on === i >= 0) return false;
      if (on) reactions.push(r);
      else reactions.splice(i, 1);
      return true;
    },
    async comment(c) {
      comments.push({ ...c, id: ++seq });
      return seq;
    },
    async getComment(id) {
      return comments.find((c) => c.id === id) ?? null;
    },
    async deleteComment(id) {
      comments = comments.filter((c) => c.id !== id);
    },
    async commentsSince(from, since) {
      return comments.filter((c) => c.from === from && c.ts > since).length;
    },
    async forOwners(owners, since) {
      return {
        reactions: reactions.filter((r) => owners.includes(r.owner) && r.ts > since),
        comments: comments.filter((c) => owners.includes(c.owner) && c.ts > since).sort((a, b) => a.ts - b.ts),
        posts: posts.filter((p) => owners.includes(p.owner) && p.ts > since).sort((a, b) => b.ts - a.ts),
      };
    },
    async post(p) {
      const old = posts.find((x) => x.owner === p.owner && x.kind === p.kind && x.ref === p.ref);
      posts = [...posts.filter((x) => x !== old), old ? { ...old, data: p.data } : p];
    },
    async removePost(owner, kind, ref) {
      posts = posts.filter((x) => !(x.owner === owner && x.kind === kind && x.ref === ref));
    },
    async notify(i) {
      inbox.push({ ...i, id: ++seq, read: false });
    },
    async inbox(user, limit) {
      return inbox.filter((i) => i.to === user).sort((a, b) => b.ts - a.ts).slice(0, limit);
    },
    async markRead(user) {
      inbox = inbox.map((i) => (i.to === user ? { ...i, read: true } : i));
    },
    async clear(user) {
      reactions = reactions.filter((r) => r.owner !== user && r.from !== user);
      comments = comments.filter((c) => c.owner !== user && c.from !== user);
      inbox = inbox.filter((i) => i.to !== user && i.from !== user);
      posts = posts.filter((p) => p.owner !== user);
    },
  };
}

/** „coll|2026-11-17“, „want|2026-11-17“ oder ein eigener Beitrag: „set|1731859200000“, „spot|12345“ */
export const validPost = (p: unknown): p is string => typeof p === "string" && (/^(coll|want)\|\d{4}-\d{2}-\d{2}$/.test(p) || /^(set|spot)\|[A-Za-z0-9_-]{1,40}$/.test(p));

/** Freitext säubern: Steuerzeichen raus, Leerraum zusammenziehen, kürzen */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
