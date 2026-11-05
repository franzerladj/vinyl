// Quellen für den Digging-Feed: Discogs-Suche nach Labels, Artists und Styles aus der
// eigenen Sammlung, Neuerscheinungen, gesuchte Raritäten, Zufallsfunde und Freunde.
import { discogs } from "./api";
import { db, getKV, setKV } from "./db";
import type { SearchResult } from "./types";
import { currency } from "./sync";
import { decadeLabel, decadeYears, emptyWeights, inDecade, learn, mix, splitTitle, top, type DigAction, type DigCard, type DigSource, type DigWeights } from "../../../shared/dig";

const FALLBACK_STYLES = ["Deep House", "Disco", "Soul", "Jazz-Funk", "Techno", "Boogie", "House", "Funk"];
const SEEN_MAX = 4000;

export async function loadWeights(): Promise<DigWeights> {
  const saved = await getKV<DigWeights | null>("digWeights", null);
  if (saved) return saved;
  // Erster Start: Vorlieben aus der Sammlung ableiten
  const ids = [...new Set((await db.collection.toArray()).map((c) => c.releaseId))];
  const rels = (await db.releases.bulkGet(ids)).filter(Boolean);
  const w = emptyWeights();
  const count = (m: Record<string, number>, k?: string) => k && (m[k] = (m[k] ?? 0) + 1);
  for (const r of rels) {
    r!.styles.slice(0, 3).forEach((s) => count(w.style, s));
    count(w.label, r!.labels[0]?.name.replace(/\s\(\d+\)$/, ""));
    count(w.artist, r!.artist);
  }
  // Auf 0 bis 6 skalieren, damit Lernen schnell wirkt
  for (const m of [w.style, w.label, w.artist]) {
    const max = Math.max(1, ...Object.values(m));
    for (const k of Object.keys(m)) m[k] = Math.round((m[k] / max) * 6 * 10) / 10;
  }
  return w;
}

export async function recordAction(c: DigCard, action: DigAction) {
  const w = learn(await loadWeights(), c, action);
  await setKV("digWeights", w);
  return w;
}

export async function markSeen(id: number) {
  const seen = await getKV<number[]>("digSeen", []);
  if (seen.includes(id)) return;
  seen.push(id);
  await setKV("digSeen", seen.slice(-SEEN_MAX));
}

/** Likes (getrennt von der Wantlist), neueste zuerst */
export const likedCards = () => getKV<(DigCard & { likedAt: number })[]>("digLiked", []);

export async function setLiked(c: DigCard, on: boolean) {
  const list = (await likedCards()).filter((x) => x.id !== c.id);
  await setKV("digLiked", on ? [{ ...c, likedAt: Date.now() }, ...list].slice(0, 500) : list);
}

