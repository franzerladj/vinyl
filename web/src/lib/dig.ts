// Quellen für den Digging-Feed: Discogs-Suche nach Labels, Artists und Styles aus der
// eigenen Sammlung, Neuerscheinungen, gesuchte Raritäten, Zufallsfunde und Freunde.
import { discogs, hurryDiscogs } from "./api";
import { db, getKV, setKV } from "./db";
import type { SearchResult } from "./types";
import { currency } from "./sync";
import { decadeLabel, decadeYears, inDecade, splitTitle, type DigAction, type DigCard, type DigSource, type DigWeights } from "../../../shared/dig";
import { arrange, emptyTaste, features, forget, learnTaste, sample, seedTaste, topTaste, viewReward, type SessionEvent, type Signal, type Taste } from "../../../shared/taste";

const FALLBACK_STYLES = ["Deep House", "Disco", "Soul", "Jazz-Funk", "Techno", "Boogie", "House", "Funk"];
const SEEN_MAX = 4000;

// Stile zum Erkunden: was im Profil noch kaum vorkommt, kommt hieraus
const EXPLORE = ["Deep House", "Disco", "Soul", "Jazz-Funk", "Techno", "Boogie", "House", "Funk", "Italo-Disco", "Dub", "Electro", "Acid House", "Ambient", "Balearic", "Afrobeat", "Leftfield", "Minimal", "Detroit Techno", "Garage House", "Broken Beat", "Downtempo", "Jazz", "Latin Jazz", "Synth-pop", "Dub Techno", "Breaks", "UK Garage", "Electro House", "Experimental", "New Wave", "Post-Punk", "Library Music", "Psychedelic Rock", "Reggae", "Hip Hop", "Bossa Nova", "Gospel", "Afro-Cuban", "Highlife", "Cosmic Disco"];

let tasteCache: Taste | null = null;
let tasteAt = 0;
/** Laufende Sitzung: was gerade zieht (nur im Speicher, wie das Kurzzeit-Gedächtnis eines Feeds) */
const session: SessionEvent[] = [];
export const digSession = () => session;

/** Geschmacksprofil laden. Beim ersten Mal aus der Sammlung und dem alten Profil ableiten. */
export async function loadTaste(): Promise<Taste> {
  // Kurz zwischenspeichern; danach neu lesen (ein anderes Gerät kann das Profil geändert haben)
  if (tasteCache && Date.now() - tasteAt < 20000) return tasteCache;
  tasteAt = Date.now();
  const saved = await getKV<Taste | null>("digTaste", null);
  if (saved?.v === 2) return (tasteCache = saved);
  const ids = [...new Set((await db.collection.toArray()).map((c) => c.releaseId))];
  const rels = (await db.releases.bulkGet(ids)).filter(Boolean).map((r) => ({ styles: r!.styles, label: r!.labels[0]?.name.replace(/\s\(\d+\)$/, ""), artist: r!.artist, year: r!.year ? String(r!.year) : undefined, country: r!.country }));
  let t = rels.length ? seedTaste(rels) : emptyTaste();
  // Altes Profil (Gewichte aus Likes, Wants, Skips) mitnehmen
  const old = await getKV<DigWeights | null>("digWeights", null);
  if (old) {
    const now = Date.now();
    const add = (k: string, v: number) => {
      const cur = t.f[k] ?? { s: 0, n: 0, t: now };
      t = { ...t, f: { ...t.f, [k]: { s: cur.s + v * 0.5, n: cur.n + Math.min(6, Math.abs(v) * 0.3), t: now } } };
    };
    for (const [k, v] of Object.entries(old.style)) add(`s:${k}`, v);
    for (const [k, v] of Object.entries(old.label)) add(`l:${k}`, v * 0.8);
    for (const [k, v] of Object.entries(old.artist)) add(`a:${k}`, v * 0.7);
  }
  tasteCache = t;
  await setKV("digTaste", t);
  return t;
}

/** Profil von einem anderen Gerät übernommen: Zwischenspeicher verwerfen */
export const dropTasteCache = () => void (tasteCache = null);

