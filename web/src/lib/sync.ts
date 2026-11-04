// Abgleich mit Discogs + Anreicherung (Tracklists, BPM/Key, Vibes, Preise)
import { api, discogs } from "./api";
import { db, realTracks, setKV, getKV, trackId, type Release, type TrackMeta } from "./db";
import { artistName } from "./format";
import { jobUpdate, toast, username } from "./store";
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

async function upsertBasics(items: BasicInformation[]) {
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
  const job = "audio";
  jobUpdate(job, { label: "BPM & Key suchen", done: 0, total: todo.length });
  let found = 0;
  try {
    let done = 0;
    for (const t of todo) {
      try {
        const info = await api<AudioInfo>(`/api/audio/lookup?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(t.title)}`);
        const patch: Partial<TrackMeta> = { lookedUpAt: Date.now() };
        if (!t.bpm && info.bpm) patch.bpm = info.bpm;
        if (!t.key && info.key) patch.key = info.key;
        if (patch.bpm || patch.key) {
          patch.bpmSource = info.source.join(", ");
          found++;
        }
        await db.tracks.update(t.id, patch);
      } catch (e) {
        console.warn("audio", t.id, e);
      }
      jobUpdate(job, { done: ++done });
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    jobUpdate(job, null);
  }
  return found;
}

/** Energie + Vibe-Tags per KI schätzen lassen */
export async function tagVibes(trackIds?: string[]) {
  const all = trackIds ? ((await db.tracks.bulkGet(trackIds)).filter(Boolean) as TrackMeta[]) : await db.tracks.toArray();
  const todo = all.filter((t) => t.energy == null);
  if (!todo.length) return;
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
        for (const it of res.items) await db.tracks.update(it.id, { energy: it.energy, moods: [...new Set([...it.moods, it.slot])] });
      });
      jobUpdate(job, { done: Math.min(todo.length, i + 40) });
    }
  } finally {
    jobUpdate(job, null);
  }
}

export async function currency(): Promise<string> {
  return getKV("currency", "EUR");
}

interface Stats { lowest_price: { value: number; currency: string } | null; num_for_sale: number }

export async function fetchMarketStats(ids: number[], maxAgeHours = 12) {
  const cur = await currency();
  const existing = await db.marketStats.bulkGet(ids);
  const todo = ids.filter((_, i) => !existing[i] || Date.now() - existing[i]!.fetchedAt > maxAgeHours * 3600_000);
  if (!todo.length) return;
  const job = "stats";
  jobUpdate(job, { label: "Marktpreise laden", done: 0, total: todo.length });
  try {
    let done = 0;
    for (const id of todo) {
      try {
        const s = await discogs<Stats>(`/marketplace/stats/${id}?curr_abbr=${cur}`, { background: true });
        await db.marketStats.put({ releaseId: id, lowest: s.lowest_price?.value ?? null, currency: s.lowest_price?.currency ?? cur, numForSale: s.num_for_sale ?? 0, fetchedAt: Date.now() });
      } catch (e) {
        console.warn("stats", id, e);
      }
      jobUpdate(job, { done: ++done });
    }
  } finally {
    jobUpdate(job, null);
  }
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
  await Promise.all([syncCollection(), syncWants()]);
  await fetchMissingDetails("collection");
}
