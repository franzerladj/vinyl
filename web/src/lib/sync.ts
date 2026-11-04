// Abgleich mit Discogs + Anreicherung (Tracklists, BPM/Key, Vibes, Preise)
import { api, canClaude, discogs } from "./api";
import { db, realTracks, setKV, getKV, trackId, type Release, type TrackMeta } from "./db";
import { artistName } from "./format";
import { parseDuration } from "../../../shared/match";
import { logError, pool } from "./pool";
import { getState, jobUpdate, toast, username } from "./store";
import type { BasicInformation, DRelease, Pagination } from "./types";

const u = () => encodeURIComponent(username());

export function fromBasic(b: BasicInformation, prev?: Release): Release {
  return {
    ...prev,
    id: b.id,
    title: b.title,
    artist: artistName(b.artists),
    year: b.year,
    labels: b.labels ?? [],
    formats: b.formats ?? [],
    genres: b.genres ?? [],
    styles: b.styles ?? [],
    thumb: b.thumb,
    cover: b.cover_image || prev?.cover || b.thumb,
  };
}

export function fromDetail(r: DRelease, prev?: Release): Release {
  return {
    ...fromBasic(r, prev),
    cover: r.images?.find((i) => i.type === "primary")?.uri ?? r.images?.[0]?.uri ?? prev?.cover ?? r.thumb,
    country: r.country,
    tracklist: r.tracklist,
    videos: r.videos,
    masterId: r.master_id,
    community: r.community ? { have: r.community.have, want: r.community.want } : undefined,
    detailFetchedAt: Date.now(),
  };
}

export async function upsertBasics(items: BasicInformation[]) {
  const prev = await db.releases.bulkGet(items.map((i) => i.id));
  await db.releases.bulkPut(items.map((b, i) => fromBasic(b, prev[i])));
}

interface CollPage { pagination: Pagination; releases: { id: number; instance_id: number; folder_id: number; date_added: string; rating: number; basic_information: BasicInformation }[] }
interface WantPage { pagination: Pagination; wants: { id: number; date_added: string; rating: number; notes?: string; basic_information: BasicInformation }[] }

export async function syncCollection() {
  const job = "collection";
  jobUpdate(job, { label: "Sammlung laden", done: 0, total: 1 });
  try {
    const seen = new Set<number>();
    let page = 1;
    let pages = 1;
    const known = new Set((await db.collection.toArray()).map((c) => c.releaseId));
    let added = 0;
    do {
      const data = await discogs<CollPage>(`/users/${u()}/collection/folders/0/releases?per_page=100&page=${page}&sort=added&sort_order=desc`, { background: true });
      pages = data.pagination.pages;
      await upsertBasics(data.releases.map((r) => r.basic_information));
      await db.collection.bulkPut(
        data.releases.map((r) => ({ instanceId: r.instance_id, releaseId: r.id, folderId: r.folder_id, dateAdded: r.date_added, rating: r.rating })),
      );
      for (const r of data.releases) {
        seen.add(r.instance_id);
        if (!known.has(r.id)) added++;
      }
      jobUpdate(job, { done: page, total: pages });
      page++;
    } while (page <= pages);
    // Entfernte Einträge löschen
    const stale = (await db.collection.toArray()).filter((c) => !seen.has(c.instanceId)).map((c) => c.instanceId);
    await db.collection.bulkDelete(stale);
    await setKV("lastCollectionSync", Date.now());
    if (known.size > 0 && added > 0) toast(`${added} neue Platte(n) in der Sammlung`);
  } finally {
    jobUpdate(job, null);
  }
}

export async function syncWants() {
  const job = "wants";
  jobUpdate(job, { label: "Wantlist laden", done: 0, total: 1 });
  try {
    const seen = new Set<number>();
    let page = 1;
    let pages = 1;
    do {
      const data = await discogs<WantPage>(`/users/${u()}/wants?per_page=100&page=${page}`, { background: true });
      pages = data.pagination.pages;
      await upsertBasics(data.wants.map((w) => w.basic_information));
      await db.wants.bulkPut(data.wants.map((w) => ({ releaseId: w.id, dateAdded: w.date_added, rating: w.rating, notes: w.notes })));
      data.wants.forEach((w) => seen.add(w.id));
      jobUpdate(job, { done: page, total: pages });
      page++;
    } while (page <= pages);
    const stale = (await db.wants.toCollection().primaryKeys()).filter((id) => !seen.has(id));
    await db.wants.bulkDelete(stale);
    await setKV("lastWantsSync", Date.now());
  } finally {
    jobUpdate(job, null);
  }
}

