// Kisten-Vorlagen: eine gepackte Kiste unter einem Namen merken („Freitag Deep“) und in neue Sets laden.
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV } from "./db";

export interface CrateTemplate {
  name: string;
  ids: number[];
  savedAt: number;
}

const KEY = "crateTemplates";

export const loadTemplates = () => getKV<CrateTemplate[]>(KEY, []);

export function useTemplates(): CrateTemplate[] {
  return useLiveQuery(loadTemplates, [], []);
}

/** Speichert oder überschreibt (gleicher Name, Groß/klein egal) */
export async function saveTemplate(name: string, ids: number[]) {
  const n = name.trim();
  if (!n || !ids.length) return;
  const list = (await loadTemplates()).filter((t) => t.name.toLowerCase() !== n.toLowerCase());
  await setKV(KEY, [{ name: n, ids: [...new Set(ids)], savedAt: Date.now() }, ...list]);
}

export async function deleteTemplate(name: string) {
  await setKV(KEY, (await loadTemplates()).filter((t) => t.name !== name));
}

/** Nur Platten, die noch in der Sammlung sind */
export async function stillOwned(ids: number[]) {
  const have = new Set((await db.collection.toArray()).map((c) => c.releaseId));
  return ids.filter((id) => have.has(id));
}
