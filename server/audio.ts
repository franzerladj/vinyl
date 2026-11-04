// BPM- und Tonart-Lookup über GetSongBPM (mit API-Key) und Deezer (BPM, Hörprobe).
import type { Config } from "./env";
import { matchScore, searchTitles } from "../shared/match";

export interface AudioInfo {
  bpm: number | null;
  key: string | null;
  source: string[];
  previewUrl: string | null;
  /** Welcher Deezer-Track für BPM und Hörprobe gewählt wurde */
  matched?: string | null;
}

const clean = (s: string) => s.replace(/\(.*?\)|\[.*?\]/g, "").replace(/\s+/g, " ").trim();

async function getSongBpm(config: Config, artist: string, title: string): Promise<Partial<AudioInfo> | null> {
  if (!config.getSongBpmKey) return null;
  const lookup = `song:${clean(title)} artist:${clean(artist)}`;
  const url = `https://api.getsong.co/search/?api_key=${config.getSongBpmKey}&type=both&lookup=${encodeURIComponent(lookup)}`;
  const res = await fetch(url, { headers: { "User-Agent": config.userAgent } });
  if (!res.ok) return null;
  const data = (await res.json()) as { search?: Array<{ tempo?: string; key_of?: string }> | { error: string } };
  const hit = Array.isArray(data.search) ? data.search[0] : undefined;
  if (!hit) return null;
  return { bpm: hit.tempo ? Math.round(Number(hit.tempo)) : null, key: hit.key_of || null };
}

