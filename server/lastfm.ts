// Last.fm-Tags: Hörer vergeben Begriffe wie "dark", "groovy", "chill". Kostenlose API.
import type { Config } from "./env";

interface TagResp {
  toptags?: { tag?: { name: string; count: number }[] };
  error?: number;
}

async function call(cfg: Config, params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, api_key: cfg.lastfmKey, format: "json", autocorrect: "1" });
  const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${q}`, { headers: { "User-Agent": cfg.userAgent } });
  if (!r.ok) return [];
  const j = (await r.json()) as TagResp;
  return (j.toptags?.tag ?? []).map((t) => ({ name: t.name.toLowerCase(), count: Number(t.count) || 0 }));
}

export async function lastfmTags(cfg: Config, artist: string, track: string) {
  const clean = (s: string) => s.replace(/\(.*?\)|\[.*?\]/g, "").trim();
  let tags = await call(cfg, { method: "track.gettoptags", artist: clean(artist), track: clean(track) });
  let source = "track";
  if (tags.filter((t) => t.count >= 5).length < 3) {
    tags = await call(cfg, { method: "artist.gettoptags", artist: clean(artist) });
    source = "artist";
  }
  return { source, tags: tags.filter((t) => t.count > 0).slice(0, 20) };
}
