// Wert der Sammlung: Gesamtwert direkt von Discogs (aus echten Verkäufen),
// Einzelwerte aus Preisempfehlung je Zustand oder dem günstigsten Angebot.
import { discogs } from "./api";
import { db, getKV, setKV } from "./db";
import { username } from "./store";
import { parseMoney, recordValue, type RecordValue } from "../../../shared/value";
import { shortGrade } from "../../../shared/vinyl";

export interface CollectionValue {
  min: number;
  median: number;
  max: number;
  currency: string;
  at: number;
}

const KEY = "collValue";

export const cachedCollectionValue = () => getKV<CollectionValue | null>(KEY, null);

/** Gesamtwert bei Discogs abfragen (eine Anfrage), höchstens alle 12 Stunden */
export async function refreshCollectionValue(force = false): Promise<CollectionValue | null> {
  const old = await cachedCollectionValue();
  if (!force && old && Date.now() - old.at < 12 * 3600_000) return old;
  const r = await discogs<{ minimum: string; median: string; maximum: string }>(`/users/${encodeURIComponent(username())}/collection/value`, { background: true });
  const med = parseMoney(r.median);
  if (!med) return old;
  const v: CollectionValue = { min: parseMoney(r.minimum)?.value ?? 0, median: med.value, max: parseMoney(r.maximum)?.value ?? 0, currency: med.currency, at: Date.now() };
  await setKV(KEY, v);
  return v;
}

/** Einzelwerte aller Platten der Sammlung aus dem, was schon geladen ist */
export async function recordValues(): Promise<Map<number, RecordValue & { currency: string }>> {
  const coll = await db.collection.toArray();
  const ids = [...new Set(coll.map((c) => c.releaseId))];
  const [stats, suggs] = await Promise.all([db.marketStats.bulkGet(ids), db.priceSuggestions.bulkGet(ids)]);
  // Bei mehreren Exemplaren zählt das beste
  const grade = new Map<number, string | undefined>();
  for (const c of coll) {
    const g = shortGrade(c.media) ?? undefined;
    if (!grade.has(c.releaseId) || g) grade.set(c.releaseId, g);
  }
  const out = new Map<number, RecordValue & { currency: string }>();
  ids.forEach((id, i) => {
    const v = recordValue({ grade: grade.get(id), suggestions: suggs[i]?.values, lowest: stats[i]?.lowest });
    if (v) out.set(id, { ...v, currency: (v.basis === "lowest" ? stats[i]?.currency : suggs[i]?.currency) ?? "EUR" });
  });
  return out;
}
