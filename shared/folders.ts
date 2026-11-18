// Ordner: Sammlung nutzt die echten Discogs-Ordner. Die Wantlist hat bei Discogs keine Ordner,
// deshalb steht der Ordner als kurze Marke in der Notiz des Wants („[Ordner: Metal]“).
// So bleibt die Zuordnung auf allen Geräten gleich und ist auch bei Discogs lesbar.

export interface Folder {
  id: number;
  name: string;
  count: number;
}

/** Discogs-Ordner 0 = alle, 1 = ohne Ordner. Beide lassen sich nicht umbenennen oder löschen. */
export const ALL_FOLDER = 0;
export const NO_FOLDER = 1;

// Eine Platte kann in mehreren Ordnern liegen. Bei Discogs hat ein Exemplar aber genau einen Ordner.
// Deshalb: der erste Ordner ist der echte Discogs-Ordner, jeder weitere steht als Marke in der Notiz des
// Exemplars („[Ordner: Auflegen] [Ordner: Sommer]“). Wants haben nur Marken. So gilt alles auf jedem Gerät.
const MARKS = /\s*\[Ordner:\s*([^\]\n]{1,40})\]/g;

/** Alle Ordner-Marken einer Notiz, in ihrer Reihenfolge, jede nur einmal */
export function noteFolders(notes?: string | null): string[] {
  const out: string[] = [];
  for (const m of (notes ?? "").matchAll(MARKS)) {
    const n = cleanFolderName(m[1]);
    if (n && !out.some((x) => sameFolder(x, n))) out.push(n);
  }
  return out;
}

/** Erster Ordner eines Wants (für Stellen, die nur einen zeigen) */
export const wantFolderOf = (notes?: string | null): string | null => noteFolders(notes)[0] ?? null;

/** Notiz ohne die Ordner-Marken (für Anzeige und Export) */
export const stripFolder = (notes?: string | null) => (notes ?? "").replace(MARKS, "").trim();

/** Neue Notiz mit genau diesen Ordner-Marken, der Rest der Notiz bleibt */
export function withFolders(notes: string | null | undefined, folders: string[]): string {
  const rest = stripFolder(notes);
  const names: string[] = [];
  for (const f of folders) {
    const n = cleanFolderName(f);
    if (n && !names.some((x) => sameFolder(x, n))) names.push(n);
  }
  if (!names.length) return rest;
  const marks = names.map((n) => `[Ordner: ${n}]`).join(" ");
  return rest ? `${rest}\n${marks}` : marks;
}

/** Neue Notiz mit einem einzigen Ordner (oder keinem) */
export const withWantFolder = (notes: string | null | undefined, folder: string | null): string => withFolders(notes, folder ? [folder] : []);

/** Ordner eines Exemplars: der echte Discogs-Ordner und die weiteren aus der Notiz */
export interface Filed {
  primary: string | null;
  extra: string[];
}

/** Alle Ordner eines Exemplars, der echte Discogs-Ordner zuerst */
export const filedNames = (f: Filed): string[] => (f.primary ? [f.primary, ...f.extra.filter((x) => !sameFolder(x, f.primary))] : f.extra);

/** Stand eines Exemplars aus Discogs-Ordner (Name, null = ohne) und Notiz */
export const filedOf = (primary: string | null, note?: string | null): Filed => ({ primary, extra: noteFolders(note).filter((x) => !sameFolder(x, primary)) });

/** In einen Ordner legen: ohne Ordner wird es der echte Discogs-Ordner, sonst kommt er dazu */
export function addFolder(f: Filed, raw: string): Filed {
  const name = cleanFolderName(raw);
  if (!name || filedNames(f).some((x) => sameFolder(x, name))) return f;
  return f.primary ? { primary: f.primary, extra: [...f.extra, name] } : { primary: name, extra: f.extra };
}

/** Aus einem Ordner nehmen: war es der echte Discogs-Ordner, rückt der nächste nach */
export function removeFolder(f: Filed, name: string): Filed {
  if (sameFolder(f.primary, name)) return { primary: f.extra[0] ?? null, extra: f.extra.slice(1) };
  return { primary: f.primary, extra: f.extra.filter((x) => !sameFolder(x, name)) };
}

/** Ordner umbenennen */
export const renameIn = (f: Filed, from: string, to: string): Filed => ({ primary: sameFolder(f.primary, from) ? to : f.primary, extra: f.extra.map((x) => (sameFolder(x, from) ? to : x)) });

/** Ordnername ohne eckige Klammern und Zeilenumbrüche, höchstens 40 Zeichen */
export const cleanFolderName = (s: string) => s.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

/** Eigene Ordner (ohne „Alle“ und „Ohne Ordner“), alphabetisch */
export const customFolders = (folders: Folder[]) => folders.filter((f) => f.id > NO_FOLDER).sort((a, b) => a.name.localeCompare(b.name, "de"));

/** Gleicher Ordnername, egal ob groß oder klein geschrieben */
export const sameFolder = (a?: string | null, b?: string | null) => Boolean(a && b && a.trim().toLocaleLowerCase("de") === b.trim().toLocaleLowerCase("de"));
