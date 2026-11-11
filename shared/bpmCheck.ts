// Tempo verlässlich machen. Datenbanken (Deezer, GetSongBPM) und die eigene Messung irren typischerweise
// um den Faktor 2 (184 statt 92 bei Funk, 62 statt 124 bei House), seltener um 3/4 oder 4/3.
// Grundlage hier: der typische Tempo-Bereich der Styles einer Platte, die anderen Tracks der Platte
// und der Vergleich zweier unabhängiger Quellen (Datenbank und Messung der Hörprobe).
import { estimateBpm } from "./vibes";
import { parseKey } from "./music";

/** Typischer Tempo-Bereich je Discogs-Style (bewusst großzügig) */
export const STYLE_RANGE: Record<string, [number, number]> = {
  ambient: [60, 125], downtempo: [70, 112], "trip hop": [68, 105], balearic: [90, 126], "dub techno": [112, 132],
  soul: [62, 128], funk: [78, 126], "acid jazz": [80, 126], "jazz-funk": [80, 128], boogie: [98, 126], "p.funk": [85, 125],
  disco: [100, 136], "nu-disco": [100, 126], "italo-disco": [108, 132], "hi nrg": [118, 140],
  "deep house": [110, 128], house: [112, 132], "chicago house": [114, 132], "garage house": [112, 130], "afro house": [112, 128],
  "tech house": [118, 132], "progressive house": [116, 132], "acid house": [114, 134], "lo-fi house": [105, 128], "soulful house": [115, 128],
  "uk garage": [125, 142], "speed garage": [128, 140], "2-step": [128, 140], electro: [105, 140], breakbeat: [110, 145], breaks: [110, 145],
  "minimal techno": [118, 136], minimal: [116, 134], "detroit techno": [118, 142], techno: [118, 155], acid: [115, 150],
  trance: [124, 148], "progressive trance": [124, 140], ebm: [100, 140], "hard techno": [135, 170], gabber: [150, 200], hardcore: [150, 200],
  dubstep: [135, 145], "drum n bass": [160, 182], jungle: [150, 180], "hip hop": [68, 112], "boom bap": [78, 100], "trap": [130, 160],
  "synth-pop": [95, 140], "new wave": [100, 160], leftfield: [80, 140], "rhythm & blues": [60, 120], "contemporary r&b": [60, 115],
  "broken beat": [95, 132], "future jazz": [85, 130], "nu jazz": [85, 135], "latin jazz": [80, 140], afrobeat: [95, 130],
};

/** Bereich aus den Styles einer Platte (Vereinigung), null wenn kein Style bekannt ist */
export function styleRange(styles: string[]): [number, number] | null {
  const r = styles.map((s) => STYLE_RANGE[s.toLowerCase()]).filter(Boolean);
  if (!r.length) return null;
  return [Math.min(...r.map((x) => x[0])), Math.max(...r.map((x) => x[1]))];
}

/** Mitte des Bereichs (geometrisch), als Erwartung für die Messung */
export function rangeCenter(styles: string[]): number | null {
  const r = styleRange(styles);
  return r ? Math.round(Math.sqrt(r[0] * r[1])) : null;
}

const dist = (a: number, b: number) => Math.abs(Math.log2(a / b));
const round1 = (v: number) => Math.round(v * 10) / 10;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface BpmCheck {
  bpm: number | null;
  /** Wie umgerechnet wurde */
  fixed?: "verdoppelt" | "halbiert";
  /** Passt nicht zum Style-Bereich bzw. zu den anderen Tracks */
  unsure?: boolean;
  /** Ungültig (0, über 240 …) */
  rejected?: boolean;
}

/**
 * Ein Tempo prüfen: in den Bereich der Styles drehen (×2, ÷2), sonst an den anderen Tracks der Platte
 * ausrichten. Was weder passt noch sich passend drehen lässt, gilt als unsicher.
 */
