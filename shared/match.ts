// Zuordnung von Tracks zu YouTube-Videos (aus Discogs) und zu Deezer-Treffern.
// Wichtig bei DJ-Platten: Mix-Namen in Klammern unterscheiden die Versionen.

const STOP = new Set(["the", "a", "an", "and", "feat", "ft", "featuring", "official", "video", "audio", "hd", "hq", "vinyl", "rip", "full", "version", "remastered", "remaster", "original", "music", "de", "der", "die", "und", "x", "vs"]);

export const normTokens = (s: string) =>
  s
    .toLowerCase()
    // Abkürzungen mit Punkten zusammenziehen: „L.A.O.S“ → „laos“ (sonst blieben nur einzelne Buchstaben, die wegfallen)
    .replace(/\b(?:[a-z0-9]\.){2,}[a-z0-9]?/g, (m) => m.replace(/\./g, ""))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

/** Klammern, die keinen Mix benennen: „(feat. X)“, „(with X)“ */
const GUEST = /^\s*(feat\.?|ft\.?|featuring|with)\b/i;
/**
 * Dieselbe Aufnahme in anderer Länge: Original, Extended, Radio Edit, Albumversion. Tempo und Tonart sind gleich,
 * als Hörprobe taugt jede davon. Ein Remix oder Dub ist dagegen ein anderes Stück.
 */
const SAME_RECORDING = /^\s*(original( mix| version)?|extended( mix| version)?|radio (edit|mix|version)|album (version|mix)|(long|short|full|full length|single) (version|edit|mix)|12"? ?(inch )?(version|mix)|edit)\s*$/i;
const brackets = (s: string) => (s.match(/[([]([^)\]]+)[)\]]/g) ?? []).map((m) => m.slice(1, -1)).filter((m) => !GUEST.test(m));

/** Teile in Klammern (Mix-Name), z.B. "Red Hand Gang Mix"; ohne Gäste und ohne bloße Längen-Varianten */
export const mixPart = (s: string) => brackets(s).filter((m) => !SAME_RECORDING.test(m)).join(" ");

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
/** Ähnlichkeit zweier Artist-Namen 0..1 ("Roy Ayers Ubiquity" ~ "Roy Ayers", "Ogawa & Tokoro" ~ "Ogawa and Tokoro") */
export function artistSimilarity(a: string, b: string): number {
  const x = normTokens(a);
  const y = new Set(normTokens(b));
  if (!x.length || !y.size) return 0;
  const hit = x.filter((w) => y.has(w)).length;
  return Math.max(hit / x.length, hit / y.size);
}

/** Discogs nutzt "Various" für Compilations: dann den Artist nicht prüfen */
export const isVarious = (a?: string) => !a || /^(various|various artists|unknown artist|no artist)$/i.test(a.trim());

/** Suchtitel für Deezer: ohne Klammern, ohne Schriftzeichen anderer Alphabete, ohne Format-Wörter */
export function searchTitles(t: string): string[] {
  const noBrackets = t.replace(/\(.*?\)|\[.*?\]/g, " ");
  const latin = noBrackets.replace(/[^\p{Script=Latin}\p{N}\s'&.-]/gu, " ");
  const noFormat = latin.replace(/\b(ep|lp|remixes|remix(ed)?|the remixes|vol\.?\s*\d+|part\s*\d+)\b/gi, " ");
  return [...new Set([noBrackets, latin, noFormat].map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 1))];
}

/** Wörter, die jeder Mix-Name trägt und die deshalb nichts unterscheiden */
const GENERIC_MIX = new Set(["mix", "remix", "rmx", "version", "edit", "re"]);
const rawWords = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f'’`]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
/** Unterscheidende Wörter eines Mix-Namens: „Laboratoire Mix“ → laboratoire, „Video Mix“ → video */
const mixWords = (t: string) => rawWords(mixPart(t)).filter((w) => !GENERIC_MIX.has(w));

/**
 * strictMix (für Hörproben und Tempo): der Mix muss wirklich derselbe sein. Ein Remix ist ein anderes Stück,
 * also zählt weder das Original als Treffer für einen Remix noch ein anderer Mix, nur weil beide „Mix“ heißen.
 */
export function matchScore(track: MatchTrack, candTitle: string, candDuration?: number | null, candArtist?: string, opts: { strictMix?: boolean } = {}): number {
  if (opts.strictMix) {
    const want = mixWords(track.title);
    if (want.length) {
      const have = new Set(rawWords(candTitle));
      const hit = want.filter((w) => have.has(w)).length / want.length;
      // Kandidat nennt einen anderen Mix oder gar keinen (dann ist es das Original)
      if (hit < 0.5) return 0;
    }
  }
  const cand = new Set(normTokens(candTitle));
  // Gäste gehören nicht zum Titel: „Moss feat. Daniel Agust“ steht anderswo als „Moss“ mit dem Gast beim Artist
  const base = normTokens(track.title.replace(/[([][^)\]]*[)\]]/g, " ").replace(/\b(feat\.?|ft\.?|featuring)\s.+$/i, " "));
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
    // (Radio Edit, Extended und Original zählen als dieselbe Aufnahme und stehen nicht in candMix)
    score += candMix.length ? 0 : 0.2;
    if (candMix.some((w) => /remix|rmx/.test(w))) score -= 0.15;
  }
  if (candArtist != null && track.artist && !isVarious(track.artist)) {
    // Artist getrennt prüfen: fremder Artist mit gleichem Titel ist der häufigste Fehltreffer
    const sim = artistSimilarity(track.artist, candArtist);
    score += sim >= 0.5 ? sim * 0.1 : -0.4;
  } else if (track.artist) {
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
