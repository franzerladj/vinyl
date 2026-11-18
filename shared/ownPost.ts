// Eigene Beiträge im Freunde-Feed: „hat ein Set gespielt“ und „Platte des Moments“.
// Hier nur das Säubern der Inhalte (Server nimmt nichts ungeprüft an), ohne Netz, testbar.

export type OwnPostKind = "set" | "spot";
export interface SetPostData {
  name: string;
  venue?: string;
  date?: string;
  tracks: number;
  records: number;
  covers: string[];
  picks: { artist: string; title: string }[];
}
export interface SpotPostData {
  id: number;
  title: string;
  artist: string;
  cover?: string;
}
export interface OwnPost {
  owner: string;
  kind: OwnPostKind;
  /** Set: Zeitstempel der Anlage, Platte des Moments: Release-ID */
  ref: string;
  data: SetPostData | SpotPostData;
  ts: number;
}

// eslint-disable-next-line no-control-regex
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (v: unknown, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};
/** Nur Bilder von Discogs, sonst könnte jemand beliebige Adressen in fremde Feeds legen */
export const discogsImage = (v: unknown): string | undefined => (typeof v === "string" && v.length < 400 && /^https:\/\/(i|img|st)\.discogs\.com\//.test(v) ? v : undefined);

export const validRef = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);

export function cleanOwnPost(kind: unknown, raw: unknown): SetPostData | SpotPostData | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (kind === "set") {
    const name = text(r.name, 80);
    const tracks = int(r.tracks, 500);
    if (!name || !tracks) return null;
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : undefined;
    return {
      name,
      venue: text(r.venue, 80) || undefined,
      date,
      tracks,
      records: int(r.records, 500),
      covers: (Array.isArray(r.covers) ? r.covers : []).map(discogsImage).filter((x): x is string => Boolean(x)).slice(0, 4),
      picks: (Array.isArray(r.picks) ? r.picks : [])
        .map((p) => ({ artist: text((p as Record<string, unknown>)?.artist, 80), title: text((p as Record<string, unknown>)?.title, 120) }))
        .filter((p) => p.title)
        .slice(0, 3),
    };
  }
  if (kind === "spot") {
    const id = int(r.id, 2_000_000_000);
    const title = text(r.title, 140);
    if (!id || !title) return null;
    return { id, title, artist: text(r.artist, 100), cover: discogsImage(r.cover) };
  }
  return null;
}
