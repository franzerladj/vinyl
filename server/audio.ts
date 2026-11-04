// BPM- und Tonart-Lookup über GetSongBPM (mit API-Key) und Deezer (BPM, Hörprobe).
import type { Config } from "./env";

export interface AudioInfo {
  bpm: number | null;
  key: string | null;
  source: string[];
  previewUrl: string | null;
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

export async function deezer(artist: string, title: string): Promise<Partial<AudioInfo> | null> {
  type Hit = { id: number; title: string; preview?: string; artist?: { name: string } };
  const search = async (q: string) => {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`);
    return res.ok ? (((await res.json()) as { data?: Hit[] }).data ?? []) : [];
  };
  const norm = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  // Erst exakt nach Artist + Track, sonst freie Suche, aber nur bei passendem Titel und Artist
  const hit =
    (await search(`artist:"${clean(artist)}" track:"${clean(title)}"`))[0] ??
    (await search(`${clean(artist)} ${clean(title)}`)).find(
      (h) => norm(h.title).includes(norm(title)) && (!artist || norm(h.artist?.name ?? "").includes(norm(artist).slice(0, 6))),
    );
  if (!hit) return null;
  const track = (await (await fetch(`https://api.deezer.com/track/${hit.id}`)).json()) as { bpm?: number; preview?: string };
  return { bpm: track.bpm && track.bpm > 0 ? Math.round(track.bpm) : null, previewUrl: track.preview || hit.preview || null };
}

export async function lookupAudio(config: Config, artist: string, title: string): Promise<AudioInfo> {
  const [g, d] = await Promise.allSettled([getSongBpm(config, artist, title), deezer(artist, title)]);
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
  };
}

/** Hörprobe von Deezer durchreichen (für die Analyse im Browser, dort fehlen CORS-Header) */
export async function fetchPreview(artist: string, title: string): Promise<Response> {
  const d = await deezer(artist, title);
  const url = d?.previewUrl;
  if (!url || !/^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(url)) return new Response("Keine Hörprobe", { status: 404 });
  const r = await fetch(url);
  if (!r.ok || !r.body) return new Response("Hörprobe nicht ladbar", { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
