// Abgleich eigener Daten zwischen Geräten (Handy, Laptop …).
// Jede Änderung wird als Feld-Patch mit Zeitstempel geschickt. Der Server führt feldweise zusammen:
// die neuere Änderung gewinnt, aber ein von Hand eingetragener Wert (BPM, Key, Energie) wird nie
// durch eine automatische Messung eines anderen Geräts ersetzt.

export const SYNC_TABLES = ["tracks", "sets", "recordMeta", "wantMeta", "sellers", "friends", "kv"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Gerätedaten im Schlüssel-Wert-Speicher, die mitwandern (Einstellungen des Geräts selbst bleiben lokal) */
export const SYNC_KV = new Set(["crateTemplates", "digLiked", "digWeights", "digSkipped", "digFilter", "stylus", "shopSettings", "printOpts", "currency"]);

export type Patch = Record<string, unknown>;

export interface SyncOp {
  t: SyncTable;
  k: string;
  ts: number;
  patch?: Patch;
  del?: boolean;
}

export interface SyncRow {
  t: SyncTable;
  k: string;
  /** null = gelöscht */
  v: Patch | null;
  /** Zeitstempel je Feld */
  fts: Record<string, number>;
  /** neueste Änderung am Datensatz (auch Löschung) */
  ts: number;
}

/** Quellen, die ein Mensch gesetzt hat */
export const MANUAL_SOURCES = new Set(["manuell", "Mithören", "Tap"]);
const GROUPS: { fields: string[]; source: string }[] = [
  { fields: ["bpm", "bpmSource"], source: "bpmSource" },
  { fields: ["key", "keySource"], source: "keySource" },
  { fields: ["energy", "moods", "vibeSource"], source: "vibeSource" },
];

const isManual = (src: unknown) => typeof src === "string" && MANUAL_SOURCES.has(src);

/** Wendet einen Patch an. Gibt den neuen Datensatz zurück oder null, wenn sich nichts ändert. */
export function applyOp(row: SyncRow | null, op: SyncOp): SyncRow | null {
  if (op.del) {
    if (row && (row.v === null || op.ts <= row.ts)) return null;
    return { t: op.t, k: op.k, v: null, fts: {}, ts: op.ts };
  }
  const patch = op.patch ?? {};
  // Nach einer neueren Löschung bleibt der Datensatz gelöscht
  if (row && row.v === null && op.ts <= row.ts) return null;
  const v: Patch = row?.v ? { ...row.v } : {};
  const fts: Record<string, number> = row?.v ? { ...row.fts } : {};
  const skip = new Set<string>();
  if (op.t === "tracks") {
    for (const g of GROUPS) {
      if (!g.fields.some((f) => f in patch)) continue;
      // Hand schlägt Automatik: kommt eine Messung, während ein eigener Wert gespeichert ist, bleibt der eigene
      const incoming = g.source in patch ? patch[g.source] : v[g.source];
      if (isManual(v[g.source]) && !isManual(incoming)) g.fields.forEach((f) => skip.add(f));
    }
  }
  let changed = !row || row.v === null;
  for (const [f, val] of Object.entries(patch)) {
    if (skip.has(f)) continue;
    if ((fts[f] ?? 0) > op.ts) continue;
    if (fts[f] === op.ts && f in v) continue; // Gleichstand: das Erste bleibt (z. B. beim ersten Hochladen beider Geräte)
    if (JSON.stringify(v[f]) !== JSON.stringify(val)) changed = true;
    v[f] = val === undefined ? null : val;
    fts[f] = op.ts;
  }
  if (!changed) return null;
  return { t: op.t, k: op.k, v, fts, ts: Math.max(row?.ts ?? 0, op.ts) };
}

/** Mehrere Patches desselben Datensatzes zusammenfassen (spart Anfragen) */
export function compact(ops: SyncOp[]): SyncOp[] {
  const out = new Map<string, SyncOp>();
  for (const op of ops) {
    const id = `${op.t}\u0000${op.k}`;
    const prev = out.get(id);
    if (!prev || op.del || prev.del) {
      out.delete(id);
      out.set(id, op.del ? op : { ...op, patch: { ...(prev && !prev.del ? prev.patch : {}), ...op.patch }, ts: Math.max(op.ts, prev?.ts ?? 0) });
      continue;
    }
    prev.patch = { ...prev.patch, ...op.patch };
    prev.ts = Math.max(prev.ts, op.ts);
  }
  return [...out.values()];
}

/** Undefinierte Felder weglassen (sonst überschreibt ein leerer Datensatz die Werte eines anderen Geräts) */
export function definedOnly(obj: Record<string, unknown>, drop: string[] = []): Patch {
  const p: Patch = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && !drop.includes(k)) p[k] = v;
  return p;
}

export const isSyncTable = (t: unknown): t is SyncTable => typeof t === "string" && (SYNC_TABLES as readonly string[]).includes(t);
