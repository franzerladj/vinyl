// Nadel-Stunden aus Sets und eigenen Einträgen, Stand im KV „stylus“
import { db, getKV, setKV } from "./db";
import { durationSeconds, stylusMinutes, stylusWear, type StylusState } from "../../../shared/stylus";

export const today = () => new Date().toISOString().slice(0, 10);

export async function getStylus(): Promise<StylusState | null> {
  return getKV<StylusState | null>("stylus", null);
}

export const saveStylus = (s: StylusState) => setKV("stylus", s);

export async function computeStylus() {
  const state = await getStylus();
  if (!state) return null;
  const sets = await db.sets.toArray();
  const ids = [...new Set(sets.flatMap((s) => [...s.trackIds, ...(s.played ?? [])]))];
  const tracks = (await db.tracks.bulkGet(ids)).filter(Boolean);
  const rels = new Map((await db.releases.bulkGet([...new Set(tracks.map((t) => t!.releaseId))])).filter(Boolean).map((r) => [r!.id, r!]));
  const secs = new Map<string, number | null>();
  for (const t of tracks) secs.set(t!.id, durationSeconds(rels.get(t!.releaseId)?.tracklist?.find((x) => x.position === t!.position)?.duration));
  const minutes = stylusMinutes(state, sets, (id) => secs.get(id) ?? null);
  return { state, minutes, wear: stylusWear(minutes, state.lifeHours) };
}

export const hoursText = (min: number) => (min < 60 ? `${min} Min.` : `${(min / 60).toFixed(min < 600 ? 1 : 0).replace(".", ",")} Std.`);