/** Komplette Release-Daten holen (Tracklist, Videos) und Track-Datensätze anlegen */
export async function fetchRelease(id: number, background = false): Promise<Release> {
  const r = await discogs<DRelease>(`/releases/${id}?curr_abbr=${await currency()}`, { background });
  const prev = await db.releases.get(id);
  const rel = fromDetail(r, prev);
  await db.releases.put(rel);
  await ensureTracks(rel);
  return rel;
}

export async function ensureTracks(rel: Release) {
  const tracks = realTracks(rel.tracklist);
  const ids = tracks.map((t, i) => trackId(rel.id, t.position, i));
  const existing = await db.tracks.bulkGet(ids);
  const fresh: TrackMeta[] = [];
  tracks.forEach((t, i) => {
    if (existing[i]) return;
    fresh.push({
      id: ids[i],
      releaseId: rel.id,
      position: t.position,
      title: t.title,
      artist: t.artists?.length ? artistName(t.artists) : rel.artist,
    });
  });
  if (fresh.length) await db.tracks.bulkAdd(fresh);
}

/** Für alle Platten der Sammlung fehlende Tracklists nachladen */
export async function fetchMissingDetails(scope: "collection" | "wants" = "collection") {
  const ids = scope === "collection" ? [...new Set((await db.collection.toArray()).map((c) => c.releaseId))] : await db.wants.toCollection().primaryKeys();
  const rels = await db.releases.bulkGet(ids);
  const todo = ids.filter((_, i) => !rels[i]?.detailFetchedAt);
  if (!todo.length) return;
  const job = `details-${scope}`;
  jobUpdate(job, { label: "Tracklists laden", done: 0, total: todo.length });
  try {
    let done = 0;
    for (const id of todo) {
      try {
        await fetchRelease(id, true);
      } catch (e) {
        console.warn("Release", id, e);
      }
      jobUpdate(job, { done: ++done });
    }
  } finally {
    jobUpdate(job, null);
  }
}

interface AudioInfo { bpm: number | null; key: string | null; source: string[]; previewUrl: string | null }

/** BPM/Key für Tracks ohne Werte nachschlagen (GetSongBPM / Deezer über den Server) */
export async function lookupAudioFor(trackIds?: string[]) {
  const all = trackIds ? ((await db.tracks.bulkGet(trackIds)).filter(Boolean) as TrackMeta[]) : await db.tracks.toArray();
  const collIds = new Set((await db.collection.toArray()).map((c) => c.releaseId));
  const todo = all.filter((t) => (trackIds || collIds.has(t.releaseId)) && !t.lookedUpAt && (!t.bpm || !t.key));
  if (!todo.length) return 0;
  const durations = new Map<string, string | undefined>();
  for (const r of (await db.releases.bulkGet([...new Set(todo.map((t) => t.releaseId))])).filter(Boolean)) {
    realTracks(r!.tracklist).forEach((x, i) => durations.set(trackId(r!.id, x.position, i), x.duration));
  }
  const job = "audio";
  jobUpdate(job, { label: "BPM & Key suchen", done: 0, total: todo.length });
  let found = 0;
  try {
    let done = 0;
    // Drei Anfragen gleichzeitig: Deezer und GetSongBPM sind nicht das Discogs-Limit
    await pool(todo, 3, async (t) => {
      try {
        const dur = parseDuration(durations.get(t.id));
        const info = await api<AudioInfo>(`/api/audio/lookup?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(t.title)}${dur ? `&duration=${dur}` : ""}`);
        const patch: Partial<TrackMeta> = { lookedUpAt: Date.now() };
        if (!t.bpm && info.bpm) patch.bpm = info.bpm;
        if (!t.key && info.key) patch.key = info.key;
        if (patch.bpm || patch.key) {
          patch.bpmSource = info.source.join(", ");
          found++;
        }
        await db.tracks.update(t.id, patch);
      } catch (e) {
        // Netzfehler: nicht als erledigt markieren, beim nächsten Durchlauf erneut versuchen
        console.warn("audio", t.id, e);
      }
      jobUpdate(job, { done: ++done });
    });
  } finally {
    jobUpdate(job, null);
  }
  return found;
}

/**
 * Energie + Vibes ergänzen. Mit Claude (Allowlist oder eigener Key) per KI,
 * sonst kostenlos über Regeln, Last.fm und Audio-Analyse.
 */
