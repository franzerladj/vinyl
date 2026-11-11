// Plausibilität von Tempo-Angaben aus Datenbanken (Deezer, GetSongBPM). Die liefern oft das halbe oder
// doppelte Tempo (62 statt 124 bei House) oder einen Wert, der zur Platte gar nicht passt.
import { estimateBpm } from "./vibes";
import { parseKey } from "./music";

const dist = (a: number, b: number) => Math.abs(Math.log2(a / b));

export interface BpmCheck {
  bpm: number | null;
  /** Wie korrigiert wurde */
  fixed?: "verdoppelt" | "halbiert";
  /** Abgelehnt, weil es nicht zu den anderen Tracks der Platte passt */
  rejected?: boolean;
}

/**
 * Tempo prüfen: Halb/Doppelt passend zur Platte drehen, offensichtlich falsche Werte verwerfen.
 * siblings: sichere Tempi der anderen Tracks derselben Platte (stärkster Hinweis), styles: Discogs-Styles.
 */
export function checkBpm(bpm: number | null | undefined, ctx: { styles: string[]; siblings: number[] }): BpmCheck {
  if (!bpm || !Number.isFinite(bpm) || bpm < 40 || bpm > 240) return { bpm: null, rejected: Boolean(bpm) };
  const expected = estimateBpm(ctx.styles, ctx.siblings);
  if (!expected) return { bpm: Math.round(bpm * 10) / 10 };
  let best = bpm;
  for (const c of [bpm * 2, bpm / 2]) if (c >= 60 && c <= 200 && dist(c, expected) < dist(best, expected)) best = c;
  // Nur drehen, wenn der Originalwert deutlich daneben liegt und der gedrehte gut passt
  const take = best !== bpm && dist(bpm, expected) > Math.log2(1.25) && dist(best, expected) < Math.log2(1.15) ? best : bpm;
  // Mehrere sichere Tracks derselben Platte, und der Wert liegt trotzdem über 30 % daneben: lieber selbst messen
  if (ctx.siblings.length >= 2 && dist(take, expected) > Math.log2(1.3)) return { bpm: null, rejected: true };
  return { bpm: Math.round(take * 10) / 10, fixed: take === bpm ? undefined : take > bpm ? "verdoppelt" : "halbiert" };
}

/** Tonart nur übernehmen, wenn sie sich lesen lässt (sonst entsteht Unsinn im Camelot-Rad) */
export const checkKey = (key: string | null | undefined) => (key && parseKey(key) ? key : null);