async function learnNow(c: DigCard, signal: Signal, opts: { seconds?: number; listened?: number } = {}) {
  const r = signal === "view" ? viewReward(opts.seconds ?? 0, opts.listened ?? 0) : ({ like: 2.5, unlike: -2.5, want: 3, collect: 3, more: 2, skip: -2, share: 2, detail: 0.6, video: 0.8 } as const)[signal];
  session.push({ keys: features(c), r });
  if (session.length > 60) session.splice(0, session.length - 60);
  // Lesen, ändern, schreiben in einer Transaktion: schnelles Wischen löst mehrere Aktionen gleichzeitig aus
  return db.transaction("rw", db.kv, db.collection, db.releases, async () => {
    tasteCache = null;
    const t = learnTaste(await loadTaste(), c, signal, opts);
    tasteCache = t;
    await setKV("digTaste", t);
    return t;
  });
}

/** Knopf-Aktionen: Like, Want, Mehr davon, Weg … */
export function recordAction(c: DigCard, action: DigAction) {
  if (action === "dwell") return Promise.resolve(tasteCache);
  return learnNow(c, action);
}

/** Stilles Signal beim Weiterwischen: wie lange angeschaut, wie lange mitgehört */
export function recordView(c: DigCard, seconds: number, listened: number) {
  return learnNow(c, "view", { seconds, listened });
}

/** Kleine Signale: Tracklist geöffnet, Video gestartet, geteilt */
export function recordSignal(c: DigCard, s: "detail" | "video" | "share") {
  return learnNow(c, s);
}

/** Restliche Karten nach dem aktuellen Stand neu ordnen (nach jeder Reaktion) */
export async function rearrange(rest: DigCard[], before: DigCard[]): Promise<DigCard[]> {
  return arrange(await loadTaste(), rest, session, { before });
}

/** Lieblings-Styles fürs Kopfband */
export async function favoriteStyles(n = 8): Promise<string[]> {
  return topTaste(await loadTaste(), "s", n).map((x) => x.key);
}

export async function forgetTaste(key: string) {
  const t = forget(await loadTaste(), key);
  tasteCache = t;
  await setKV("digTaste", t);
  return t;
}

export async function resetTaste() {
  tasteCache = null;
  session.length = 0;
  await setKV("digTaste", null);
  await setKV("digWeights", null);
  return loadTaste();
}

export function markSeen(id: number) {
  return db.transaction("rw", db.kv, async () => {
    const seen = await getKV<number[]>("digSeen", []);
    if (seen.includes(id)) return;
    seen.push(id);
    await setKV("digSeen", seen.slice(-SEEN_MAX));
  });
}

/** Likes (getrennt von der Wantlist), neueste zuerst */
export const likedCards = () => getKV<(DigCard & { likedAt: number })[]>("digLiked", []);

export function setLiked(c: DigCard, on: boolean) {
  return db.transaction("rw", db.kv, async () => {
    const list = (await likedCards()).filter((x) => x.id !== c.id);
    await setKV("digLiked", on ? [{ ...c, likedAt: Date.now() }, ...list].slice(0, 500) : list);
  });
}

/** Weggewischtes für eine Weile ganz ausblenden */
export function markSkipped(id: number) {
  return db.transaction("rw", db.kv, async () => {
    const s = await getKV<number[]>("digSkipped", []);
    await setKV("digSkipped", [...s.filter((x) => x !== id), id].slice(-SEEN_MAX));
  });
}

const pick = <T,>(arr: T[], n: number) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

function toCard(r: SearchResult, source: DigSource, reason: string): DigCard | null {
  if (r.type !== "release" || !r.cover_image || r.cover_image.includes("spacer.gif")) return null;
  const { artist, title } = splitTitle(r.title);
  return {
    id: r.id,
    artist,
    title,
    thumb: r.thumb,
    cover: r.cover_image,
    year: r.year,
    label: r.label?.[0]?.replace(/\s\(\d+\)$/, ""),
    catno: r.catno,
    styles: r.style ?? [],
    country: r.country,
    have: r.community?.have,
    want: r.community?.want,
    source,
    reason,
  };
}

async function search(params: string, source: DigSource, reason: string, soon = false): Promise<DigCard[]> {
  try {
    // Eine von mehreren Quellen: antwortet Discogs nicht in 7 s, geht es ohne sie weiter
    const d = await discogs<{ results: SearchResult[] }>(`/database/search?type=release&format=Vinyl&per_page=30&${params}`, { quick: true, soon });
    return d.results.map((r) => toCard(r, source, reason)).filter(Boolean) as DigCard[];
  } catch (e) {
    console.warn("Diggen", params, e);
    return [];
  }
}