export function checkBpm(bpm: number | null | undefined, ctx: { styles: string[]; siblings: number[] }): BpmCheck {
  if (!bpm || !Number.isFinite(bpm) || bpm < 40 || bpm > 240) return { bpm: null, rejected: Boolean(bpm) };
  const range = styleRange(ctx.styles);
  const cands = [bpm, bpm * 2, bpm / 2].filter((c) => c >= 55 && c <= 210);
  let take = bpm;
  let unsure = false;
  if (range) {
    const inR = (c: number) => c >= range[0] && c <= range[1];
    // Knapp daneben (bis 12 %) ist kein Faktor-2-Fehler: stehen lassen, aber als unsicher markieren
    const near = bpm >= range[0] / 1.12 && bpm <= range[1] * 1.12;
    if (!inR(bpm)) {
      const center = Math.sqrt(range[0] * range[1]);
      const fits = cands.filter((c) => c !== bpm && inR(c)).sort((a, b) => dist(a, center) - dist(b, center));
      if (!near && fits.length) take = fits[0];
      else unsure = true;
    }
  } else {
    const expected = estimateBpm([], ctx.siblings);
    if (expected) {
      let best = bpm;
      for (const c of cands) if (dist(c, expected) < dist(best, expected)) best = c;
      if (best !== bpm && dist(bpm, expected) > Math.log2(1.25) && dist(best, expected) < Math.log2(1.15)) take = best;
    }
  }
  // Mehrere Tracks derselben Platte, und dieser liegt weit daneben: verdächtig (kann aber stimmen, z. B. Bonus-Track)
  // Nur wenn die anderen Tracks untereinander einig sind (EP/Maxi), bei Alben streut das Tempo zu sehr
  const sib = ctx.siblings;
  if (sib.length >= 2 && Math.max(...sib) / Math.min(...sib) <= 1.1 && dist(take, median(sib)) > Math.log2(1.25)) unsure = true;
  return { bpm: round1(take), ...(take !== bpm ? { fixed: take > bpm ? ("verdoppelt" as const) : ("halbiert" as const) } : {}), ...(unsure ? { unsure } : {}) };
}

export type TempoStatus = "sicher" | "einfach" | "unsicher";

export interface TempoResult {
  bpm: number | null;
  status: TempoStatus;
  /** Kurze Erklärung für die Platten-Seite */
  note: string;
  /** Kurzform der Quelle für die Anzeige */
  source: string;
}

/**
 * Datenbank-Wert und eigene Messung zusammenführen.
 * - Beide passen (auch nach ×2/÷2): sicher.
 * - Nur eine Quelle, plausibel: einfach (benutzbar, aber nicht gegengeprüft).
 * - Widerspruch oder unplausibel: unsicher, bester Kandidat wird trotzdem eingetragen.
 */
export function reconcileTempo(i: { db?: number | null; dbSource?: string; measured?: number | null; measuredConf?: number | null; styles: string[]; siblings: number[] }): TempoResult {
  const src = (i.dbSource || "Datenbank").replace(/\s*\((Album|verdoppelt|halbiert)[^)]*\)/g, "").trim() || "Datenbank";
  const d = i.db ? checkBpm(i.db, i) : null;
  const conf = i.measuredConf ?? 0;
  const m = i.measured && conf >= 0.2 ? checkBpm(i.measured, i) : null;
  if (d?.bpm && m?.bpm) {
    if (dist(d.bpm, m.bpm) < Math.log2(1.04)) {
      return { bpm: d.bpm, status: "sicher", note: `${src} und eigene Messung stimmen überein${d.fixed ? ` (${src} hatte das ${d.fixed === "verdoppelt" ? "halbe" : "doppelte"} Tempo)` : ""}`, source: `${src} + Messung` };
    }
    // Widerspruch: den Kandidaten nehmen, der in den Bereich passt; sonst die sichere Messung
    const pick = d.unsure && !m.unsure ? m : !d.unsure && m.unsure ? d : conf >= 0.5 ? m : d;
    return { bpm: pick.bpm, status: "unsicher", note: `${src} sagt ${i.db}, die Messung ${round1(i.measured!)}. Bitte kurz gegenhören.`, source: pick === m ? "Messung" : src };
  }
  const one = d?.bpm ? d : m?.bpm ? m : null;
  if (!one) return { bpm: null, status: "unsicher", note: "Kein brauchbarer Wert gefunden", source: "" };
  const isM = one === m;
  const weak = isM && conf < 0.5;
  const status: TempoStatus = one.unsure || weak ? "unsicher" : "einfach";
  const why = one.unsure ? "passt nicht recht zu den Styles oder den anderen Tracks" : weak ? "die Messung ist sich nicht sicher" : one.fixed ? `${one.fixed} passend zum Style` : "noch nicht gegengeprüft";
  return { bpm: one.bpm, status, note: `Nur ${isM ? "eigene Messung" : src}: ${why}`, source: isM ? "Messung" : one.fixed ? `${src} (${one.fixed})` : src };
}

/** Tonart nur übernehmen, wenn sie sich lesen lässt (sonst entsteht Unsinn im Camelot-Rad) */
export const checkKey = (key: string | null | undefined) => (key && parseKey(key) ? key : null);
