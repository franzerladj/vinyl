// Speicher für den Abgleich zwischen Geräten. Auf Cloudflare: D1 (Binding SYNC). Lokal: Arbeitsspeicher.
import { applyOp, isSyncTable, type SyncOp, type SyncRow } from "../shared/devsync";

/** Minimaler Typ für das D1-Binding */
export interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> } };
  batch(stmts: unknown[]): Promise<unknown>;
}

export interface SyncStore {
  get(user: string, keys: { t: string; k: string }[]): Promise<Map<string, SyncRow>>;
  /** Schreibt Zeilen und gibt die neue Folgenummer zurück */
  put(user: string, rows: SyncRow[]): Promise<number>;
  since(user: string, seq: number, limit: number): Promise<{ rows: (SyncRow & { seq: number })[]; seq: number }>;
  count(user: string): Promise<number>;
  clear(user: string): Promise<void>;
}

const id = (t: string, k: string) => `${t}\u0000${k}`;

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sync_rows (user TEXT NOT NULL, t TEXT NOT NULL, k TEXT NOT NULL, v TEXT, fts TEXT NOT NULL, ts INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (user, t, k))",
  "CREATE INDEX IF NOT EXISTS sync_rows_seq ON sync_rows (user, seq)",
  "CREATE TABLE IF NOT EXISTS sync_meta (user TEXT PRIMARY KEY, seq INTEGER NOT NULL)",
];

export function d1Store(db: D1Like): SyncStore {
  type Raw = { t: string; k: string; v: string | null; fts: string; ts: number; seq: number };
  const parse = (r: Raw) => ({ t: r.t as SyncRow["t"], k: r.k, v: r.v === null ? null : JSON.parse(r.v), fts: JSON.parse(r.fts), ts: r.ts, seq: r.seq });
  return {
    async get(user, keys) {
      const out = new Map<string, SyncRow>();
      // D1 erlaubt höchstens 100 Platzhalter
      for (let i = 0; i < keys.length; i += 40) {
        const part = keys.slice(i, i + 40);
        const where = part.map(() => "(t = ? AND k = ?)").join(" OR ");
        const res = await db
          .prepare(`SELECT t, k, v, fts, ts, seq FROM sync_rows WHERE user = ? AND (${where})`)
          .bind(user, ...part.flatMap((x) => [x.t, x.k]))
          .all<Raw>();
        for (const r of res.results) out.set(id(r.t, r.k), parse(r));
      }
      return out;
    },
    async put(user, rows) {
      if (!rows.length) return (await db.prepare("SELECT seq FROM sync_meta WHERE user = ?").bind(user).first<{ seq: number }>())?.seq ?? 0;
      const top = await db.prepare("INSERT INTO sync_meta (user, seq) VALUES (?, ?) ON CONFLICT(user) DO UPDATE SET seq = seq + ? RETURNING seq").bind(user, rows.length, rows.length).first<{ seq: number }>();
      const end = top?.seq ?? rows.length;
      const start = end - rows.length + 1;
      const stmts = rows.map((r, i) =>
        db
          .prepare("INSERT INTO sync_rows (user, t, k, v, fts, ts, seq) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user, t, k) DO UPDATE SET v = excluded.v, fts = excluded.fts, ts = excluded.ts, seq = excluded.seq")
          .bind(user, r.t, r.k, r.v === null ? null : JSON.stringify(r.v), JSON.stringify(r.fts), r.ts, start + i),
      );
      for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
      return end;
    },
    async since(user, seq, limit) {
      const res = await db.prepare("SELECT t, k, v, fts, ts, seq FROM sync_rows WHERE user = ? AND seq > ? ORDER BY seq LIMIT ?").bind(user, seq, limit).all<Raw>();
      const rows = res.results.map(parse);
      const top = (await db.prepare("SELECT seq FROM sync_meta WHERE user = ?").bind(user).first<{ seq: number }>())?.seq ?? 0;
      return { rows, seq: rows.length === limit ? rows[rows.length - 1].seq : top };
    },
    async count(user) {
      return (await db.prepare("SELECT COUNT(*) AS n FROM sync_rows WHERE user = ?").bind(user).first<{ n: number }>())?.n ?? 0;
    },
    async clear(user) {
      await db.batch([db.prepare("DELETE FROM sync_rows WHERE user = ?").bind(user), db.prepare("DELETE FROM sync_meta WHERE user = ?").bind(user)]);
    },
  };
}

/** Für den lokalen Server und Tests */
export function memoryStore(): SyncStore {
  const data = new Map<string, Map<string, SyncRow & { seq: number }>>();
  const seqs = new Map<string, number>();
  const of = (u: string) => data.get(u) ?? (data.set(u, new Map()), data.get(u)!);
  return {
    async get(user, keys) {
      const m = of(user);
      return new Map(keys.flatMap((x) => (m.has(id(x.t, x.k)) ? [[id(x.t, x.k), m.get(id(x.t, x.k))!] as const] : [])));
    },
    async put(user, rows) {
      let s = seqs.get(user) ?? 0;
      for (const r of rows) of(user).set(id(r.t, r.k), { ...r, seq: ++s });
      seqs.set(user, s);
      return s;
    },
    async since(user, seq, limit) {
      const rows = [...of(user).values()].filter((r) => r.seq > seq).sort((a, b) => a.seq - b.seq).slice(0, limit);
      return { rows, seq: rows.length === limit ? rows[rows.length - 1].seq : seqs.get(user) ?? 0 };
    },
    async count(user) {
      return of(user).size;
    },
    async clear(user) {
      data.delete(user);
      seqs.delete(user);
    },
  };
}

export const MAX_OPS = 400;
const MAX_ROW_BYTES = 64_000;
export const MAX_ROWS_PER_USER = 60_000;

/** Ops prüfen und zusammenführen. Gibt die neue Folgenummer zurück. */
export async function pushOps(store: SyncStore, user: string, raw: unknown): Promise<{ seq: number; written: number } | { error: string }> {
  if (!Array.isArray(raw) || raw.length > MAX_OPS) return { error: "Zu viele Änderungen auf einmal" };
  const ops: SyncOp[] = [];
  for (const o of raw as SyncOp[]) {
    if (!o || !isSyncTable(o.t) || typeof o.k !== "string" || !o.k || o.k.length > 200 || typeof o.ts !== "number" || !Number.isFinite(o.ts)) return { error: "Ungültige Änderung" };
    if (o.patch !== undefined && (typeof o.patch !== "object" || o.patch === null || Array.isArray(o.patch))) return { error: "Ungültige Änderung" };
    if (o.patch && JSON.stringify(o.patch).length > MAX_ROW_BYTES) return { error: "Datensatz zu groß" };
    // Zeitstempel aus der Zukunft würden alles andere dauerhaft schlagen
    ops.push({ t: o.t, k: o.k, ts: Math.min(o.ts, Date.now() + 60_000), patch: o.patch, del: o.del === true });
  }
  const existing = await store.get(user, ops);
  const changed = new Map<string, SyncRow>();
  for (const op of ops) {
    const key = id(op.t, op.k);
    const next = applyOp(changed.get(key) ?? existing.get(key) ?? null, op);
    if (next) changed.set(key, next);
  }
  const rows = [...changed.values()].filter((r) => JSON.stringify(r.v ?? {}).length <= MAX_ROW_BYTES);
  const newRows = rows.filter((r) => !existing.has(id(r.t, r.k))).length;
  if (newRows && (await store.count(user)) + newRows > MAX_ROWS_PER_USER) return { error: "Speicher für den Abgleich ist voll" };
  const seq = await store.put(user, rows);
  return { seq, written: rows.length };
}
