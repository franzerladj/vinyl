// Zuordnung von Tracks zu YouTube-Videos (aus Discogs) und zu Deezer-Treffern.
// Wichtig bei DJ-Platten: Mix-Namen in Klammern unterscheiden die Versionen.

const STOP = new Set(["the", "a", "an", "and", "feat", "ft", "featuring", "official", "video", "audio", "hd", "hq", "vinyl", "rip", "full", "version", "remastered", "remaster", "original", "music", "de", "der", "die", "und", "x", "vs"]);

export const normTokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

/** Teile in Klammern (Mix-Name), z.B. "Red Hand Gang Mix" */
export const mixPart = (s: string) => (s.match(/[([]([^)\]]+)[)\]]/g) ?? []).map((m) => m.slice(1, -1)).join(" ");

/** "6:02" → 362 */
export function parseDuration(d?: string | null): number | null {
  if (!d) return null;
  const p = d.split(":").map(Number);
  if (p.some((x) => Number.isNaN(x))) return null;
  return p.reduce((a, b) => a * 60 + b, 0) || null;
}

export interface MatchTrack {
  title: string;
  artist?: string;
  /** Sekunden */
  duration?: number | null;
}

/**
 * Wie gut passt ein Kandidat (Video- oder Deezer-Titel) zu einem Track?
 * 0..1. Mix-Namen und Länge zählen stark, damit A1 und A2 nicht verwechselt werden.
 */
export function matchScore(track: MatchTrack, candTitle: string, candDuration?: number | null): number {
  const cand = new Set(normTokens(candTitle));
  const base = normTokens(track.title.replace(/[([][^)\]]*[)\]]/g, " "));
  const mix = normTokens(mixPart(track.title));
  const candMix = normTokens(mixPart(candTitle));
  if (!base.length) return 0;
  const baseHit = base.filter((w) => cand.has(w)).length / base.length;
  let score = baseHit * 0.55;
  if (mix.length) {
    const mixHit = mix.filter((w) => cand.has(w)).length / mix.length;
    score += mixHit * 0.3;
    // Anderer Mix im Kandidaten-Titel: deutlicher Abzug
    if (candMix.length && mixHit < 0.5) score -= 0.25;
  } else {
    // Track ohne Mix-Angabe: Kandidat mit fremdem Remix abwerten
    score += candMix.some((w) => /remix|rmx|dub|edit|mix|version/.test(w)) ? 0 : 0.2;
    if (candMix.some((w) => /remix|rmx/.test(w))) score -= 0.15;
  }
  if (track.artist) {
    const a = normTokens(track.artist);
    if (a.length) score += (a.filter((w) => cand.has(w)).length / a.length) * 0.1;
  }
  if (track.duration && candDuration) {
    const diff = Math.abs(track.duration - candDuration);
    score += diff <= 8 ? 0.15 : diff <= 20 ? 0.05 : diff > 60 ? -0.3 : -0.1;
  }
  return Math.max(0, Math.min(1, score));
}

export interface Video {
  uri: string;
  title: string;
  duration?: number;
}

export const youtubeId = (uri: string) => uri.match(/(?:[?&]v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1] ?? null;

/** Bestes Video für einen Track; bei nur einem Track auf der Platte reicht ein schwächerer Treffer */
export function matchVideo(track: MatchTrack, videos: Video[] = [], trackCount = 2): Video | null {
  let best: { v: Video; s: number } | null = null;
  for (const v of videos) {
    if (!youtubeId(v.uri)) continue;
    const s = matchScore(track, v.title, v.duration);
    if (!best || s > best.s) best = { v, s };
  }
  if (!best) return null;
  return best.s >= (trackCount <= 1 ? 0.3 : 0.5) ? best.v : null;
}
