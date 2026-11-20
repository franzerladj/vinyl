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

/** Deezer war gerade nicht zu erreichen oder hat „zu viele Anfragen“ gemeldet: später nochmal, nichts merken */
export class DeezerBusy extends Error {
  constructor() {
    super("Deezer ist gerade ausgelastet");
  }
}

/**
 * Eine Anfrage an Deezer. Wichtig: „zu viele Anfragen“ meldet Deezer mit Status 200 und einem error-Objekt
 * (Code 4, höchstens 50 Anfragen in 5 Sekunden je Adresse, und Cloudflare teilt sich Adressen mit anderen).
 * Das darf nie als „nichts gefunden“ gelten: sonst hieß es bei schnellem Wischen „keine Hörprobe“, und das
 * wurde auch noch eine Stunde lang gemerkt. Deshalb kurz warten und nochmal, sonst DeezerBusy.
 * Code 800 heißt wirklich „gibt es nicht“.
 */
async function dz<T>(url: string, tries = 3): Promise<T | null> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = (await r.json()) as T & { error?: { code?: number } };
        if (!j?.error) return j;
        if (j.error.code === 800) return null;
      }
    } catch {
      /* Netzfehler: wie ausgelastet behandeln */
    }
    if (i >= tries - 1) throw new DeezerBusy();
    await new Promise((res) => setTimeout(res, 300 * (i + 1) + Math.random() * 200));
  }
}

