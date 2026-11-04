// Digging-Feed: Gewichte lernen und Quellen mischen. Ohne Browser- oder Netz-Abhängigkeiten, damit testbar.

export interface DigCard {
  id: number;
  artist: string;
  title: string;
  thumb: string;
  cover: string;
  year?: string;
  label?: string;
  catno?: string;
  styles: string[];
  country?: string;
  have?: number;
  want?: number;
  source: DigSource;
  /** Warum die Karte kommt, z. B. „Mehr von Running Back“ */
  reason: string;
}

export type DigSource = "foryou" | "new" | "rare" | "friends" | "random";

export interface DigWeights {
  style: Record<string, number>;
  label: Record<string, number>;
  artist: Record<string, number>;
}

export const emptyWeights = (): DigWeights => ({ style: {}, label: {}, artist: {} });

export type DigAction = "want" | "collect" | "more" | "skip" | "dwell";

const DELTA: Record<DigAction, number> = { want: 3, collect: 3, more: 2, dwell: 0.5, skip: -2 };

/** Aktion auf einer Karte verschiebt die Gewichte von Style, Label und Artist (gedeckelt auf ±20) */
export function learn(w: DigWeights, c: Pick<DigCard, "styles" | "label" | "artist">, action: DigAction): DigWeights {
  const d = DELTA[action];
  const bump = (m: Record<string, number>, k: string | undefined, f = 1) => {
    if (!k) return m;
    return { ...m, [k]: Math.max(-20, Math.min(20, (m[k] ?? 0) + d * f)) };
  };
  let style = w.style;
  for (const s of c.styles.slice(0, 3)) style = bump(style, s, 1);
  return { style, label: bump(w.label, c.label, 0.7), artist: bump(w.artist, c.artist, 0.7) };
}

/** Wie gut passt eine Karte zu den gelernten Vorlieben? */
export function score(w: DigWeights, c: DigCard): number {
  const st = c.styles.reduce((a, s) => a + (w.style[s] ?? 0), 0) / Math.max(1, Math.min(3, c.styles.length));
  const demand = c.want && c.have != null ? Math.log10(1 + c.want) * 0.6 + Math.min(2, c.want / Math.max(1, c.have)) : 0;
  return st + (c.label ? (w.label[c.label] ?? 0) * 0.7 : 0) + (w.artist[c.artist] ?? 0) * 0.7 + demand;
}

/** Stärkste Einträge, z. B. die Lieblings-Styles */
export function top(m: Record<string, number>, n: number): string[] {
  return Object.entries(m)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/**
 * Quellen reißverschlussartig mischen, innerhalb jeder Quelle nach Passung sortiert.
 * Bekanntes (Sammlung, Wantlist, weggewischt) und Doppelte fallen raus,
 * und es kommen nie zwei Karten desselben Artists direkt hintereinander.
 */
export function mix(sources: DigCard[][], w: DigWeights, exclude: Set<number>, jitter: () => number = Math.random): DigCard[] {
  const queues = sources.map((s) => s.filter((c) => !exclude.has(c.id)).sort((a, b) => score(w, b) + jitter() * 2 - (score(w, a) + jitter() * 2)));
  const out: DigCard[] = [];
  const seen = new Set<number>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const q of queues) {
      const i = q.findIndex((c) => !seen.has(c.id) && c.artist !== out.at(-1)?.artist);
      if (i < 0) {
        // Nur noch Karten desselben Artists übrig: Duplikate verwerfen
        while (q.length && seen.has(q[0].id)) q.shift();
        continue;
      }
      const [c] = q.splice(i, 1);
      seen.add(c.id);
      out.push(c);
      progress = true;
    }
  }
  return out;
}

/** "Artist - Titel" aus der Discogs-Suche trennen; Discogs hängt bei Namensgleichheit „(2)“ an */
export function splitTitle(t: string): { artist: string; title: string } {
  const i = t.indexOf(" - ");
  const clean = (s: string) => s.replace(/\s\(\d+\)$/, "").replace(/\*$/, "");
  return i < 0 ? { artist: "", title: t } : { artist: clean(t.slice(0, i)), title: t.slice(i + 3) };
}