async function friendCards(): Promise<DigCard[]> {
  const items = (await db.friendItems.toArray()).filter((i) => i.kind === "coll").sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 60);
  const rels = await db.releases.bulkGet(items.map((i) => i.releaseId));
  return rels
    .map((r, i) =>
      r && r.cover
        ? ({ id: r.id, artist: r.artist, title: r.title, thumb: r.thumb, cover: r.cover, year: r.year ? String(r.year) : undefined, label: r.labels[0]?.name, catno: r.labels[0]?.catno, styles: r.styles, country: r.country, have: r.community?.have, want: r.community?.want, source: "friends", reason: `Bei ${items[i].username}` } satisfies DigCard)
        : null,
    )
    .filter(Boolean) as DigCard[];
}

export interface DigFilter {
  style?: string;
  /** z. B. 1990 für die 90er */
  decade?: number;
  /** Höchstpreis in der eigenen Währung (günstigstes Angebot) */
  maxPrice?: number;
}

export interface QueueOptions {
  /** Erste Karten, sobald die erste Quelle geantwortet hat (der Rest folgt als Ergebnis) */
  early?: (cards: DigCard[]) => void;
  /** Vorpacken im Leerlauf: steht hinter allem, was du antippst */
  soon?: boolean;
}

/** Neue Runde Karten: Quellen nach dem Geschmacksprofil ziehen, dann für dich ordnen */
export async function buildQueue(f: DigFilter = {}, exclude: Set<number> = new Set(), before: DigCard[] = [], opts: QueueOptions = {}): Promise<DigCard[]> {
  const t = await loadTaste();
  const enc = encodeURIComponent;
  const rnd = (n: number) => 1 + Math.floor(Math.random() * n);
  // Stärkere Vorlieben öfter ziehen, aber nicht immer dieselben (Gewicht wächst exponentiell)
  const favStyles = topTaste(t, "s", 14).map((x) => ({ item: x.key, weight: Math.exp(x.value * 1.5) }));
  const pickStyle = () => f.style ?? sample(favStyles) ?? EXPLORE[Math.floor(Math.random() * 8)];
  const s1 = pickStyle();
  let s2 = pickStyle();
  if (s2 === s1 && !f.style) s2 = pickStyle();
  // Erkunden: ein Style, den das Profil kaum kennt
  const unknown = EXPLORE.filter((s) => (t.f[`s:${s}`]?.n ?? 0) < 2);
  const sx = f.style ?? unknown[Math.floor(Math.random() * unknown.length)] ?? EXPLORE[Math.floor(Math.random() * EXPLORE.length)];
  const favLabel = sample(topTaste(t, "l", 12).map((x) => ({ item: x.key, weight: Math.exp(x.value) })));
  const favDecade = sample(topTaste(t, "d", 4).map((x) => ({ item: Number(x.key), weight: Math.exp(x.value) })));
  const year = new Date().getFullYear();
  const dec = f.decade;
  const ys = dec ? decadeYears(dec, 4) : favDecade ? decadeYears(favDecade, 2) : [];
  const decYear = (i: number) => (ys.length ? `&year=${ys[i % ys.length]}` : "");
  const find = (params: string, source: DigSource, reason: string) => search(params, source, reason, opts.soon);
  const net: Promise<DigCard[]>[] = [
    find(`style=${enc(s1)}${dec ? decYear(0) : ""}&page=${rnd(4)}`, "foryou", `Für dich: ${s1}`),
    dec
      ? find(`style=${enc(s2)}${decYear(1)}&page=${rnd(2)}`, "foryou", `${s2} aus den ${decadeLabel(dec)}`)
      : find(`style=${enc(s1)}&year=${year - Math.floor(Math.random() * 2)}`, "new", `Neu in ${s1}`),
    find(`style=${enc(s2)}${dec ? decYear(2) : ""}&page=${rnd(5)}`, "rare", `Gesucht in ${s2}`).then((cs) => cs.filter((c) => (c.want ?? 0) > 30 && (c.want ?? 0) / Math.max(1, c.have ?? 0) > 1)),
    find(`style=${enc(sx)}${dec ? decYear(3) : ""}&page=${rnd(8)}`, "random", f.style ? `Zufallsfund ${sx}` : `Mal was anderes: ${sx}`),
  ];
  if (favLabel) net.push(find(`label=${enc(favLabel)}&page=${rnd(2)}`, "foryou", `Weil du ${favLabel} magst`));
  if (!dec && favDecade && ys.length) net.push(find(`style=${enc(s2)}${decYear(0)}`, "foryou", `${s2} aus den ${decadeLabel(favDecade)}`));
  const local: Promise<DigCard[]>[] = !f.style && !dec ? [friendCards()] : [];
  // Was schon da ist (Sammlung, Wants, Weggewischtes), liegt auf dem Gerät: gleich laden, nicht erst nach den Suchen
  const known = Promise.all([
    db.collection.toArray().then((c) => c.map((x) => x.releaseId)),
    db.wants.toCollection().primaryKeys(),
    getKV<number[]>("digSkipped", []),
    getKV<number[]>("digSeen", []),
  ]);
  const settle = async (sources: DigCard[][]) => {
    const [owned, wanted, skipped, seen] = await known;
    const ex = new Set([...exclude, ...owned, ...wanted, ...skipped]);
    const seenSet = new Set(seen.slice(-1500));
    const all = new Map<number, DigCard>();
    for (const c of sources.flat()) {
      if (ex.has(c.id) || all.has(c.id)) continue;
      // Stil- und Jahrzehnt-Filter gelten für alle Quellen (auch Label und Freunde)
      if ((f.style && !c.styles.includes(f.style)) || !inDecade(c.year, f.decade)) continue;
      all.set(c.id, c);
    }
    // Schon Gesehenes nur, wenn sonst kaum etwas da ist
    let list = [...all.values()];
    const fresh = list.filter((c) => !seenSet.has(c.id));
    if (fresh.length >= 8) list = fresh;
    return arrange(t, list, session, { before });
  };
  if (opts.early) {
    // Nicht auf die langsamste Suche warten: sobald eine Quelle Karten hat, noch einen Augenblick
    // auf die anderen warten und dann zeigen, was da ist. Discogs braucht je Suche oft Sekunden.
    const got: DigCard[][] = [];
    let state: "wait" | "armed" | "done" = "wait";
    const fire = async () => {
      if (state === "done") return;
      state = "done";
      const first = await settle(got);
      if (first.length) opts.early?.(first);
    };
    const localGot = local.map((p) => p.then((cs) => void got.push(cs)));
    for (const p of net)
      void p.then(async (cs) => {
        got.push(cs);
        if (state !== "wait" || !cs.length) return;
        state = "armed";
        await Promise.all(localGot);
        setTimeout(() => void fire(), EARLY_GRACE_MS);
      });
    const sources = await Promise.all([...net, ...local]);
    // Alles war schneller als die Frist: die frühe Auswahl braucht es nicht mehr
    state = "done";
    return settle(sources);
  }
  return settle(await Promise.all([...net, ...local]));
}
/** So lange wartet die erste Auswahl noch auf weitere Quellen, nachdem die erste da ist */
const EARLY_GRACE_MS = 350;

