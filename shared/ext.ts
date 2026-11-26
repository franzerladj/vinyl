// Chrome-Erweiterung (Ordner extension/): feste Kennung und die Sicht auf eine Platte, wie Crate sie kennt.
// Die Kennung folgt aus dem öffentlichen Schlüssel im Manifest (`key`), deshalb ist sie auf jedem Rechner gleich.
// Der private Schlüssel liegt nicht im Repo; er wird nur gebraucht, um eine .crx-Datei zu packen.

/** Version der Erweiterung, die zum Laden bereitliegt (gleich wie in extension/manifest.json) */
export const EXT_VERSION = "1.1.0";
export const EXT_ID = "pkfioajlonlljfhjjlpopdbjnnanepoe";
/** Von hier darf die Erweiterung schreibend anfragen (sonst lehnt der Server fremde Seiten ab) */
export const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;
/** Öffentlicher Schlüssel für das Manifest */
export const EXT_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3re/6gFD4npFUUo/IMtIPqIXw4/r/ni7AxUb0lp10qt13HZNqaVXjOYakWtoJ85Hky/OF69SLcxgGGIn9T3U2vVT+0v0TgILJmMUSnMZSSnPUCKkn6Wvf9yqDPVTQIz8GKa2fTcqUt6IaUGzPXFuw8x/L15PkNTTlxZvD8SCsgWuClEwafNkIpj/jLP9Vt695vZZquvTce6bs59TCqfwh40MP2SYZ+vD/VUpMWRJq1VQlNlalvnbnqtbQRbtYTxIpMupiPNzWe6adCV0aA7ar3zmGDpq6zj0wkGO2LimzVa/53P+D6kP1zbuLwRE50nObnAn9p+uVoq59/gmWtG05wIDAQAB";

export interface ExtTrack {
  position: string;
  title: string;
  bpm?: number | null;
  key?: string | null;
  energy?: number | null;
}
export interface ExtRelease {
  /** Ist der Abgleich „Handy und Computer“ an? Ohne ihn kennt der Server Tempo, Tonart und Sets nicht. */
  sync: boolean;
  tracks: ExtTrack[];
  sets: { name: string; date?: string; venue?: string; played: boolean }[];
  shelf?: string;
  lentTo?: string;
}

type Row = { k: string; v: Record<string, unknown> | null };
const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : undefined);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Aus den abgeglichenen Zeilen (Tracks dieser Platte, alle Sets, Angaben zur Platte) die Antwort für die Erweiterung bauen */
export function extRelease(releaseId: number, rows: { tracks: Row[]; sets: Row[]; meta: Row | null; any: boolean }): ExtRelease {
  const prefix = `${releaseId}:`;
  const tracks = rows.tracks
    .filter((r) => r.v && r.k.startsWith(prefix))
    .map((r) => ({ position: str(r.v!.position, 12) ?? r.k.slice(prefix.length), title: str(r.v!.title, 200) ?? "", bpm: numOrNull(r.v!.bpm), key: str(r.v!.key, 12) ?? null, energy: numOrNull(r.v!.energy) }))
    .filter((t) => t.title)
    .sort((a, b) => a.position.localeCompare(b.position, "de", { numeric: true }));
  const ids = new Set(rows.tracks.filter((r) => r.v).map((r) => r.k));
  const has = (list: unknown) => Array.isArray(list) && list.some((x) => typeof x === "string" && ids.has(x));
  const sets = rows.sets
    .filter((r) => r.v && (has(r.v.trackIds) || has(r.v.crateIds) || has(r.v.played)))
    .map((r) => ({ name: str(r.v!.name, 80) ?? "Set", date: str(r.v!.date, 10), venue: str(r.v!.venue, 80), played: has(r.v!.played) }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 8);
  return { sync: rows.any, tracks, sets, shelf: str(rows.meta?.v?.shelf, 40), lentTo: str(rows.meta?.v?.lentTo, 60) };
}
