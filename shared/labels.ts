// Label-Vollständigkeit: welche Vinyl-Releases eines Labels hast du, welche fehlen?
// Eine Katalognummer zählt als eine Platte, egal welche Pressung man davon hat.

export interface LabelRelease {
  id: number;
  title: string;
  artist: string;
  catno: string;
  year?: number;
  format?: string;
  thumb?: string;
}

export interface LabelEntry {
  catno: string;
  /** Erstes Release dieser Katalognummer (für Link und Wantlist) */
  main: LabelRelease;
  ids: number[];
  have: boolean;
  wanted: boolean;
}

const VINYL = /\b(vinyl|lp|12"|10"|7"|lathe|flexi)\b|12"|10"|7"/i;
export const isVinyl = (format?: string) => !format || VINYL.test(format);

/** Katalognummern ohne Leerzeichen, Punkte und Bindestriche vergleichen */
export const normCatno = (c: string) => c.toUpperCase().replace(/[\s.\-_/]+/g, "");

export function labelCompletion(releases: LabelRelease[], owned: Set<number>, wanted: Set<number>, ownedCatnos: Set<string> = new Set()) {
  const byCat = new Map<string, LabelEntry>();
  for (const r of releases) {
    if (!isVinyl(r.format)) continue;
    const cat = normCatno(r.catno || "");
    // Ohne Katalognummer (none) zählt jedes Release einzeln
    const key = cat && cat !== "NONE" ? cat : `id:${r.id}`;
    const e = byCat.get(key) ?? { catno: r.catno, main: r, ids: [], have: false, wanted: false };
    e.ids.push(r.id);
    if (owned.has(r.id) || (cat && ownedCatnos.has(cat))) e.have = true;
    if (wanted.has(r.id)) e.wanted = true;
    if ((r.year ?? 9999) < (e.main.year ?? 9999)) e.main = r;
    byCat.set(key, e);
  }
  const entries = [...byCat.values()].sort((a, b) => a.catno.localeCompare(b.catno, "de", { numeric: true }));
  const have = entries.filter((e) => e.have).length;
  return { entries, have, total: entries.length, missing: entries.filter((e) => !e.have) };
}