export async function tagVibes(trackIds?: string[], opts: { audio?: boolean } = {}) {
  if (!canClaude(getState().me)) {
    const { enrichFree } = await import("./free");
    return enrichFree(trackIds, { audio: opts.audio ?? true });
  }
  return tagVibesClaude(trackIds);
}

async function tagVibesClaude(trackIds?: string[]) {
  const all = trackIds ? ((await db.tracks.bulkGet(trackIds)).filter(Boolean) as TrackMeta[]) : await db.tracks.toArray();
  const todo = all.filter((t) => t.energy == null || (t.vibeSource !== "manuell" && t.vibeSource !== "Claude"));
  if (!todo.length) return 0;
  const rels = new Map((await db.releases.bulkGet([...new Set(todo.map((t) => t.releaseId))])).filter(Boolean).map((r) => [r!.id, r!]));
  const job = "vibes";
  jobUpdate(job, { label: "Vibes taggen (KI)", done: 0, total: todo.length });
  try {
    for (let i = 0; i < todo.length; i += 40) {
      const chunk = todo.slice(i, i + 40);
      const res = await api<{ items: { id: string; energy: number; moods: string[]; slot: string }[] }>("/api/ai/vibes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: chunk.map((t) => ({ id: t.id, artist: t.artist, title: t.title, styles: rels.get(t.releaseId)?.styles ?? [], year: rels.get(t.releaseId)?.year, bpm: t.bpm ?? undefined })),
        }),
      });
      await db.transaction("rw", db.tracks, async () => {
        for (const it of res.items) await db.tracks.update(it.id, { energy: it.energy, moods: [...new Set([...it.moods, it.slot])], vibeSource: "Claude" });
      });
      jobUpdate(job, { done: Math.min(todo.length, i + 40) });
    }
  } finally {
    jobUpdate(job, null);
  }
  return todo.length;
}

export async function currency(): Promise<string> {
  return getKV("currency", "EUR");
}

/** Marktpreise laden (mit Verlauf und Preisempfehlung, siehe prices.ts) */
export async function fetchMarketStats(ids: number[], maxAgeHours = 12) {
  const { refreshPrices } = await import("./prices");
  return refreshPrices(ids, { maxAgeHours, background: ids.length > 1 });
}

// ---------- Aktionen ----------
export async function addWant(id: number) {
  await discogs(`/users/${u()}/wants/${id}`, { method: "PUT" });
  await db.wants.put({ releaseId: id, dateAdded: new Date().toISOString(), rating: 0 });
  if (!(await db.releases.get(id))) await fetchRelease(id);
}

export async function removeWant(id: number) {
  await discogs(`/users/${u()}/wants/${id}`, { method: "DELETE" });
  await db.wants.delete(id);
}

export async function addToCollection(id: number, folderId = 1) {
  const res = await discogs<{ instance_id: number }>(`/users/${u()}/collection/folders/${folderId}/releases/${id}`, { method: "POST" });
  const rel = await fetchRelease(id);
  await db.collection.put({ instanceId: res.instance_id, releaseId: id, folderId, dateAdded: new Date().toISOString(), rating: 0 });
  // Neue Platte braucht einen Sticker
  const meta = await db.recordMeta.get(id);
  await db.recordMeta.put({ ...meta, releaseId: id, stickerPrintedAt: null });
  // und gleich ihre Tracks analysieren (im Hintergrund)
  void (async () => {
    const ids = (await db.tracks.where("releaseId").equals(id).toArray()).map((t) => t.id);
    const auto = await getAutoSettings();
    if (!auto.analyze) return;
    await lookupAudioFor(ids);
    await tagVibes(ids, { audio: auto.audio });
  })().catch((e) => console.warn("Analyse neue Platte", e));
  return rel;
}

export async function removeFromCollection(instanceId: number) {
  const item = await db.collection.get(instanceId);
  if (!item) return;
  await discogs(`/users/${u()}/collection/folders/${item.folderId}/releases/${item.releaseId}/instances/${instanceId}`, { method: "DELETE" });
  await db.collection.delete(instanceId);
}

export async function rateRelease(releaseId: number, rating: number) {
  const items = await db.collection.where("releaseId").equals(releaseId).toArray();
  for (const it of items) {
    await discogs(`/users/${u()}/collection/folders/${it.folderId}/releases/${releaseId}/instances/${it.instanceId}`, { method: "POST", body: { rating } });
    await db.collection.update(it.instanceId, { rating });
  }
}

export async function fullSync() {
  await syncLists();
  await fetchMissingDetails("collection");
}

