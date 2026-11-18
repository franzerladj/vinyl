// Cover für ohne Netz: im Club oder im Keller gibt es oft keins. Die Cover der Platten eines Sets
// (Reihenfolge und Kiste) werden deshalb vorab gesichert, in denselben Speicher, aus dem der
// Service Worker Discogs-Bilder ausliefert. Geladen wird über den eigenen Server (/api/img), weil
// Discogs-Bilder ohne CORS kommen: direkt gespeichert wären sie „undurchsichtig“ und der Browser
// rechnet dafür je Bild mehrere Megabyte Speicher an.
import { db, type DJSet } from "./db";
import { pool } from "./pool";

const CACHE = "covers";
const isDiscogsImage = (u?: string): u is string => Boolean(u && /^https:\/\/(i|st|img)\.discogs\.com\//.test(u));

/** Bilder sichern, die noch fehlen. Gibt zurück, wie viele jetzt offline da sind. */
export async function cacheCovers(urls: (string | undefined)[]): Promise<{ ready: number; total: number }> {
  const list = [...new Set(urls.filter(isDiscogsImage))];
  if (typeof caches === "undefined" || !list.length) return { ready: 0, total: list.length };
  const cache = await caches.open(CACHE);
  let ready = 0;
  const missing: string[] = [];
  for (const u of list) {
    const hit = await cache.match(u);
    // Undurchsichtige Einträge (vom normalen Laden) zählen nicht: sie lassen sich nicht prüfen
    if (hit && hit.type !== "opaque") ready++;
    else missing.push(u);
  }
  if (!missing.length || !navigator.onLine) return { ready, total: list.length };
  await pool(missing, 4, async (u) => {
    const r = await fetch(`/api/img?u=${encodeURIComponent(u)}`);
    if (!r.ok) return;
    await cache.put(u, r);
    ready++;
  });
  return { ready, total: list.length };
}

/** Bilder der Platten eines Sets: klein für Listen, groß für Live-Modus und Player */
export async function setCoverUrls(set: Pick<DJSet, "trackIds" | "crateIds">): Promise<string[]> {
  const tracks = (await db.tracks.bulkGet(set.trackIds)).filter(Boolean) as { releaseId: number }[];
  const ids = [...new Set([...tracks.map((t) => t.releaseId), ...(set.crateIds ?? [])])];
  const rels = (await db.releases.bulkGet(ids)).filter(Boolean) as { thumb?: string; cover?: string }[];
  return rels.flatMap((r) => [r.thumb, r.cover]).filter(isDiscogsImage);
}

export const cacheSetCovers = async (set: Pick<DJSet, "trackIds" | "crateIds">) => cacheCovers(await setCoverUrls(set));

/** Beim Start: Sets von heute und der nächsten 14 Tage sichern, ohne dass man sie öffnen muss */
export async function cacheUpcomingSets(): Promise<void> {
  if (!navigator.onLine) return;
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const sets = (await db.sets.toArray()).filter((s) => s.date && s.date >= today && s.date <= until);
  for (const s of sets) await cacheSetCovers(s).catch(() => undefined);
}
