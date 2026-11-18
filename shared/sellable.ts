// „Was könnte weg?“: Platten, die Geld binden und nicht aufgelegt werden.
// Kandidat ist, was in keinem Set lief (weder geplant noch gespielt), schon eine Weile in der Sammlung
// steht, nicht hoch bewertet ist und einen Marktwert hat. Sortiert nach Wert.
// Nur ein Hinweis: ob eine Platte bleibt, entscheidet man selbst. Ohne Browser- oder Netz-Abhängigkeiten.

export interface SellInput {
  id: number;
  /** Marktwert, null wenn unbekannt */
  value: number | null;
  /** Eigener Kaufpreis, wenn eingetragen */
  paid?: number | null;
  /** Eigene Bewertung 0..5 */
  rating?: number;
  /** In der Sammlung seit (ISO) */
  dateAdded: string;
  /** In wie vielen Sets die Platte steht (Reihenfolge oder Kiste) */
  sets: number;
  /** Verliehen: steht gerade nicht im Regal */
  lent?: boolean;
}

export interface SellCandidate {
  id: number;
  value: number;
  /** Gewinn gegenüber dem Kaufpreis, wenn bekannt */
  gain: number | null;
  /** Monate in der Sammlung */
  months: number;
}

export interface SellOptions {
  /** So lange muss eine Platte mindestens da sein (neue hat man noch nicht aufgelegt) */
  minMonths?: number;
  /** Ab diesem Wert lohnt der Verkauf den Aufwand */
  minValue?: number;
  limit?: number;
}

export function sellCandidates(items: SellInput[], today: string, opts: SellOptions = {}): SellCandidate[] {
  const minMonths = opts.minMonths ?? 6;
  const minValue = opts.minValue ?? 15;
  const now = Date.parse(today);
  const out: SellCandidate[] = [];
  for (const r of items) {
    if (r.value == null || r.value < minValue) continue;
    if (r.sets > 0 || r.lent) continue;
    // Vier und fünf Sterne behält man, auch wenn sie nie im Set landen
    if ((r.rating ?? 0) >= 4) continue;
    const added = Date.parse(r.dateAdded);
    const months = Number.isFinite(added) ? Math.floor((now - added) / (30.44 * 864e5)) : 0;
    if (months < minMonths) continue;
    out.push({ id: r.id, value: r.value, gain: r.paid != null ? Math.round((r.value - r.paid) * 100) / 100 : null, months });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, opts.limit ?? 12);
}

/** „seit 3 Jahren“, „seit 8 Monaten“ */
export function sinceText(months: number): string {
  if (months >= 24) return `seit ${Math.floor(months / 12)} Jahren`;
  if (months >= 12) return "seit über einem Jahr";
  return `seit ${months} Monaten`;
}
