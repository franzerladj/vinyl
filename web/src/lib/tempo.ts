// Tempo gegenprüfen: Datenbank-Wert (dbBpm) und eigene Messung (measuredBpm) zusammenführen,
// Faktor-2-Fehler über die Styles der Platte korrigieren, Widersprüche als „unsicher“ markieren.
// Von Hand eingetragene Tempi (manuell, Mithören, Tap) bleiben immer unangetastet.
import { db, getKV, setKV, type TrackMeta } from "./db";
import { checkBpm, reconcileTempo } from "../../../shared/bpmCheck";

const MANUAL = new Set(["manuell", "Mithören", "Tap"]);
export const isManualTempo = (t: Pick<TrackMeta, "bpmSource">) => MANUAL.has(t.bpmSource ?? "");

/** Alte Einträge: Wert und Quelle stecken noch in bpm/bpmSource */
function sources(t: TrackMeta) {
  let dbBpm = t.dbBpm;
  let dbSource = t.dbSource;
  let measured = t.measuredBpm;
  let conf = t.measuredConf;
  if (dbBpm === undefined && measured === undefined && t.bpm != null && !isManualTempo(t)) {
    if (t.bpmSource === "Analyse") {
      measured = t.bpm;
      conf = 0.5;
    } else {
      dbBpm = t.bpm;
      dbSource = t.bpmSource || "Datenbank";
    }
  }
  return { dbBpm, dbSource, measured, conf };
}

/** Tempo einer Auswahl von Tracks (oder aller) neu bewerten. Gibt die Zahl der geänderten Tracks zurück. */
export async function retempo(trackIds?: string[]): Promise<number> {
  const subset = trackIds ? ((await db.tracks.bulkGet(trackIds)).filter(Boolean) as TrackMeta[]) : await db.tracks.toArray();
  if (!subset.length) return 0;
  const relIds = [...new Set(subset.map((t) => t.releaseId))];
  const [rels, all] = await Promise.all([db.releases.bulkGet(relIds), trackIds ? db.tracks.where("releaseId").anyOf(relIds).toArray() : Promise.resolve(subset)]);
  const styles = new Map(rels.filter(Boolean).map((r) => [r!.id, r!.styles]));
  // Erste Runde: grob geprüftes Tempo je Track, als Vergleich für die anderen Tracks derselben Platte
  const rough = new Map<string, number>();
  for (const t of all) {
    if (isManualTempo(t) && t.bpm) {
      rough.set(t.id, t.bpm);
      continue;
    }
    const s = sources(t);
    const c = checkBpm(s.dbBpm ?? s.measured, { styles: styles.get(t.releaseId) ?? [], siblings: [] });
    if (c.bpm && !c.unsure) rough.set(t.id, c.bpm);
  }
  let changed = 0;
  await db.transaction("rw", db.tracks, async () => {
    for (const t0 of subset) {
      const t = await db.tracks.get(t0.id);
      if (!t) continue;
      let patch: Partial<TrackMeta>;
      if (isManualTempo(t)) {
        if (t.tempoCheck === "sicher") continue;
        patch = { tempoCheck: "sicher", tempoNote: "Von dir eingetragen" };
      } else {
        const s = sources(t);
        if (s.dbBpm == null && s.measured == null) continue;
        const siblings = all.filter((x) => x.releaseId === t.releaseId && x.id !== t.id && rough.has(x.id)).map((x) => rough.get(x.id)!);
        const r = reconcileTempo({ db: s.dbBpm, dbSource: s.dbSource, measured: s.measured, measuredConf: s.conf, styles: styles.get(t.releaseId) ?? [], siblings });
        patch = { dbBpm: s.dbBpm ?? null, dbSource: s.dbSource, bpm: r.bpm, bpmSource: r.source || undefined, tempoCheck: r.status, tempoNote: r.note };
        if (s.measured !== t.measuredBpm) Object.assign(patch, { measuredBpm: s.measured ?? null, measuredConf: s.conf });
      }
      const diff = Object.entries(patch).some(([k, v]) => JSON.stringify((t as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(v ?? null));
      if (!diff) continue;
      await db.tracks.update(t.id, patch);
      changed++;
    }
  });
  return changed;
}

/** Einmalig nach dem Update: alle vorhandenen Tempi nach den neuen Regeln prüfen (nur lokal, keine Downloads) */
const TEMPO_V = 3;
export async function migrateTempoCheck() {
  if ((await getKV<number>("migration-tempocheck-v", 0)) >= TEMPO_V) return 0;
  const n = await retempo();
  await setKV("migration-tempocheck-v", TEMPO_V);
  return n;
}

/** Tracks mit unsicherem Tempo (für Hinweise und Filter) */
export const unsureTempoCount = async () => (await db.tracks.toArray()).filter((t) => t.tempoCheck === "unsicher").length;
