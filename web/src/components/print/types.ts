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
  qrTarget?: "discogs" | "youtube" | "app";
}

export type PrintFont = "modern" | "klassisch" | "mono" | "schlicht";

/** Überschrift- und Textschrift je Stil */
export const FONTS: Record<PrintFont, { head: string; body: string; stretch: string; weight: number; upper: boolean; label: string }> = {
  modern: { head: "'Archivo Variable', 'Archivo', 'Inter Variable', 'Inter', system-ui, sans-serif", body: "'Inter Variable', 'Inter', -apple-system, system-ui, sans-serif", stretch: "125%", weight: 900, upper: true, label: "Modern" },
  klassisch: { head: "'Fraunces Variable', Georgia, serif", body: "'Fraunces Variable', Georgia, serif", stretch: "100%", weight: 700, upper: false, label: "Klassisch" },
  mono: { head: "'JetBrains Mono Variable', ui-monospace, monospace", body: "'JetBrains Mono Variable', ui-monospace, monospace", stretch: "100%", weight: 800, upper: true, label: "Mono" },
  schlicht: { head: "'Inter Variable', 'Inter', -apple-system, system-ui, sans-serif", body: "'Inter Variable', 'Inter', -apple-system, system-ui, sans-serif", stretch: "100%", weight: 800, upper: false, label: "Schlicht" },
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
