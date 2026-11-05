// Sets mit Freunden teilen: das Set steckt komplett im Link (#…), es liegt nichts auf dem Server.
// Kompakt als JSON in Base64url. Pro Track: Release, Position, Titel, Artist, BPM, Key.

export interface SharedTrack {
  releaseId: number;
  position: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  note?: string;
}

export interface SharedSet {
  name: string;
  date?: string;
  venue?: string;
  curve?: string;
  by?: string;
  tracks: SharedTrack[];
  /** Weitere Platten aus der Kiste (ohne Track im Set) */
  crate: { releaseId: number; artist: string; title: string }[];
  /** Artist und Titel der Platten der Tracks */
  records: Record<number, { artist: string; title: string }>;
}

const MAX_TRACKS = 80;
const cut = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

function toB64url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSet(s: SharedSet): string {
  const tracks = s.tracks.slice(0, MAX_TRACKS);
  const recs: Record<number, [string, string]> = {};
  for (const t of tracks) {
    const r = s.records[t.releaseId];
    if (r) recs[t.releaseId] = [cut(r.artist, 80), cut(r.title, 100)];
  }
  const inSet = new Set(tracks.map((t) => t.releaseId));
  const payload = {
    v: 1,
    n: cut(s.name, 60),
    d: s.date,
    p: s.venue ? cut(s.venue, 60) : undefined,
    c: s.curve,
    b: s.by,
    t: tracks.map((t) => [t.releaseId, cut(t.position, 8), cut(t.title, 100), cut(t.artist, 80), t.bpm ? Math.round(t.bpm * 10) / 10 : 0, t.key ?? "", cut(t.note, 140)]),
    r: recs,
    k: s.crate.filter((c) => !inSet.has(c.releaseId)).slice(0, 120).map((c) => [c.releaseId, cut(c.artist, 80), cut(c.title, 100)]),
  };
  return toB64url(JSON.stringify(payload));
}

const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
const id = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : 0);

/** Liest einen geteilten Link. Gibt null bei kaputten oder fremden Daten. */
export function decodeSet(code: string): SharedSet | null {
  try {
    const j = JSON.parse(fromB64url(code.replace(/^#/, "")));
    if (j?.v !== 1 || !Array.isArray(j.t)) return null;
    const tracks: SharedTrack[] = [];
    for (const row of j.t.slice(0, MAX_TRACKS)) {
      if (!Array.isArray(row) || !id(row[0])) continue;
      tracks.push({
        releaseId: id(row[0]),
        position: str(row[1], 8),
        title: str(row[2], 100),
        artist: str(row[3], 80),
        bpm: typeof row[4] === "number" && row[4] > 0 && row[4] < 400 ? row[4] : undefined,
        key: str(row[5], 8) || undefined,
        note: str(row[6], 140) || undefined,
      });
    }
    const records: SharedSet["records"] = {};
    if (j.r && typeof j.r === "object")
      for (const [k, v] of Object.entries(j.r)) if (id(Number(k)) && Array.isArray(v)) records[Number(k)] = { artist: str(v[0], 80), title: str(v[1], 100) };
    const crate = Array.isArray(j.k)
      ? j.k.filter((c: unknown) => Array.isArray(c) && id(c[0])).slice(0, 120).map((c: unknown[]) => ({ releaseId: id(c[0]), artist: str(c[1], 80), title: str(c[2], 100) }))
      : [];
    return {
      name: str(j.n, 60) || "Set",
      date: /^\d{4}-\d{2}-\d{2}$/.test(j.d ?? "") ? j.d : undefined,
      venue: str(j.p, 60) || undefined,
      curve: str(j.c, 20) || undefined,
      by: str(j.b, 60) || undefined,
      tracks,
      crate,
      records,
    };
  } catch {
    return null;
  }
}

/** Wie viel vom Set jemand mit dieser Sammlung spielen kann */
export function coverage(s: SharedSet, owned: Set<number>) {
  const rels = [...new Set([...s.tracks.map((t) => t.releaseId), ...s.crate.map((c) => c.releaseId)])];
  const have = rels.filter((r) => owned.has(r));
  const playable = s.tracks.filter((t) => owned.has(t.releaseId)).length;
  return { records: rels.length, have: have.length, playable, missing: rels.filter((r) => !owned.has(r)) };
}