/** Weggewischtes für eine Weile ganz ausblenden */
export async function markSkipped(id: number) {
  const s = await getKV<number[]>("digSkipped", []);
  await setKV("digSkipped", [...s.filter((x) => x !== id), id].slice(-SEEN_MAX));
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

async function search(params: string, source: DigSource, reason: string): Promise<DigCard[]> {
  try {
    const d = await discogs<{ results: SearchResult[] }>(`/database/search?type=release&format=Vinyl&per_page=30&${params}`);
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

/** Neue Runde Karten aus allen Quellen holen und mischen */
export async function buildQueue(f: DigFilter = {}, exclude: Set<number> = new Set()): Promise<DigCard[]> {
  const w = await loadWeights();
  const enc = encodeURIComponent;
  const myStyles = top(w.style, 8);
  const styles = f.style ? [f.style] : myStyles.length ? myStyles : FALLBACK_STYLES;
  const [s1, s2, s3] = pick(styles, 3).concat(pick(FALLBACK_STYLES, 3));
  const year = new Date().getFullYear();
  const dec = f.decade;
  const ys = dec ? decadeYears(dec, 4) : [];
  const yearParam = (i: number) => (dec ? `&year=${ys[i % ys.length]}` : "");
  const jobs: Promise<DigCard[]>[] = dec
    ? [
        search(`style=${enc(s1)}${yearParam(0)}`, "random", `${s1} aus den ${decadeLabel(dec)}`),
        search(`style=${enc(s1)}${yearParam(1)}&page=2`, "random", `${s1} aus den ${decadeLabel(dec)}`),
        search(`style=${enc(s2)}${yearParam(2)}&page=${1 + Math.floor(Math.random() * 3)}`, "rare", `Gesucht in ${s2}`).then((cs) =>
          cs.filter((c) => (c.want ?? 0) > 30 && (c.want ?? 0) / Math.max(1, c.have ?? 0) > 1),
        ),
        search(`style=${enc(s3)}${yearParam(3)}&page=${1 + Math.floor(Math.random() * 5)}`, "random", `Zufallsfund ${s3}`),
      ]
    : [
        search(`style=${enc(s1)}&year=${year}`, "new", `Neu in ${s1}`),
        search(`style=${enc(s1)}&year=${year - 1}`, "new", `Neu in ${s1}`),
        search(`style=${enc(s2)}&page=${1 + Math.floor(Math.random() * 5)}`, "rare", `Gesucht in ${s2}`).then((cs) =>
          cs.filter((c) => (c.want ?? 0) > 50 && (c.want ?? 0) / Math.max(1, c.have ?? 0) > 1.2),
        ),
        search(`style=${enc(s3)}&page=${1 + Math.floor(Math.random() * 20)}`, "random", `Zufallsfund ${s3}`),
      ];
  const sources = await Promise.all(jobs);
  const [owned, wanted, skipped] = await Promise.all([
    db.collection.toArray().then((c) => c.map((x) => x.releaseId)),
    db.wants.toCollection().primaryKeys(),
    getKV<number[]>("digSkipped", []),
  ]);
  const ex = new Set([...exclude, ...owned, ...wanted, ...skipped]);
  // Style-Filter: auch Label- und Freunde-Karten müssen passen
  // Jahrzehnt: auch Label-, Artist- und Freunde-Karten müssen passen
  const filtered = sources.map((s) => s.filter((c) => (!f.style || c.styles.includes(f.style)) && inDecade(c.year, f.decade)));
  return mix(filtered, w, ex);
}

/** „Mehr davon“: gleiche Label, Artist und Style */
export async function moreLike(c: DigCard, exclude: Set<number>): Promise<DigCard[]> {
  const enc = encodeURIComponent;
  const jobs = [search(`artist=${enc(c.artist)}`, "foryou", `Mehr von ${c.artist}`)];
  if (c.label) jobs.push(search(`label=${enc(c.label)}`, "foryou", `Mehr von ${c.label}`));
  if (c.styles[0]) jobs.push(search(`style=${enc(c.styles[0])}&year=${c.year ?? ""}`, "foryou", `Mehr ${c.styles[0]}`));
  const w = await loadWeights();
  return mix(await Promise.all(jobs), w, exclude).slice(0, 12);
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
export function digDetail(id: number): Promise<DigDetail> {
  let p = details.get(id);
  if (!p) {
    p = currency()
      .then((cur) =>
        discogs<{ tracklist?: { position: string; title: string; duration?: string; type_?: string }[]; videos?: { uri: string }[]; lowest_price?: number | null; num_for_sale?: number }>(`/releases/${id}?curr_abbr=${cur}`).then((r) => ({ r, cur })),
      )
      .then(({ r, cur }) => ({
        lowest: r.lowest_price ?? null,
        forSale: r.num_for_sale ?? 0,
        currency: cur,
        tracks: (r.tracklist ?? []).filter((t) => !t.type_ || t.type_ === "track"),
        video: r.videos?.map((v) => v.uri.match(/[?&]v=([\w-]{11})/)?.[1]).find(Boolean),
      }))
      .catch(() => ({ tracks: [] }));
    details.set(id, p);
  }
  return p;
}
