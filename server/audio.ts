// BPM-Lookup und Hörproben über Deezer.
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

export async function deezer(artist: string, title: string, duration?: number | null, opts: { light?: boolean } = {}): Promise<(Partial<AudioInfo> & { id?: number; matchedTitle?: string; score?: number }) | null> {
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
  const tried = new Set<string>();
  // Alle Suchen einer Runde gleichzeitig (vorher nacheinander: das kostete je Hörprobe über eine Sekunde)
  const run = async (qs: string[]) => {
    const fresh = [...new Set(qs)].filter((q) => !tried.has(q) && q.trim().length >= 3);
    fresh.forEach((q) => tried.add(q));
    for (const hits of await Promise.all(fresh.map((q) => search(q).catch(() => [] as Hit[])))) for (const h of hits) seen.set(h.id, h);
  };
  const pick = () => {
    let b: { h: Hit; s: number } | null = null;
    for (const h of seen.values()) {
      const candTitle = `${h.title} ${h.title_version ?? ""}`;
      const s = matchScore({ title, artist, duration }, candTitle, h.duration, h.artist?.name ?? "", { strictMix: true });
      if (!b || s > b.s) b = { h, s };
    }
    return b;
  };
  await run(queries);
  let best = pick();
  if (!best || best.s < 0.55) {
    // Nichts Passendes: bei mehreren Artists („A & B“, „A feat. B“) führt Deezer oft nur einen. Dann je Artist
    // mit dem bloßen Titel suchen (ohne Klammern und ohne „feat. …“). Nur in diesem Fall, das spart Anfragen.
    const bare = (titles.at(-1) ?? title).replace(/\b(feat\.?|ft\.?|featuring)\s.+$/i, "").trim();
    const names = clean(artist).split(/\s*(?:,|&|\+|\bfeat\.?|\bft\.?|\bfeaturing\b|\bvs\.?|\bx\b|\band\b|\bpres\.?|\bpresents\b)\s*/i).map((n) => n.trim()).filter((n) => n.length > 1);
    await run([...names.slice(0, 2).map((n) => `${n} ${bare}`), `${clean(artist)} ${bare}`]);
    best = pick();
  }
  if (!best || best.s < 0.55) return null;
  const hit = best.h;
  // Nur für die Hörprobe (light) reicht der Suchtreffer: das Tempo steht erst in den Track-Details
  const track = opts.light && hit.preview ? ({ preview: hit.preview } as { bpm?: number; preview?: string }) : ((await (await fetch(`https://api.deezer.com/track/${hit.id}`)).json()) as { bpm?: number; preview?: string });
  return {
    id: hit.id,
    bpm: track.bpm && track.bpm > 0 ? Math.round(track.bpm) : null,
    previewUrl: track.preview || hit.preview || null,
    matchedTitle: `${hit.artist?.name ?? ""} – ${hit.title}${hit.title_version ? ` ${hit.title_version}` : ""}`,
    score: Math.round(best.s * 100) / 100,
  };
}

export async function lookupAudio(_config: Config, artist: string, title: string, duration?: number | null): Promise<AudioInfo> {
  const ds = await deezer(artist, title, duration).catch(() => null);
  return { bpm: ds?.bpm ?? null, key: null, source: ds?.bpm ? ["Deezer"] : [], previewUrl: ds?.previewUrl ?? null, matched: ds?.matchedTitle ?? null };
}

/**
 * Gedächtnis für die Suche: Artist und Titel → Deezer-Track (0 = keiner). Je Worker im Speicher und,
 * wo es ihn gibt, im Cache von Cloudflare (gilt dann für alle Worker des Standorts). So kostet die
 * zweite Anfrage nach derselben Hörprobe keine Suche mehr, und das Vorbereiten der nächsten Karte
 * beim Diggen (warm) zahlt sich aus. Gemerkt wird nur die Nummer: die Adresse der Hörprobe läuft ab.
 */
const memo = new Map<string, { id: number; until: number }>();
const MEMO_HIT_MS = 24 * 3600_000;
const MEMO_MISS_MS = 3600_000;
const edgeCache = (): Cache | null => {
  const c = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  return c ?? null;
};
const memoUrl = (key: string) => `https://memo.crate.invalid/dz/${encodeURIComponent(key)}`;
async function memoGet(key: string): Promise<number | undefined> {
  const m = memo.get(key);
  if (m && m.until > Date.now()) return m.id;
  try {
    const r = await edgeCache()?.match(memoUrl(key));
    if (r) {
      const id = Number(await r.text()) || 0;
      memo.set(key, { id, until: Date.now() + MEMO_MISS_MS });
      return id;
    }
  } catch {
    /* ohne Cache geht es auch */
  }
  return undefined;
}
async function memoSet(key: string, id: number) {
  const ttl = id ? MEMO_HIT_MS : MEMO_MISS_MS;
  memo.set(key, { id, until: Date.now() + ttl });
  if (memo.size > 3000) memo.delete(memo.keys().next().value as string);
  try {
    await edgeCache()?.put(memoUrl(key), new Response(String(id), { headers: { "Cache-Control": `public, max-age=${Math.round(ttl / 1000)}` } }));
  } catch {
    /* egal */
  }
}

async function streamPreview(url: string | null | undefined): Promise<Response> {
  if (!url || !/^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(url)) return new Response("Keine Hörprobe", { status: 404 });
  const r = await fetch(url);
  if (!r.ok || !r.body) return new Response("Hörprobe nicht ladbar", { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}

/**
 * Hörprobe von Deezer durchreichen (für die Analyse im Browser, dort fehlen CORS-Header).
 * warm: nur suchen und merken, nichts ausliefern (bereitet die nächste Karte beim Diggen vor).
 */
export async function fetchPreview(artist: string, title: string, duration?: number | null, warm = false): Promise<Response> {
  const key = `${artist}|${title}|${duration ? Math.round(duration / 5) : ""}`.toLowerCase();
  const known = await memoGet(key);
  if (known === 0) return new Response("Keine Hörprobe", { status: 404 });
  if (known) return warm ? new Response(null, { status: 204 }) : fetchPreviewById(known);
  const d = await deezer(artist, title, duration, { light: true });
  const ok = Boolean(d?.id && d.previewUrl);
  await memoSet(key, ok ? d!.id! : 0);
  if (!ok) return new Response("Keine Hörprobe", { status: 404 });
  return warm ? new Response(null, { status: 204 }) : streamPreview(d!.previewUrl);
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
        const sc = matchScore({ title: tr.title, artist: tr.artist || artist, duration: tr.duration }, `${d.title} ${d.title_version ?? ""}`, d.duration, d.artist?.name ?? "", { strictMix: true });
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
