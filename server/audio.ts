// BPM- und Tonart-Lookup über GetSongBPM (mit API-Key) und Deezer (BPM, Hörprobe).
import type { Config } from "./env";
import { matchScore } from "../shared/match";

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
  for (const h of [...(await search(`artist:"${clean(artist)}" track:"${clean(title)}"`)), ...(await search(`${artist} ${title}`))]) seen.set(h.id, h);
  let best: { h: Hit; s: number } | null = null;
  for (const h of seen.values()) {
    const candTitle = `${h.artist?.name ?? ""} ${h.title} ${h.title_version ?? ""}`;
    const s = matchScore({ title, artist, duration }, candTitle, h.duration);
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
