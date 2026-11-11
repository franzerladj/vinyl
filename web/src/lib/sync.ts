// Abgleich mit Discogs + Anreicherung (Tracklists, BPM/Key, Vibes, Preise)
import { api, discogs } from "./api";
import { autoUpdateTrack, db, realTracks, setKV, getKV, trackId, type Release, type TrackMeta } from "./db";
import { checkKey } from "../../../shared/bpmCheck";
import { retempo } from "./tempo";
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
    identifiers: r.identifiers ?? [],
    companies: (r.companies ?? []).map((c) => ({ name: c.name, entity_type_name: c.entity_type_name })),
    community: r.community ? { have: r.community.have, want: r.community.want } : undefined,
    detailFetchedAt: Date.now(),
  };
}

export async function upsertBasics(items: BasicInformation[]) {
  const prev = await db.releases.bulkGet(items.map((i) => i.id));
  await db.releases.bulkPut(items.map((b, i) => fromBasic(b, prev[i])));
}

interface CollPage { pagination: Pagination; releases: { id: number; instance_id: number; folder_id: number; date_added: string; rating: number; notes?: { field_id: number; value: string }[]; basic_information: BasicInformation }[] }

/** Discogs-Standardfelder der Sammlung */
export const FIELD = { media: 1, sleeve: 2, note: 3 } as const;
const field = (n: { field_id: number; value: string }[] | undefined, id: number) => n?.find((x) => x.field_id === id)?.value || undefined;
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
    // Ordnerliste mitnehmen (eine Anfrage), Fehler hier sollen den Sync nicht stoppen
    await import("./folders").then((f) => f.syncFolders()).catch((e) => console.warn("Ordner", e));
    do {
      const data = await discogs<CollPage>(`/users/${u()}/collection/folders/0/releases?per_page=100&page=${page}&sort=added&sort_order=desc`, { background: true });
      pages = data.pagination.pages;
      await upsertBasics(data.releases.map((r) => r.basic_information));
      await db.collection.bulkPut(
        data.releases.map((r) => ({ instanceId: r.instance_id, releaseId: r.id, folderId: r.folder_id, dateAdded: r.date_added, rating: r.rating, media: field(r.notes, FIELD.media), sleeve: field(r.notes, FIELD.sleeve), note: field(r.notes, FIELD.note) })),
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
    await import("./folders").then((f) => f.reapplyPending()).catch(() => undefined);
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
    await import("./folders").then((f) => f.reapplyPending()).catch(() => undefined);
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

/**
 * BPM/Key für Tracks ohne Werte nachschlagen.
 * Schritt 1 pro Platte: ganzes Album bei Deezer zuordnen (eine Anfrage, genaue Zuordnung über Mix und Länge).
 * Schritt 2 für den Rest: einzeln bei Deezer suchen. Tonarten kommen aus der eigenen Messung.
 */
export async function lookupAudioFor(trackIds?: string[]) {
  const all = trackIds ? ((await db.tracks.bulkGet(trackIds)).filter(Boolean) as TrackMeta[]) : await db.tracks.toArray();
  const collIds = new Set((await db.collection.toArray()).map((c) => c.releaseId));
  const todo = all.filter((t) => (trackIds || collIds.has(t.releaseId)) && !t.lookedUpAt && (!t.bpm || !t.key));
  if (!todo.length) return 0;
  const rels = new Map((await db.releases.bulkGet([...new Set(todo.map((t) => t.releaseId))])).filter(Boolean).map((r) => [r!.id, r!]));
  const durations = new Map<string, string | undefined>();
  for (const r of rels.values()) realTracks(r.tracklist).forEach((x, i) => durations.set(trackId(r.id, x.position, i), x.duration));
  const byRelease = new Map<number, TrackMeta[]>();
  todo.forEach((t) => byRelease.set(t.releaseId, [...(byRelease.get(t.releaseId) ?? []), t]));

  const job = "audio";
  jobUpdate(job, { label: "BPM & Key suchen", done: 0, total: todo.length });
  let found = 0;
  let done = 0;
  try {
    await pool([...byRelease.entries()], 3, async ([rid, tracks]) => {
      const r = rels.get(rid);
      const rest: TrackMeta[] = [];
      // 1. Album-Zuordnung
      if (r) {
        try {
          const res = await api<{ matches: Record<string, { deezerId: number; bpm: number | null }> }>("/api/audio/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artist: r.artist, title: r.title, tracks: tracks.map((t) => ({ key: t.id, title: t.title, artist: t.artist, duration: parseDuration(durations.get(t.id)) })) }),
          });
          for (const t of tracks) {
            const m = res.matches[t.id];
            if (!m) {
              rest.push(t);
              continue;
            }
            const patch: Partial<TrackMeta> = { deezerId: m.deezerId };
            // Rohwert merken, geprüft und mit der eigenen Messung abgeglichen wird in retempo()
            if (m.bpm && t.dbBpm == null) {
              patch.dbBpm = m.bpm;
              patch.dbSource = "Deezer (Album)";
              if (!t.bpm) found++;
            }
            patch.lookedUpAt = Date.now();
            done++;
            await autoUpdateTrack(t.id, patch);
          }
        } catch (e) {
          console.warn("Album", rid, e);
          rest.push(...tracks);
        }
      } else rest.push(...tracks);
      jobUpdate(job, { done });
      // 2. Einzeln suchen
      for (const t of rest) {
        try {
          const dur = parseDuration(durations.get(t.id));
          const info = await api<AudioInfo>(`/api/audio/lookup?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(t.title)}${dur ? `&duration=${dur}` : ""}`);
          const patch: Partial<TrackMeta> = { lookedUpAt: Date.now() };
          const key = checkKey(info.key);
          const src = info.source.join(", ");
          if (info.bpm && t.dbBpm == null) {
            patch.dbBpm = info.bpm;
            patch.dbSource = src;
          }
          if (!t.key && key) {
            patch.key = key;
            patch.keySource = src;
          }
          if ((patch.dbBpm && !t.bpm) || patch.key) found++;
          await autoUpdateTrack(t.id, patch);
        } catch (e) {
          // Netzfehler: nicht als erledigt markieren, beim nächsten Durchlauf erneut versuchen
          console.warn("audio", t.id, e);
        }
        jobUpdate(job, { done: ++done });
      }
    });
    // Datenbank-Werte prüfen und mit vorhandenen Messungen abgleichen
    await retempo(todo.map((t) => t.id));
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
  const { enrichFree } = await import("./free");
  return enrichFree(trackIds, { audio: opts.audio ?? true });
}

export async function currency(): Promise<string> {
  return getKV("currency", "EUR");
}

/** Marktpreise laden (mit Verlauf und Preisempfehlung, siehe prices.ts) */
export async function fetchMarketStats(ids: number[], maxAgeHours = 6) {
  const { refreshPrices } = await import("./prices");
  return refreshPrices(ids, { maxAgeHours, background: ids.length > 1 });
}

// ---------- Aktionen ----------
/** Zustand von Platte oder Hülle bei Discogs speichern (Wert wie „Very Good Plus (VG+)“, leer = löschen) */
export async function setCondition(instanceId: number, which: "media" | "sleeve", value: string) {
  const item = await db.collection.get(instanceId);
  if (!item) throw new Error("Platte nicht in der Sammlung");
  // Sofort anzeigen, bei Fehler zurücknehmen (Discogs antwortet bei laufendem Sync manchmal erst nach Sekunden)
  const before = item[which];
  await db.collection.update(instanceId, { [which]: value || undefined });
  try {
    const folder = await import("./folders").then((f) => f.discogsFolderOf(instanceId, item.folderId));
    await discogs(`/users/${u()}/collection/folders/${folder}/releases/${item.releaseId}/instances/${instanceId}/fields/${FIELD[which]}`, { method: "POST", body: { value }, retry: true });
  } catch (e) {
    await db.collection.update(instanceId, { [which]: before });
    throw e;
  }
}

/** Kaufpreis eintragen (null = löschen). Steht als Marke in der Discogs-Notiz des Exemplars. */
export async function setPaid(instanceId: number, value: number | null, currency = "EUR") {
  const item = await db.collection.get(instanceId);
  if (!item) throw new Error("Platte nicht in der Sammlung");
  const { withPaid } = await import("../../../shared/paid");
  const note = withPaid(item.note, value, currency);
  if (note === (item.note ?? "")) return;
  const folder = await import("./folders").then((f) => f.discogsFolderOf(instanceId, item.folderId));
  await discogs(`/users/${u()}/collection/folders/${folder}/releases/${item.releaseId}/instances/${instanceId}/fields/${FIELD.note}`, { method: "POST", body: { value: note }, retry: true });
  await db.collection.update(instanceId, { note: note || undefined });
}

export async function addWant(id: number) {
  await discogs(`/users/${u()}/wants/${id}`, { method: "PUT" });
  await db.wants.put({ releaseId: id, dateAdded: new Date().toISOString(), rating: 0 });
  if (!(await db.releases.get(id))) await fetchRelease(id);
}

export async function removeWant(id: number) {
  await discogs(`/users/${u()}/wants/${id}`, { method: "DELETE" });
  await db.wants.delete(id);
}

export async function addToCollection(id: number, folder?: number) {
  // Gekauftes Want landet im Ordner, dem es auf der Wantlist zugeordnet war
  const folderId: number = folder ?? (await (await import("./folders")).folderForNewRecord(id));
  const res = await discogs<{ instance_id: number }>(`/users/${u()}/collection/folders/${folderId}/releases/${id}`, { method: "POST" });
  // Sofort lokal eintragen: scheitert danach das Nachladen, tippt man sonst nochmal und hat die Platte doppelt bei Discogs
  await db.collection.put({ instanceId: res.instance_id, releaseId: id, folderId, dateAdded: new Date().toISOString(), rating: 0 });
  // Neue Platte braucht einen Sticker
  const meta = await db.recordMeta.get(id);
  await db.recordMeta.put({ ...meta, releaseId: id, stickerPrintedAt: null });
  const rel = await fetchRelease(id).catch((e) => {
    console.warn("Details der neuen Platte", e);
    return null;
  });
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
      await step("Lieblingshändler", async () => {
        // Neue Angebote für Wants bei Lieblingshändlern: Mitteilung, falls eingeschaltet
        const before = new Set(await db.listings.toCollection().primaryKeys());
        await scanFavorites(24);
        const fresh = (await db.listings.toArray()).filter((l) => !before.has(l.listingId));
        if (fresh.length) {
          const { localNotify } = await import("./push");
          const sellers = [...new Set(fresh.map((l) => l.seller))];
          await localNotify("sellers", fresh.length === 1 ? "Neues Angebot für eine Want" : `${fresh.length} neue Angebote für deine Wants`, `bei ${sellers.slice(0, 3).join(", ")}${sellers.length > 3 ? " und weiteren" : ""}`, "/shop");
        }
      });
      await step("Neue Pressungen", async () => {
        const { checkRepresses } = await import("./repress");
        const found = await checkRepresses();
        if (found.length) {
          const { localNotify } = await import("./push");
          await localNotify("wants", found.length === 1 ? "Eine Want wurde neu gepresst" : `${found.length} Wants wurden neu gepresst`, "Schau auf deine Wantlist", "/wants");
        }
      });
      const { syncFriends } = await import("./friends");
      await step("Freunde", () => syncFriends(6));
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
    // Wants und Termine für Mitteilungen aktuell halten
    void import("./push").then((m) => m.syncPushData());
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

/** Einmalig nach Einführung der Album-Zuordnung: Tracks ohne BPM nochmal suchen lassen */
export async function migrateAlbumMatching() {
  if (await getKV("migration-album-v1", false)) return;
  await db.tracks.toCollection().modify((t) => {
    if (!t.bpm) {
      t.lookedUpAt = undefined;
      t.analyzedAt = undefined;
      t.analyzeTries = undefined;
    }
  });
  await setKV("migration-album-v1", true);
}

/**
 * Neue Tempo-Erkennung und genauere Deezer-Zuordnung (Artist getrennt geprüft):
 * gemessene Werte neu berechnen und erfolglose Suchen wiederholen. Eigene Eingaben bleiben.
 */
export async function migrateTempoV2() {
  if (await getKV("migration-tempo-v2", false)) return;
  await db.tracks.toCollection().modify((t) => {
    if (t.bpmSource === "Analyse") {
      t.bpm = undefined;
      t.bpmSource = undefined;
    }
    if (t.keySource?.startsWith("Analyse")) {
      t.key = undefined;
      t.keySource = undefined;
    }
    if (!t.deezerId) t.lookedUpAt = undefined;
    if (!t.bpm || !t.key) {
      t.analyzedAt = undefined;
      t.analyzeTries = undefined;
    }
  });
  await setKV("migration-tempo-v2", true);
}
