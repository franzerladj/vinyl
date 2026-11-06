// Kaufpreis einer Platte. Discogs gibt Käufe über die Schnittstelle nicht heraus, deshalb trägt man ihn selbst ein.
// Er steht als Marke in der Discogs-Notiz des Exemplars („[Bezahlt: 50 €]“), so ist er auf allen Geräten gleich.
import { parseMoney } from "./value";

const MARK = /\s*\[Bezahlt:\s*([^\]\n]{1,24})\]\s*/;

export function paidOf(note?: string | null): { value: number; currency: string } | null {
  const m = note?.match(MARK);
  return m ? parseMoney(m[1]) : null;
}

/** Notiz ohne die Bezahlt-Marke (für Anzeige) */
export const stripPaid = (note?: string | null) => (note ?? "").replace(MARK, "\n").trim();

export function formatPaid(value: number, currency = "EUR") {
  const n = value.toFixed(2).replace(".", ",").replace(/,00$/, "");
  return currency === "EUR" ? `${n} €` : `${n} ${currency}`;
}

/** Neue Notiz mit gesetztem oder entferntem Kaufpreis, der Rest der Notiz bleibt */
export function withPaid(note: string | null | undefined, value: number | null, currency = "EUR"): string {
  const rest = stripPaid(note);
  if (value == null || !(value > 0)) return rest;
  const mark = `[Bezahlt: ${formatPaid(Math.round(value * 100) / 100, currency)}]`;
  return rest ? `${rest}\n${mark}` : mark;
}

/** Eingabe wie „50“, „49,90“, „49.90 €“ lesen */
export function parsePaidInput(s: string): number | null {
  const t = s.replace(/[€\s]/g, "").replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 && v < 100000 ? v : null;
}