export async function deezer(artist: string, title: string, duration?: number | null, opts: { light?: boolean } = {}): Promise<(Partial<AudioInfo> & { id?: number; matchedTitle?: string; score?: number }) | null> {
  type Hit = { id: number; title: string; title_version?: string; duration?: number; preview?: string; artist?: { name: string } };
  const search = async (q: string) => (await dz<{ data?: Hit[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`))?.data ?? [];
  // Treffer aus exakter und freier Suche sammeln, dann den Mix wählen, der wirklich passt
  // (Titel inkl. Mix-Name in Klammern, Artist und Länge laut Discogs)
  const seen = new Map<number, Hit>();
  const titles = searchTitles(title);
  const queries = [`artist:"${clean(artist)}" track:"${clean(title)}"`, `${artist} ${title}`, `${clean(artist)} ${titles.at(-1) ?? title}`];
  const tried = new Set<string>();
  // Ist eine Suche ausgefallen, ist „nichts gefunden“ keine sichere Aussage
  let failed = false;
  // Alle Suchen einer Runde gleichzeitig (vorher nacheinander: das kostete je Hörprobe über eine Sekunde)
  const run = async (qs: string[]) => {
    const fresh = [...new Set(qs)].filter((q) => !tried.has(q) && q.trim().length >= 3);
    fresh.forEach((q) => tried.add(q));
    const res = await Promise.all(fresh.map((q) => search(q).catch(() => ((failed = true), [] as Hit[]))));
    for (const hits of res) for (const h of hits) seen.set(h.id, h);
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
  // Erst die beiden treffsichersten Suchen. Passt schon etwas gut, spart das die dritte (Deezer zählt jede Anfrage).
  await run(queries.slice(0, 2));
  let best = pick();
  if (!best || best.s < 0.8) {
    await run(queries.slice(2));
    best = pick();
  }
  if (!best || best.s < 0.55) {
    // Nichts Passendes: bei mehreren Artists („A & B“, „A feat. B“) führt Deezer oft nur einen. Dann je Artist
    // mit dem bloßen Titel suchen (ohne Klammern und ohne „feat. …“). Nur in diesem Fall, das spart Anfragen.
    const bare = (titles.at(-1) ?? title).replace(/\b(feat\.?|ft\.?|featuring)\s.+$/i, "").trim();
    const names = clean(artist).split(/\s*(?:,|&|\+|\bfeat\.?|\bft\.?|\bfeaturing\b|\bvs\.?|\bx\b|\band\b|\bpres\.?|\bpresents\b)\s*/i).map((n) => n.trim()).filter((n) => n.length > 1);
    await run([...names.slice(0, 2).map((n) => `${n} ${bare}`), `${clean(artist)} ${bare}`]);
    best = pick();
  }
  if (!best || best.s < 0.55) {
    if (failed) throw new DeezerBusy();
    return null;
  }
  const hit = best.h;
  // Nur für die Hörprobe (light) reicht der Suchtreffer: das Tempo steht erst in den Track-Details
  const track = opts.light && hit.preview ? ({ preview: hit.preview } as { bpm?: number; preview?: string }) : ((await dz<{ bpm?: number; preview?: string }>(`https://api.deezer.com/track/${hit.id}`)) ?? {});
  return {
    id: hit.id,
    bpm: track.bpm && track.bpm > 0 ? Math.round(track.bpm) : null,
    previewUrl: track.preview || hit.preview || null,
    matchedTitle: `${hit.artist?.name ?? ""} – ${hit.title}${hit.title_version ? ` ${hit.title_version}` : ""}`,
    score: Math.round(best.s * 100) / 100,
  };
}

export async function lookupAudio(_config: Config, artist: string, title: string, duration?: number | null): Promise<AudioInfo> {
  // DeezerBusy geht durch bis zur Route (503): „kein Tempo“ darf nur gemerkt werden, wenn wirklich gesucht wurde
  const ds = await deezer(artist, title, duration);
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
// „dz2“: frühere Einträge konnten falsche Fehlanzeigen enthalten (Deezer ausgelastet = „keine Hörprobe“)
const memoUrl = (key: string) => `https://memo.crate.invalid/dz2/${encodeURIComponent(key)}`;
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

const busy = () => new Response("Deezer ist gerade ausgelastet", { status: 503, headers: { "Retry-After": "3", "Cache-Control": "no-store" } });
const none = () => new Response("Keine Hörprobe", { status: 404 });
const audioKey = (id: number) => `https://memo.crate.invalid/dzaudio/${id}`;
const audioOut = (body: BodyInit | null, type: string | null) => new Response(body, { headers: { "Content-Type": type ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" } });

/**
 * Hörprobe so ausliefern, wie Safari sie erwartet: mit Länge und mit Abschnitten (Range).
 * Safaris Medien-Lader fragt zuerst „bytes=0-1“ und will darauf 206 mit Content-Range. Ohne das kennt das iPhone
 * die Dauer nicht (Spulen und Sperrbildschirm tot), manche Versionen spielen gar nicht. Chrome ist es egal.
 */
export async function audioRange(res: Response, range: string | null | undefined): Promise<Response> {
  if (res.status !== 200 || !res.body) return res;
  const buf = await res.arrayBuffer();
  const total = buf.byteLength;
  const headers = new Headers(res.headers);
  headers.set("Accept-Ranges", "bytes");
  const m = /^bytes=(\d*)-(\d*)$/.exec((range ?? "").trim());
  if (!m || (!m[1] && !m[2])) {
    headers.set("Content-Length", String(total));
    return new Response(buf, { status: 200, headers });
  }
  // „bytes=-500“ = die letzten 500, „bytes=100-“ = ab 100 bis zum Ende
  const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
  if (!total || start >= total || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}`, "Cache-Control": "no-store" } });
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(buf.slice(start, end + 1), { status: 206, headers });
}

/** Liegt die Hörprobe noch im Zwischenspeicher (10 Minuten)? Dann braucht es Deezer gar nicht. */
async function cachedAudio(id: number): Promise<Response | null> {
  try {
    const hit = await edgeCache()?.match(audioKey(id));
    return hit ? audioOut(hit.body, hit.headers.get("Content-Type")) : null;
  } catch {
    return null;
  }
}

/**
 * Hörprobe von Deezers Auslieferung holen und kurz zwischenspeichern. Der Browser fragt dieselbe Hörprobe oft
 * mehrmals an (Anfang, dann Abschnitte), und beim Diggen wird sie für die nächste Karte vorbereitet: ohne
 * Zwischenspeicher kostete jede dieser Anfragen wieder eine Anfrage bei Deezer.
 */
async function loadAudio(id: number | undefined, url: string | null | undefined): Promise<Response> {
  if (!url || !/^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(url)) return none();
  const r = await fetch(url).catch(() => null);
  if (!r?.ok) return new Response("Hörprobe nicht ladbar", { status: 502, headers: { "Cache-Control": "no-store" } });
  const type = r.headers.get("Content-Type");
  const buf = await r.arrayBuffer();
  if (id) {
    try {
      await edgeCache()?.put(audioKey(id), new Response(buf, { headers: { "Content-Type": type ?? "audio/mpeg", "Cache-Control": "public, max-age=600" } }));
    } catch {
      /* ohne Zwischenspeicher geht es auch */
    }
  }
  return audioOut(buf, type);
}

/**
 * Hörprobe von Deezer durchreichen (für die Analyse im Browser, dort fehlen CORS-Header).
 * warm: suchen, merken und die Hörprobe bereitlegen, aber nichts ausliefern (nächste Karte beim Diggen).
 * 404 = es gibt keine (darf gemerkt werden). 503 = Deezer war ausgelastet (gleich nochmal versuchen, nichts merken).
 */
export async function fetchPreview(artist: string, title: string, duration?: number | null, warm = false): Promise<Response> {
  const key = `${artist}|${title}|${duration ? Math.round(duration / 5) : ""}`.toLowerCase();
  const done = (r: Response) => (warm ? new Response(null, { status: r.ok ? 204 : r.status, headers: { "Cache-Control": "no-store" } }) : r);
  const known = await memoGet(key);
  if (known === 0) return none();
  if (known) return done(await fetchPreviewById(known));
  let d: Awaited<ReturnType<typeof deezer>>;
  try {
    d = await deezer(artist, title, duration, { light: true });
  } catch {
    return busy();
  }
  const ok = Boolean(d?.id && d.previewUrl);
  await memoSet(key, ok ? d!.id! : 0);
  if (!ok) return none();
  return done(await loadAudio(d!.id, d!.previewUrl));
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
  // Ausgelastet (DeezerBusy) geht durch bis zur Route: sonst gälte die Platte als „nicht bei Deezer“
  const get = <T>(url: string): Promise<T | null> => dz<T>(url);
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
  // Fehlt nur ein Tempo, weil Deezer gerade bremst, bleibt die Zuordnung trotzdem gültig
  const details = await Promise.all(chosen.slice(0, 40).map((p) => get<{ bpm?: number }>(`https://api.deezer.com/track/${p.t.id}`).catch(() => null)));
  const matches: Record<string, ReleaseTrackOut> = {};
  chosen.slice(0, 40).forEach((p, i) => {
    const bpm = details[i]?.bpm;
    matches[p.key] = { deezerId: p.t.id, bpm: bpm && bpm > 0 ? Math.round(bpm) : null, title: `${p.t.title}${p.t.title_version ? ` ${p.t.title_version}` : ""}`, score: Math.round(p.s * 100) / 100 };
  });
  return { album: `${best.a.artist?.name ?? ""} – ${best.a.title}`, matches };
}

/** Hörprobe zu einer bekannten Deezer-Track-ID (frische, signierte URL von Deezer) */
export async function fetchPreviewById(id: number): Promise<Response> {
  if (!Number.isInteger(id) || id <= 0) return none();
  const cached = await cachedAudio(id);
  if (cached) return cached;
  let t: { preview?: string } | null;
  try {
    t = await dz<{ preview?: string }>(`https://api.deezer.com/track/${id}`);
  } catch {
    return busy();
  }
  return loadAudio(id, t?.preview);
}
