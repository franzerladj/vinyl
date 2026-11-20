import type { Release, TrackMeta } from "../../lib/db";

export interface PrintTrack {
  position: string;
  title: string;
  duration?: string;
  meta?: TrackMeta;
}

export interface PrintItem {
  r: Release;
  tracks: PrintTrack[];
  shelf?: string;
  qr?: string;
  /** Eigene Bewertung aus der Discogs-Sammlung (0–5) */
  rating?: number;
  /** Datum, an dem die Platte in die Sammlung kam */
  added?: string;
  /** Zustand nach Goldmine (Platte, Hülle) */
  media?: string;
  sleeve?: string;
  /** Eigene Notiz aus der Sammlung (ohne Marken wie Ordner oder Kaufpreis) */
  note?: string;
}

export interface PrintOpts {
  showBpm: boolean;
  showKey: boolean;
  showCamelot: boolean;
  showEnergy: boolean;
  showStyles: boolean;
  showShelf: boolean;
  showQr: boolean;
  showDuration: boolean;
  showCover: boolean;
  showRating?: boolean;
  showAdded?: boolean;
  /** Akzentfarbe für Energie, Linien und das Farbschema „Akzent“ */
  accent?: string;
  font?: PrintFont;
  /** Eigene Zeile unten, z. B. „Aus der Kiste von DJ Franz“ */
  footer?: string;
  /** Eigene Zeile als schräger Stempel statt als Textzeile */
  stamp?: boolean;
  qrTarget?: "discogs" | "youtube" | "app";
  /** Für Schwarz-Weiß-Drucker: keine Farbflächen, Tonarten im Rahmen statt farbig hinterlegt */
  mono?: boolean;
  /** Was groß oben steht */
  headline?: "artist" | "title";
  /** Dünner Rahmen innen (hilft beim Zuschneiden und wirkt wie ein Etikett) */
  frame?: boolean;
  showCondition?: boolean;
  showNote?: boolean;
}

export type PrintFont = "schmal" | "modern" | "klassisch" | "mono" | "schlicht";

const INTER = "'Inter Variable', 'Inter', -apple-system, system-ui, sans-serif";
const ARCHIVO = "'Archivo Variable', 'Archivo', 'Inter Variable', 'Inter', system-ui, sans-serif";
/**
 * Zahlen, Positionen, Katalognummern: Archivo etwas schmal. Bei 88 % Breite ist ein Zeichen rund 0,6 em breit,
 * damit passen die Spaltenbreiten der Vorlagen (die mit 0,6 em je Zeichen rechnen) weiter. Vorher JetBrains Mono.
 */
export const DATA: React.CSSProperties = { fontFamily: ARCHIVO, fontStretch: "88%", fontVariationSettings: '"wdth" 88', fontVariantNumeric: "tabular-nums" };
/** Stil „Getippt“: Schreibmaschine, wie auf alten Promo-Zetteln und White Labels */
const TYPED = "'Courier Prime', 'Courier New', Courier, monospace";

/**
 * Überschrift- und Textschrift je Stil. cw: Breite eines Zeichens der Überschrift in em (für die Größenberechnung),
 * max: größte Überschrift in mm auf einer A6-Karte, bw: Breite eines Zeichens im Fließtext in em (für die Umbrüche
 * der Tracktitel; die Schreibmaschine ist deutlich breiter als Inter, sonst laufen die Zeilen über).
 */
export const FONTS: Record<PrintFont, { head: string; body: string; stretch: string; wdth: number; weight: number; upper: boolean; label: string; cw: number; max: number; bw: number }> = {
  schmal: { head: ARCHIVO, body: INTER, stretch: "62%", wdth: 62, weight: 900, upper: true, label: "Schmal", cw: 0.47, max: 15, bw: 0.53 },
  modern: { head: ARCHIVO, body: INTER, stretch: "125%", wdth: 125, weight: 900, upper: true, label: "Breit", cw: 1.02, max: 8, bw: 0.53 },
  klassisch: { head: "'Fraunces Variable', Georgia, serif", body: "'Fraunces Variable', Georgia, serif", stretch: "100%", wdth: 100, weight: 700, upper: false, label: "Serif", cw: 0.56, max: 10, bw: 0.53 },
  // Schlüssel bleibt „mono“ (gespeicherte Einstellungen), die Schrift ist jetzt eine Schreibmaschine
  mono: { head: TYPED, body: TYPED, stretch: "100%", wdth: 100, weight: 700, upper: true, label: "Getippt", cw: 0.62, max: 8, bw: 0.63 },
  schlicht: { head: INTER, body: INTER, stretch: "100%", wdth: 100, weight: 800, upper: false, label: "Klar", cw: 0.6, max: 9, bw: 0.53 },
};

/** Schrift-Angaben für eine Überschrift im gewählten Stil */
export const headStyle = (f: PrintFont | undefined): React.CSSProperties => {
  const F = FONTS[f ?? "schmal"] ?? FONTS.schmal;
  return { fontFamily: F.head, fontStretch: F.stretch, fontVariationSettings: F.head === ARCHIVO ? `"wdth" ${F.wdth}` : undefined, fontWeight: F.weight, textTransform: F.upper ? "uppercase" : "none" };
};

export const stars = (n?: number) => (n && n > 0 ? "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n)) : "");

/** Schwarz oder Weiß als Schrift auf einer Hintergrundfarbe */
export function onColor(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#fff";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0b0b0b" : "#ffffff";
}

/** Ein Druckformat: Größe eines Elements und Anordnung auf dem Blatt (alles in mm) */
export interface Layout {
  name: string;
  w: number;
  h: number;
  cols: number;
  rows: number;
  mx: number;
  my: number;
  gx: number;
  gy: number;
  page: string;
  cutMarks?: boolean;
}
