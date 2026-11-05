// Wert der Sammlung: Discogs-Gesamtwert lesen und Einzelwerte je Platte schätzen.

const SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY", "A$": "AUD", "CA$": "CAD", "CHF": "CHF", "SEK": "SEK", "R$": "BRL", "MX$": "MXN", "NZ$": "NZD", "ZAR": "ZAR", "DKK": "DKK" };

/**
 * Geldbetrag aus Discogs-Text lesen, z. B. „€1,234.56“, „$12.00“, „CA$5.10“ oder „1.234,56 €“.
 * Gibt Betrag und Währung (ISO) zurück, sonst null.
 */
export function parseMoney(raw: string | null | undefined, fallback = "EUR"): { value: number; currency: string } | null {
  if (!raw) return null;
  const s = raw.trim();
  const num = s.match(/[\d.,\s ]*\d/)?.[0]?.replace(/[\s ]/g, "");
  if (!num) return null;
  const sym = s.replace(/[\d.,\s -]/g, "");
  const currency = SYMBOLS[sym] ?? (/^[A-Z]{3}$/.test(sym) ? sym : fallback);
  // Letztes Trennzeichen mit 1–2 Ziffern dahinter ist das Dezimalzeichen
  const dec = num.match(/[.,](\d{1,2})$/);
  const int = (dec ? num.slice(0, -dec[0].length) : num).replace(/[.,]/g, "");
  const value = Number(`${int}${dec ? `.${dec[1]}` : ""}`);
  return Number.isFinite(value) ? { value, currency } : null;
}

export interface RecordValue {
  value: number;
  /** Wie der Wert zustande kam */
  basis: "grade" | "vgplus" | "lowest";
}

const GRADE_ORDER = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"];

/**
 * Wert einer Platte: Discogs-Preisempfehlung für den eigenen Zustand der Platte,
 * ohne Zustand die Empfehlung für VG+, ohne Empfehlungen das günstigste Angebot.
 */
export function recordValue(opts: { grade?: string | null; suggestions?: Record<string, number> | null; lowest?: number | null }): RecordValue | null {
  const s = opts.suggestions ?? {};
  if (opts.grade && GRADE_ORDER.includes(opts.grade) && s[opts.grade]) return { value: s[opts.grade], basis: "grade" };
  if (s["VG+"]) return { value: s["VG+"], basis: "vgplus" };
  if (opts.lowest && opts.lowest > 0) return { value: opts.lowest, basis: "lowest" };
  return null;
}

/** Ungefähr, ohne Scheingenauigkeit: unter 100 auf 1, unter 1000 auf 10, darüber auf 50 gerundet */
export function roughly(v: number): number {
  if (v < 100) return Math.round(v);
  if (v < 1000) return Math.round(v / 10) * 10;
  return Math.round(v / 50) * 50;
}
