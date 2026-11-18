// Abgleich in Klartext: was gerade läuft, wie weit es ist, wie lange es noch dauert und wozu.
// Ohne Browser- oder Netz-Abhängigkeiten, damit testbar.

export interface JobLike {
  id: string;
  label: string;
  done: number;
  total: number;
  /** Beginn des Schritts (ms) */
  startedAt?: number;
}

export interface JobText {
  /** Kurz für die schmale Anzeige unten, z. B. „Tracklists“ */
  short: string;
  /** Ganzer Satz, z. B. „Tracklists deiner Platten laden“ */
  title: string;
  /** „120 von 800 Platten“, leer wenn es nichts zu zählen gibt */
  count: string;
  /** „noch etwa 4 Min.“, leer wenn noch keine Schätzung möglich ist */
  eta: string;
  /** Wozu das gut ist */
  why: string;
  /** Anteil 0 bis 1 */
  part: number;
}

/** So viele Anfragen schafft der Hintergrund pro Minute bei Discogs (Grenze von Discogs: 60) */
export const DISCOGS_PER_MIN = 44;
/** Vorrat für den schnellen Start: so viele gehen sofort */
const DISCOGS_BURST = 14;

interface Kind {
  short: string;
  title: (j: JobLike) => string;
  unit: [string, string];
  why: string;
  /** Hängt am Minuten-Limit von Discogs */
  discogs?: boolean;
  /** Anfragen je Eintrag (Preise brauchen bis zu zwei) */
  cost?: number;
}

const name = (j: JobLike, prefix: string) => j.id.slice(prefix.length);

const KINDS: [string, Kind][] = [
  ["collection", { short: "Sammlung", title: () => "Deine Sammlung von Discogs holen", unit: ["Seite", "Seiten"], why: "Neue Platten, Ordner, Zustand und Notizen.", discogs: true }],
  ["wants", { short: "Wantlist", title: () => "Deine Wantlist von Discogs holen", unit: ["Seite", "Seiten"], why: "Was du suchst, samt Notizen.", discogs: true }],
  ["details-collection", { short: "Tracklists", title: () => "Tracklists deiner Platten laden", unit: ["Platte", "Platten"], why: "Tracks, Laufzeiten und Pressung. Je Platte eine Anfrage, Discogs lässt 60 pro Minute zu.", discogs: true }],
  ["details-wants", { short: "Wants", title: () => "Details deiner Wants laden", unit: ["Want", "Wants"], why: "Tracks und Videos zum Reinhören. Je Platte eine Anfrage bei Discogs.", discogs: true }],
  ["stats", { short: "Preise", title: () => "Preise deiner Wants prüfen", unit: ["Want", "Wants"], why: "Günstigstes Angebot und wie viele es gerade gibt.", discogs: true, cost: 1.3 }],
  ["audio", { short: "Tempo", title: () => "Tempo nachschlagen", unit: ["Track", "Tracks"], why: "Aus einer Musik-Datenbank, nicht von Discogs. Läuft nebenher." }],
  ["free-vibes", { short: "Hörproben", title: (j) => j.label, unit: ["Track", "Tracks"], why: "Tempo, Tonart und Energie aus der Hörprobe. Gerechnet wird auf deinem Gerät." }],
  ["friend-", { short: "Freunde", title: (j) => `${j.label} ansehen`, unit: ["Seite", "Seiten"], why: "Für den Feed und eure gemeinsamen Platten.", discogs: true }],
  ["inv-", { short: "Händler", title: (j) => `Angebote bei ${name(j, "inv-")} durchsehen`, unit: ["Seite", "Seiten"], why: "Sucht deine Wants im Laden deines Lieblingshändlers.", discogs: true }],
  ["devsync", { short: "Geräte", title: () => "Mit deinen anderen Geräten abgleichen", unit: ["", ""], why: "Sets, Tempo und Einstellungen von Handy und Computer." }],
  ["folders", { short: "Ordner", title: () => "Ordner an Discogs schicken", unit: ["Platte", "Platten"], why: "Was du einsortiert hast, landet auch bei Discogs.", discogs: true }],
];

const kindOf = (j: JobLike): Kind =>
  KINDS.find(([k]) => (k.endsWith("-") ? j.id.startsWith(k) : j.id === k))?.[1] ?? { short: j.label, title: () => j.label, unit: ["", ""], why: "" };

/** Dauer in Worten: grob, weil die Schätzung grob ist */
export function etaText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 8) return "gleich fertig";
  if (seconds < 50) return `noch etwa ${Math.max(10, Math.round(seconds / 10) * 10)} Sek.`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `noch etwa ${Math.max(1, min)} Min.`;
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  return m ? `noch etwa ${h} Std. ${m} Min.` : `noch etwa ${h} Std.`;
}

const left = (j: JobLike) => Math.max(0, (j.total || 0) - j.done);

/**
 * Restzeit eines Schritts in Sekunden. Für alles, was am Discogs-Limit hängt, zählt nicht das bisherige
 * Tempo (die ersten Anfragen gehen schnell, dann bremst Discogs), sondern was insgesamt noch ansteht:
 * alle Discogs-Schritte teilen sich die Anfragen pro Minute.
 */
export function etaSeconds(j: JobLike, all: JobLike[], now: number, pauseMs = 0): number | null {
  const rest = left(j);
  if (!j.total || rest <= 0) return null;
  const k = kindOf(j);
  const elapsed = j.startedAt ? (now - j.startedAt) / 1000 : 0;
  const observed = j.done >= 2 && elapsed > 2 ? (elapsed / j.done) * rest : null;
  if (!k.discogs) return observed;
  const pending = all.filter((x) => kindOf(x).discogs).reduce((a, x) => a + left(x) * (kindOf(x).cost ?? 1), 0);
  const perSec = DISCOGS_PER_MIN / 60;
  // Gerade Pause (die Minute ist voll): erst warten, dann geht der Rest im Takt von Discogs
  if (pauseMs > 1500) return pauseMs / 1000 + Math.max(3, pending / perSec - 60 + 10);
  // Ein kleiner Vorrat geht sofort, der Rest im gleichmäßigen Takt
  const limited = pending <= DISCOGS_BURST ? 0 : ((pending - DISCOGS_BURST) / DISCOGS_PER_MIN) * 60;
  if (observed == null) return limited > 0 ? limited : null;
  return Math.max(observed, limited);
}

export function jobText(j: JobLike, all: JobLike[] = [j], now = Date.now(), pauseMs = 0): JobText {
  const k = kindOf(j);
  const many = j.total > 1 || j.done > 1;
  const count = many && k.unit[1] ? `${j.done} von ${j.total || "?"} ${k.unit[1]}` : "";
  const s = etaSeconds(j, all, now, pauseMs);
  return {
    short: k.short,
    title: k.title(j),
    count,
    eta: s == null ? "" : etaText(s),
    why: k.why,
    part: j.total ? Math.min(1, Math.max(0, j.done / j.total)) : 0,
  };
}

/** Ein Satz für alles zusammen: wie lange der ganze Abgleich noch braucht */
export function overallEta(all: JobLike[], now = Date.now(), pauseMs = 0): string {
  const secs = all.map((j) => etaSeconds(j, all, now, pauseMs)).filter((s): s is number => s != null);
  return secs.length ? etaText(Math.max(...secs)) : "";
}

/** Pause, weil Discogs für diese Minute genug hat */
export function pauseText(ms: number): string {
  if (ms < 1500) return "";
  return `Discogs lässt 60 Anfragen pro Minute zu. Weiter in ${Math.ceil(ms / 1000)} Sek.`;
}