export async function deezer(artist: string, title: string, duration?: number | null): Promise<(Partial<AudioInfo> & { matchedTitle?: string; score?: number }) | null> {
  type Hit = { id: number; title: string; title_version?: string; duration?: number; preview?: string; artist?: { name: string } };
  const search = async (q: string) => {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`);
    return res.ok ? (((await res.json()) as { data?: Hit[] }).data ?? []) : [];
  };
  // Treffer aus exakter und freier Suche sammeln, dann den Mix wählen, der wirklich passt
  // (Titel inkl. Mix-Name in Klammern, Artist und Länge laut Discogs)
  const seen = new Map<number, Hit>();
  const titles = searchTitles(title);
  const queries = [`artist:"${clean(artist)}" track:"${clean(title)}"`, `${artist} ${title}`, `${clean(artist)} ${titles.at(-1) ?? title}`];
  for (const q of [...new Set(queries)]) for (const h of await search(q)) seen.set(h.id, h);
  let best: { h: Hit; s: number } | null = null;
  for (const h of seen.values()) {
    const candTitle = `${h.title} ${h.title_version ?? ""}`;
    const s = matchScore({ title, artist, duration }, candTitle, h.duration, h.artist?.name ?? "");
    if (!best || s > best.s) best = { h, s };
  }
  if (!best || best.s < 0.55) return null;
  const hit = best.h;
  const track = (await (await fetch(`https://api.deezer.com/track/${hit.id}`)).json()) as { bpm?: number; preview?: string };
  return {
    bpm: track.bpm && track.bpm > 0 ? Math.round(track.bpm) : null,
    previewUrl: track.preview || hit.preview || null,
    matchedTitle: `${hit.artist?.name ?? ""} – ${hit.title}${hit.title_version ? ` ${hit.title_version}` : ""}`,
    score: Math.round(best.s * 100) / 100,
  };
}

export async function lookupAudio(config: Config, artist: string, title: string, duration?: number | null): Promise<AudioInfo> {
  const [g, d] = await Promise.allSettled([getSongBpm(config, artist, title), deezer(artist, title, duration)]);
  const gs = g.status === "fulfilled" ? g.value : null;
  const ds = d.status === "fulfilled" ? d.value : null;
  const source: string[] = [];
  if (gs?.bpm || gs?.key) source.push("GetSongBPM");
  if (ds?.bpm) source.push("Deezer");
  return {
    bpm: gs?.bpm ?? ds?.bpm ?? null,
    key: gs?.key ?? null,
    source,
    previewUrl: ds?.previewUrl ?? null,
    matched: ds?.matchedTitle ?? null,
  };
}

/** Hörprobe von Deezer durchreichen (für die Analyse im Browser, dort fehlen CORS-Header) */
export async function fetchPreview(artist: string, title: string, duration?: number | null): Promise<Response> {
  const d = await deezer(artist, title, duration);
  const url = d?.previewUrl;
  if (!url || !/^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(url)) return new Response("Keine Hörprobe", { status: 404 });
  const r = await fetch(url);
  if (!r.ok || !r.body) return new Response("Hörprobe nicht ladbar", { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}

// ---------------------------------------------------------------------------
// Ganze Platte auf einmal: Album bei Deezer suchen und Tracks über Titel, Mix und Länge zuordnen.
// Schneller und genauer als jeder Track einzeln.
// ---------------------------------------------------------------------------
export interface ReleaseTrackIn {
  key: string;
  title: string;
  artist?: string;
  duration?: number | null;
}
export interface ReleaseTrackOut {
  deezerId: number;
  bpm: number | null;
  title: string;
  score: number;
}

type DzAlbum = { id: number; title: string; artist?: { name: string }; nb_tracks?: number };
type DzTrack = { id: number; title: string; title_version?: string; duration?: number; artist?: { name: string } };

export async function matchRelease(artist: string, title: string, tracks: ReleaseTrackIn[]): Promise<{ album: string | null; matches: Record<string, ReleaseTrackOut> }> {
  const get = async <T>(url: string): Promise<T | null> => {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  };
  const q = async (s: string) => (await get<{ data?: DzAlbum[] }>(`https://api.deezer.com/search/album?q=${encodeURIComponent(s)}&limit=6`))?.data ?? [];
  const titles = searchTitles(title);
  const cleanTitle = titles[0] ?? title;
  const short = titles.at(-1) ?? cleanTitle;
  const seen = new Map<number, DzAlbum>();
  const queries = [`artist:"${clean(artist)}" album:"${cleanTitle}"`, `${clean(artist)} ${short}`];
  for (const qq of [...new Set(queries)]) for (const a of await q(qq)) seen.set(a.id, a);
  // Alben nach Passung sortieren (Artist getrennt geprüft, "Various" ausgenommen).
  // Passt kein einziger Track, war es das falsche Album: das nächste probieren.
  const ranked = [...seen.values()]
    .map((a) => ({ a, s: Math.max(...titles.map((t) => matchScore({ title: t, artist }, a.title, null, a.artist?.name ?? ""))) }))
    .filter((x) => x.s >= 0.5)
    .sort((x, y) => y.s - x.s)
    .slice(0, 3);
  let best: (typeof ranked)[number] | null = null;
  let pairs: { key: string; t: DzTrack; s: number }[] = [];
  for (const cand of ranked) {
    const list = (await get<{ data?: DzTrack[] }>(`https://api.deezer.com/album/${cand.a.id}/tracks?limit=60`))?.data ?? [];
    // Jeden Discogs-Track dem besten freien Deezer-Track zuordnen
    const found: typeof pairs = [];
    for (const tr of tracks) {
      for (const d of list) {
        const sc = matchScore({ title: tr.title, artist: tr.artist || artist, duration: tr.duration }, `${d.title} ${d.title_version ?? ""}`, d.duration, d.artist?.name ?? "");
        if (sc >= 0.5) found.push({ key: tr.key, t: d, s: sc });
      }
    }
    if (found.length) {
      best = cand;
      pairs = found;
      break;
    }
  }
  if (!best) return { album: null, matches: {} };
  pairs.sort((x, y) => y.s - x.s);
  const usedKeys = new Set<string>();
  const usedIds = new Set<number>();
  const chosen: { key: string; t: DzTrack; s: number }[] = [];
  for (const p of pairs) {
    if (usedKeys.has(p.key) || usedIds.has(p.t.id)) continue;
    usedKeys.add(p.key);
    usedIds.add(p.t.id);
    chosen.push(p);
  }
  // BPM steht nur in den Track-Details (Cloudflare erlaubt ~50 Unteranfragen, daher begrenzt)
  const details = await Promise.all(chosen.slice(0, 40).map((p) => get<{ bpm?: number }>(`https://api.deezer.com/track/${p.t.id}`)));
  const matches: Record<string, ReleaseTrackOut> = {};
  chosen.slice(0, 40).forEach((p, i) => {
    const bpm = details[i]?.bpm;
    matches[p.key] = { deezerId: p.t.id, bpm: bpm && bpm > 0 ? Math.round(bpm) : null, title: `${p.t.title}${p.t.title_version ? ` ${p.t.title_version}` : ""}`, score: Math.round(p.s * 100) / 100 };
  });
  return { album: `${best.a.artist?.name ?? ""} – ${best.a.title}`, matches };
}

/** Hörprobe zu einer bekannten Deezer-Track-ID (frische, signierte URL von Deezer) */
export async function fetchPreviewById(id: number): Promise<Response> {
  const r = await fetch(`https://api.deezer.com/track/${id}`);
  const t = r.ok ? ((await r.json()) as { preview?: string }) : null;
  const url = t?.preview;
  if (!url || !/^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(url)) return new Response("Keine Hörprobe", { status: 404 });
  const a = await fetch(url);
  if (!a.ok || !a.body) return new Response("Hörprobe nicht ladbar", { status: 502 });
  return new Response(a.body, { headers: { "Content-Type": a.headers.get("Content-Type") ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