// Die Kiste liegt bereit: was beim letzten Mal nicht mehr dran kam, bleibt (höchstens 6 Stunden, so alt dürfen
// Discogs-Daten sein), und nach dem Start der App wird im Leerlauf eine neue Runde gepackt. Beim Antippen von
// „Diggen“ steht die erste Karte dann sofort da, statt erst nach mehreren Suchen bei Discogs.
const QUEUE_MAX_AGE = 6 * 3600_000;
const QUEUE_KEEP = 40;
interface StoredQueue {
  at: number;
  filter: string;
  cards: DigCard[];
}
const filterKey = (f: DigFilter) => `${f.style ?? ""}|${f.decade ?? ""}|${f.maxPrice ?? ""}`;

/** Übrige Karten merken (die aktuelle und alles davor ist gesehen) */
export function keepQueue(f: DigFilter, rest: DigCard[]) {
  return setKV("digQueue", { at: Date.now(), filter: filterKey(f), cards: rest.slice(0, QUEUE_KEEP) } satisfies StoredQueue);
}

/** Bereitliegende Karten für diesen Filter, ohne inzwischen Gekauftes, Gewolltes, Weggewischtes und Gesehenes */
export async function keptQueue(f: DigFilter): Promise<DigCard[]> {
  if (warming) await warming.catch(() => undefined);
  const q = await getKV<StoredQueue | null>("digQueue", null);
  if (!q || q.filter !== filterKey(f) || Date.now() - q.at > QUEUE_MAX_AGE) return [];
  const [owned, wanted, skipped, seen] = await Promise.all([
    db.collection.toArray().then((c) => c.map((x) => x.releaseId)),
    db.wants.toCollection().primaryKeys(),
    getKV<number[]>("digSkipped", []),
    getKV<number[]>("digSeen", []),
  ]);
  const gone = new Set<number>([...owned, ...(wanted as number[]), ...skipped, ...seen.slice(-1500)]);
  return q.cards.filter((c) => !gone.has(c.id));
}

