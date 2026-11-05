// Set-Verlauf: wann und wo ein Track schon gespielt wurde.
// Gezählt wird, was im Live-Modus als gespielt markiert ist; vergangene Sets ohne Markierung zählen komplett.
import type { DJSet } from "./db";

export interface PlayedAt {
  setId?: number;
  name: string;
  date: string;
  venue?: string;
}

export function playedHistory(sets: DJSet[], excludeId?: number): Map<string, PlayedAt[]> {
  const today = new Date().toISOString().slice(0, 10);
  const m = new Map<string, PlayedAt[]>();
  for (const s of sets) {
    if (s.id === excludeId || !s.date) continue;
    const ids = s.played?.length ? s.played : s.date < today ? s.trackIds : [];
    for (const id of ids) m.set(id, [...(m.get(id) ?? []), { setId: s.id, name: s.name, date: s.date, venue: s.venue }]);
  }
  for (const list of m.values()) list.sort((a, b) => b.date.localeCompare(a.date));
  return m;
}

/** „vor 3 Wochen im Glashaus“ */
export function playedText(p: PlayedAt, now = new Date()): string {
  const days = Math.round((now.getTime() - new Date(p.date).getTime()) / 86_400_000);
  const when = days <= 0 ? "heute" : days === 1 ? "gestern" : days < 14 ? `vor ${days} Tagen` : days < 70 ? `vor ${Math.round(days / 7)} Wochen` : `vor ${Math.round(days / 30)} Monaten`;
  return `${when}${p.venue ? ` im ${p.venue}` : p.name ? ` (${p.name})` : ""}`;
}
