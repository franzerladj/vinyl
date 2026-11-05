// Repress-Alarm: neue Vinyl-Pressungen einer Platte von der Wantlist erkennen.

export interface Version {
  id: number;
  title?: string;
  format?: string;
  label?: string;
  catno?: string;
  country?: string;
  released?: string;
}

const VINYL = /vinyl|\blp\b|12"|10"|7"/i;
const yearOf = (v: Version) => Number(String(v.released ?? "").slice(0, 4)) || 0;

/**
 * Neue Pressungen seit dem letzten Blick. Beim ersten Blick (known = null) zählen nur Pressungen
 * aus diesem oder dem letzten Jahr, sonst wäre jede alte Nachpressung ein Alarm.
 */
export function newPressings(versions: Version[], known: Set<number> | null, wantId: number, year = new Date().getFullYear()): Version[] {
  return versions
    .filter((v) => v.id !== wantId && (!v.format || VINYL.test(v.format)))
    .filter((v) => (known ? !known.has(v.id) && (yearOf(v) === 0 || yearOf(v) >= year - 1) : yearOf(v) >= year - 1))
    .sort((a, b) => yearOf(b) - yearOf(a));
}