let warming: Promise<void> | null = null;
/** Im Leerlauf nach dem Start: eine Runde vorpacken, wenn man schon einmal gediggt hat und nichts bereitliegt */
export function warmDig(): Promise<void> {
  warming ??= (async () => {
    const seen = await getKV<number[]>("digSeen", []);
    if (!seen.length || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    const f = await getKV<DigFilter>("digFilter", {});
    const q = await getKV<StoredQueue | null>("digQueue", null);
    if (q && q.filter === filterKey(f) && Date.now() - q.at < QUEUE_MAX_AGE && q.cards.length >= 8) return;
    const cards = await buildQueue(f, new Set(), [], { soon: true });
    if (cards.length) await keepQueue(f, cards);
  })().finally(() => (warming = null));
  return warming;
}

/** „Diggen“ wurde angetippt, während noch vorgepackt wird: die Suchen rücken nach vorn */
export const hurryDig = () => hurryDiscogs("/database/search");

/** „Mehr davon“: gleiche Label, Artist und Style */
export async function moreLike(c: DigCard, exclude: Set<number>): Promise<DigCard[]> {
  const enc = encodeURIComponent;
  const jobs = [search(`artist=${enc(c.artist)}`, "foryou", `Mehr von ${c.artist}`)];
  if (c.label) jobs.push(search(`label=${enc(c.label)}`, "foryou", `Mehr von ${c.label}`));
  if (c.styles[0]) jobs.push(search(`style=${enc(c.styles[0])}&year=${c.year ?? ""}`, "foryou", `Mehr ${c.styles[0]}`));
  const seen = new Set<number>();
  const list = (await Promise.all(jobs)).flat().filter((x) => !exclude.has(x.id) && !seen.has(x.id) && (seen.add(x.id), true));
  return arrange(await loadTaste(), list, session, { before: [c] }).slice(0, 12);
}

export interface DigDetail {
  tracks: { position: string; title: string; duration?: string }[];
  video?: string;
  /** Günstigstes Angebot in der eigenen Währung, null = keins */
  lowest?: number | null;
  forSale?: number;
  currency?: string;
}

const details = new Map<number, Promise<DigDetail>>();

/** Tracklist und Video für Hörprobe und Detailansicht, im Speicher zwischengespeichert */
export function digDetail(id: number, opts: { soon?: boolean } = {}): Promise<DigDetail> {
  let p = details.get(id);
  if (!p) {
    p = currency()
      .then((cur) =>
        discogs<{ tracklist?: { position: string; title: string; duration?: string; type_?: string }[]; videos?: { uri: string }[]; lowest_price?: number | null; num_for_sale?: number }>(`/releases/${id}?curr_abbr=${cur}`, { soon: opts.soon }).then((r) => ({ r, cur })),
      )
      .then(({ r, cur }) => ({
        lowest: r.lowest_price ?? null,
        forSale: r.num_for_sale ?? 0,
        currency: cur,
        tracks: (r.tracklist ?? []).filter((t) => !t.type_ || t.type_ === "track"),
        video: r.videos?.map((v) => v.uri.match(/[?&]v=([\w-]{11})/)?.[1]).find(Boolean),
      }))
      .catch(() => {
        // Fehlschlag nicht merken: beim nächsten Blick auf die Karte wird neu geladen
        details.delete(id);
        return { tracks: [] } as DigDetail;
      });
    details.set(id, p);
  } else if (!opts.soon) hurryDiscogs(`/releases/${id}?`);
  return p;
}
