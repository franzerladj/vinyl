// Google-Sheets-Spiegel über ein eigenes Apps-Script (siehe google-sheets/Code.gs).
// Die App schreibt Sammlung, Wantlist, Tracks und Sets als Tabellenblätter und kann
// Änderungen an BPM/Key/Energie aus dem Blatt "Tracks" zurücklesen.
import { stripFolder, wantFolderOf } from "../../../shared/folders";
import { db, getKV, realTracks, trackId } from "./db";
import { discogsReleaseUrl } from "./format";
import { camelotString, parseKey } from "../../../shared/music";

export interface SheetsConfig { url: string; secret: string }

export const getSheetsConfig = () => getKV<SheetsConfig>("sheets", { url: "", secret: "" });

async function buildPayload() {
  const [collection, wants, releases, tracks, metas, sets, stats] = await Promise.all([
    db.collection.toArray(),
    db.wants.toArray(),
    db.releases.toArray(),
    db.tracks.toArray(),
    db.recordMeta.toArray(),
    db.sets.toArray(),
    db.marketStats.toArray(),
  ]);
  const rel = new Map(releases.map((r) => [r.id, r]));
  const meta = new Map(metas.map((m) => [m.releaseId, m]));
  const stat = new Map(stats.map((s) => [s.releaseId, s]));
  const tr = new Map(tracks.map((t) => [t.id, t]));

  const recordRow = (id: number, added: string) => {
    const r = rel.get(id);
    return [id, r?.artist ?? "", r?.title ?? "", r?.labels[0]?.name ?? "", r?.labels[0]?.catno ?? "", r?.year || "", (r?.genres ?? []).join(", "), (r?.styles ?? []).join(", "), added.slice(0, 10), discogsReleaseUrl(id)];
  };

  const Collection = [
    ["Release-ID", "Artist", "Titel", "Label", "Katalognr.", "Jahr", "Genre", "Styles", "Hinzugefügt", "Discogs", "Regalplatz", "Sticker gedruckt", "Tracks", "Bewertung"],
    ...collection.map((c) => {
      const r = rel.get(c.releaseId);
      const m = meta.get(c.releaseId);
      return [...recordRow(c.releaseId, c.dateAdded), m?.shelf ?? "", m?.stickerPrintedAt ? new Date(m.stickerPrintedAt).toISOString().slice(0, 10) : "", realTracks(r?.tracklist).length, c.rating || ""];
    }),
  ];
  const Wantlist = [
    ["Release-ID", "Artist", "Titel", "Label", "Katalognr.", "Jahr", "Genre", "Styles", "Hinzugefügt", "Discogs", "Günstigster Preis", "Angebote", "Notiz", "Ordner"],
    ...wants.map((w) => [...recordRow(w.releaseId, w.dateAdded), stat.get(w.releaseId)?.lowest ?? "", stat.get(w.releaseId)?.numForSale ?? "", stripFolder(w.notes), wantFolderOf(w.notes) ?? ""]),
  ];
  const inColl = new Set(collection.map((c) => c.releaseId));
  const Tracks = [
    ["Track-ID", "Release-ID", "Pos.", "Artist", "Track", "BPM", "Key", "Camelot", "Energie", "Vibes", "Sterne", "Notiz"],
    ...[...inColl].flatMap((id) => {
      const r = rel.get(id);
      return realTracks(r?.tracklist).map((t, i) => {
        const m = tr.get(trackId(id, t.position, i));
        return [trackId(id, t.position, i), id, t.position, m?.artist ?? r?.artist ?? "", t.title, m?.bpm ?? "", m?.key ?? "", camelotString(parseKey(m?.key)), m?.energy ?? "", (m?.moods ?? []).join(", "), m?.stars ?? "", m?.notes ?? ""];
      });
    }),
  ];
  const Sets = [
    ["Set", "Datum", "Venue", "Nr.", "Pos.", "Artist", "Track", "BPM", "Key"],
    ...sets.flatMap((s) =>
      s.trackIds.map((id, i) => {
        const t = tr.get(id);
        return [s.name, s.date ?? "", s.venue ?? "", i + 1, t?.position ?? "", t?.artist ?? "", t?.title ?? "", t?.bpm ?? "", t?.key ?? ""];
      }),
    ),
  ];
  return { Collection, Wantlist, Tracks, Sets };
}

export async function pushToSheets() {
  const cfg = await getSheetsConfig();
  if (!cfg.url) throw new Error("Keine Apps-Script-URL hinterlegt");
  const sheets = await buildPayload();
  // text/plain vermeidet einen CORS-Preflight, Apps Script liest den Body trotzdem
  await fetch(cfg.url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ secret: cfg.secret, sheets }) });
  return Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.length - 1]));
}

/** Liest das Blatt "Tracks" und übernimmt BPM, Key, Energie, Vibes, Sterne und Notizen */
export async function pullTracksFromSheets() {
  const cfg = await getSheetsConfig();
  if (!cfg.url) throw new Error("Keine Apps-Script-URL hinterlegt");
  const res = await fetch(`${cfg.url}?secret=${encodeURIComponent(cfg.secret)}&sheet=Tracks`);
  const data = (await res.json()) as { rows?: (string | number)[][]; error?: string };
  if (data.error || !data.rows) throw new Error(data.error ?? "Keine Daten");
  const [head, ...rows] = data.rows;
  const col = (name: string) => head.indexOf(name);
  let changed = 0;
  await db.transaction("rw", db.tracks, async () => {
    for (const row of rows) {
      const id = String(row[col("Track-ID")]);
      const t = await db.tracks.get(id);
      if (!t) continue;
      const bpm = Number(row[col("BPM")]) || null;
      const key = String(row[col("Key")] ?? "") || null;
      const energy = Number(row[col("Energie")]) || null;
      const moods = String(row[col("Vibes")] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const stars = Number(row[col("Sterne")]) || 0;
      const notes = String(row[col("Notiz")] ?? "");
      if (bpm !== (t.bpm ?? null) || key !== (t.key ?? null) || energy !== (t.energy ?? null) || stars !== (t.stars ?? 0) || notes !== (t.notes ?? "") || moods.join() !== (t.moods ?? []).join()) {
        await db.tracks.update(id, { bpm, key, energy, moods, stars, notes });
        changed++;
      }
    }
  });
  return changed;
}
