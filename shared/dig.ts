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

export type DigAction = "want" | "collect" | "like" | "unlike" | "more" | "skip" | "dwell";

// „Mag ich“ zählt fast so stark wie die Wantlist, landet aber nicht dort
const DELTA: Record<DigAction, number> = { want: 3, collect: 3, like: 2.5, unlike: -2.5, more: 2, dwell: 0.5, skip: -2 };

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

// ---------------------------------------------------------------------------
// Filter: Jahrzehnt und Preis
// ---------------------------------------------------------------------------

export const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;

/** „90er“, „00er“, „2020er“ wäre zu lang: zweistellig */
export const decadeLabel = (d: number) => `${String(d).slice(2)}er`;

export function inDecade(year: string | number | undefined, decade?: number): boolean {
  if (!decade) return true;
  const y = typeof year === "number" ? year : parseInt(year ?? "", 10);
  return Number.isFinite(y) && y >= decade && y < decade + 10;
}

/** n verschiedene Jahre aus dem Jahrzehnt, nicht in der Zukunft */
export function decadeYears(decade: number, n: number, rand: () => number = Math.random, now = new Date().getFullYear()): number[] {
  const all = Array.from({ length: 10 }, (_, i) => decade + i).filter((y) => y <= now);
  return [...all].sort(() => rand() - 0.5).slice(0, Math.min(n, all.length));
}

/** Preisfilter: ohne Grenze immer, sonst nur mit Angebot bis zum Höchstpreis */
export function passesPrice(lowest: number | null | undefined, maxPrice?: number): boolean {
  if (!maxPrice) return true;
  return lowest != null && lowest <= maxPrice;
}
