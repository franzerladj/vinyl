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

const MARK = /\s*\[Ordner:\s*([^\]\n]{1,40})\]\s*$/;

export const wantFolderOf = (notes?: string | null): string | null => notes?.match(MARK)?.[1].trim() || null;

/** Notiz ohne die Ordner-Marke (für Anzeige und Export) */
export const stripFolder = (notes?: string | null) => (notes ?? "").replace(MARK, "").trim();

/** Neue Notiz mit gesetzter oder entfernter Ordner-Marke, der Rest der Notiz bleibt */
export function withWantFolder(notes: string | null | undefined, folder: string | null): string {
  const rest = stripFolder(notes);
  const name = cleanFolderName(folder ?? "");
  if (!name) return rest;
  return rest ? `${rest}\n[Ordner: ${name}]` : `[Ordner: ${name}]`;
}

/** Ordnername ohne eckige Klammern und Zeilenumbrüche, höchstens 40 Zeichen */
export const cleanFolderName = (s: string) => s.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

/** Eigene Ordner (ohne „Alle“ und „Ohne Ordner“), alphabetisch */
export const customFolders = (folders: Folder[]) => folders.filter((f) => f.id > NO_FOLDER).sort((a, b) => a.name.localeCompare(b.name, "de"));

/** Gleicher Ordnername, egal ob groß oder klein geschrieben */
export const sameFolder = (a?: string | null, b?: string | null) => Boolean(a && b && a.trim().toLocaleLowerCase("de") === b.trim().toLocaleLowerCase("de"));