/** Nur Sammlung und Wantlist abgleichen (schnell, wenige Anfragen) */
export async function syncLists() {
  await Promise.all([syncCollection(), syncWants()]);
}

export interface AutoSettings {
  /** Nach dem Sync automatisch BPM, Key, Vibes und Preise ergänzen */
  analyze: boolean;
  /** Hörproben dabei analysieren (Datenvolumen) */
  audio: boolean;
}
export const getAutoSettings = () => getKV<AutoSettings>("auto", { analyze: true, audio: true });

let pipelineRunning = false;
export const isPipelineRunning = () => pipelineRunning;

/** Bildschirm wach halten, solange der Durchlauf läuft (sonst friert das Handy die App ein) */
async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => undefined);
  } catch {
    return () => undefined;
  }
}

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.warn(name, e);
    await logError(name, e);
  }
}

/**
 * Kompletter Durchlauf in zwei parallelen Spuren:
 * - Discogs-Spur: Tracklists, Preise der Wants, Details der Wants, Lieblingshändler, Freunde
 *   (alles über die Discogs-Warteschlange mit ihrem Limit)
 * - Audio-Spur: BPM/Key-Suche, Vibes und Hörproben-Analyse (andere Dienste, läuft gleichzeitig)
 * Jeder Schritt arbeitet nur ab, was noch fehlt. Bricht etwas ab, macht der nächste Start dort weiter.
 */
export async function autoPipeline(opts: { force?: boolean; resume?: boolean } = {}) {
  if (pipelineRunning) return;
  pipelineRunning = true;
  const release = await keepAwake();
  try {
    if (!opts.resume) await step("Sync", syncLists);
    const auto = await getAutoSettings();
    if (!auto.analyze && !opts.force) {
      await step("Tracklists", () => fetchMissingDetails("collection"));
      return;
    }
    let discogsDone = false;
    const discogsLane = async () => {
      const { refreshPrices, scanFavorites } = await import("./prices");
      const wantIds = await db.wants.toCollection().primaryKeys();
      // Tracklists und Preise wechseln sich in der Warteschlange ab, so kommt beides zügig
      await Promise.all([step("Tracklists", () => fetchMissingDetails("collection")), step("Preise", () => refreshPrices(wantIds, { maxAgeHours: 24 }))]);
      discogsDone = true;
      await step("Details der Wants", () => fetchMissingDetails("wants"));
      await step("Lieblingshändler", () => scanFavorites(24));
      const { syncFriends } = await import("./friends");
      await step("Freunde", () => syncFriends(24));
    };
    const audioLane = async () => {
      // Läuft in Runden, bis keine neuen Tracklists mehr dazukommen
      for (let round = 0; round < 40; round++) {
        await step("BPM & Key", () => lookupAudioFor());
        await step("Vibes", () => tagVibes(undefined, { audio: auto.audio }));
        if (discogsDone) {
          await step("BPM & Key", () => lookupAudioFor());
          await step("Vibes", () => tagVibes(undefined, { audio: auto.audio }));
          break;
        }
        await new Promise((r) => setTimeout(r, 8000));
      }
    };
    await Promise.all([discogsLane(), audioLane()]);
    await setKV("lastAutoRun", Date.now());
  } finally {
    release();
    pipelineRunning = false;
  }
}

/**
 * Einmalig: automatisch ermittelte BPM/Keys verwerfen, die noch ohne Mix- und Längenprüfung
 * gefunden wurden. Manuelle Werte bleiben. Beim nächsten Durchlauf wird neu gesucht.
 */
export async function migrateAudioMatching() {
  if (await getKV("migration-match-v1", false)) return;
  await db.transaction("rw", db.tracks, async () => {
    await db.tracks.toCollection().modify((t) => {
      if (t.bpmSource && t.bpmSource !== "manuell") {
        t.bpm = null;
        t.bpmSource = undefined;
      }
      // Keys kamen nur aus GetSongBPM oder der Audio-Analyse; manuelle Keys bleiben
      const autoKey = t.keySource ? t.keySource !== "manuell" : Boolean(t.bpmSource?.includes("GetSongBPM"));
      if (t.key && autoKey) {
        t.key = null;
        t.keySource = undefined;
      }
      t.lookedUpAt = undefined;
      t.analyzedAt = undefined;
      t.audioEnergy = undefined;
    });
  });
  await setKV("migration-match-v1", true);
  await setKV("lastCollectionSync", 0); // nächster Start analysiert neu
}
