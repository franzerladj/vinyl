// Nadel-Stunden: wie lange die Nadel seit dem letzten Wechsel gelaufen ist.
// Gezählt werden gespielte Sets (Länge aus den Track-Laufzeiten) plus eigene Einträge, z. B. Sessions zu Hause.

export interface StylusState {
  /** Tag des Einbaus, YYYY-MM-DD */
  since: string;
  /** Lebensdauer laut Hersteller in Stunden (freiwillig) */
  lifeHours?: number;
  /** Eigene Einträge in Minuten */
  extraMinutes: number;
}

export interface SetForStylus {
  date?: string;
  trackIds: string[];
  played?: string[];
}

/** Laufzeit „6:23“ oder „1:02:10“ in Sekunden */
export function durationSeconds(d?: string | null): number | null {
  if (!d) return null;
  const p = d.split(":").map(Number);
  if (p.some((x) => !Number.isFinite(x))) return null;
  return p.reduce((a, b) => a * 60 + b, 0) || null;
}

const DEFAULT_TRACK_SEC = 6 * 60;

export function stylusMinutes(state: StylusState, sets: SetForStylus[], trackSeconds: (id: string) => number | null, today = new Date().toISOString().slice(0, 10)): number {
  let sec = 0;
  for (const s of sets) {
    if (!s.date || s.date < state.since || s.date > today) continue;
    // Live-Modus-Markierungen zählen, sonst das ganze vergangene Set
    const ids = s.played?.length ? s.played : s.date < today ? s.trackIds : [];
    for (const id of ids) sec += trackSeconds(id) ?? DEFAULT_TRACK_SEC;
  }
  return Math.round(sec / 60) + (state.extraMinutes || 0);
}

/** 0..1 der Lebensdauer, null ohne Herstellerangabe */
export const stylusWear = (minutes: number, lifeHours?: number) => (lifeHours && lifeHours > 0 ? Math.min(1, minutes / 60 / lifeHours) : null);
