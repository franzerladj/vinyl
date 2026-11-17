// Geschmacksprofil fürs Diggen, nach dem Vorbild von Kurzvideo-Feeds:
// - lernt aus allem, was man tut, nicht nur aus Knöpfen (Verweildauer, Mithören, Video, Details)
// - jede Eigenschaft (Style, Label, Artist, Jahrzehnt, Land) hat Summe und Anzahl der Eindrücke,
//   beide verblassen langsam (Geschmack ändert sich), Mittelwert mit Vorsicht bei wenigen Eindrücken
// - Kurzzeit-Gedächtnis der laufenden Sitzung: was gerade zieht, kommt sofort öfter
// - Erkunden: wenig Gesehenes bekommt einen Bonus, damit das Profil nicht einschläft
// - Abwechslung: ähnliche Karten direkt hintereinander werden abgewertet
// Ohne Browser- oder Netz-Abhängigkeiten, damit testbar.

import type { DigCard } from "./dig";

export interface TasteStat {
  /** verblasste Summe der Belohnungen */
  s: number;
  /** verblasste Anzahl der Eindrücke */
  n: number;
  /** letzte Änderung (ms) */
  t: number;
}

export interface Taste {
  v: 2;
  f: Record<string, TasteStat>;
  /** Anzahl aller bewerteten Eindrücke (für den Erkundungs-Bonus) */
  total: number;
}

export type Signal = "view" | "like" | "unlike" | "want" | "collect" | "more" | "skip" | "share" | "detail" | "video";

/** Was ein Signal wert ist. „view“ rechnet sich aus Verweildauer und Mithören (viewReward). */
const REWARD: Record<Exclude<Signal, "view">, number> = { like: 2.5, unlike: -2.5, want: 3, collect: 3, more: 2, skip: -2, share: 2, detail: 0.6, video: 0.8 };

/** Gewicht je Art der Eigenschaft beim Lernen und Bewerten */
const KIND: Record<string, number> = { s: 1, l: 0.8, a: 0.7, d: 0.5, c: 0.2 };

const HALF_LIFE = 45 * 864e5;
const PRIOR = 2; // so viele „neutrale“ Eindrücke stecken in jeder Eigenschaft
const MAX_FEATURES = 700;

export const emptyTaste = (): Taste => ({ v: 2, f: {}, total: 0 });

const decadeOf = (year?: string | number) => {
  const y = typeof year === "number" ? year : parseInt(year ?? "", 10);
  return Number.isFinite(y) && y > 1900 ? String(Math.floor(y / 10) * 10) : null;
};

/** Eigenschaften einer Karte als Schlüssel: s:Style, l:Label, a:Artist, d:Jahrzehnt, c:Land */
export function features(c: Pick<DigCard, "styles" | "label" | "artist" | "year" | "country">): string[] {
  const out = c.styles.slice(0, 3).map((s) => `s:${s}`);
  if (c.label) out.push(`l:${c.label}`);
  if (c.artist && !/^various$/i.test(c.artist)) out.push(`a:${c.artist}`);
  const d = decadeOf(c.year);
  if (d) out.push(`d:${d}`);
  if (c.country) out.push(`c:${c.country}`);
  return out;
}

/** Verweildauer und Mithören in eine Belohnung übersetzen: schnell weiter ist ein klares Nein */
export function viewReward(seconds: number, listened = 0): number {
  let r = seconds < 1.5 ? -0.6 : seconds < 4 ? -0.15 : seconds < 10 ? 0.35 : seconds < 25 ? 0.9 : 1.4;
  if (listened > 15) r += 0.8;
  else if (listened > 6) r += 0.3;
  return r;
}

const decay = (st: TasteStat, now: number): TasteStat => {
  const k = Math.pow(0.5, Math.max(0, now - st.t) / HALF_LIFE);
  return { s: st.s * k, n: st.n * k, t: now };
};

/** Ein Signal lernen. „view“ zählt als Eindruck, alles andere verschiebt nur die Summe. */
export function learnTaste(t: Taste, c: Parameters<typeof features>[0], signal: Signal, opts: { seconds?: number; listened?: number; now?: number } = {}): Taste {
  const now = opts.now ?? Date.now();
  const r = signal === "view" ? viewReward(opts.seconds ?? 0, opts.listened ?? 0) : REWARD[signal];
  const f = { ...t.f };
  const styles = c.styles.slice(0, 3).length || 1;
  for (const k of features(c)) {
    const w = KIND[k[0]] ?? 0.5;
    // Mehrere Styles teilen sich die Belohnung, sonst zählt eine Platte mit drei Styles dreifach
    const share = k[0] === "s" ? 1 / Math.sqrt(styles) : 1;
    const cur = decay(f[k] ?? { s: 0, n: 0, t: now }, now);
    f[k] = { s: cur.s + r * w * share, n: cur.n + (signal === "view" ? 1 : 0.5), t: now };
  }
  return prune({ v: 2, f, total: t.total + (signal === "view" ? 1 : 0) });
}

/** Zu viele Eigenschaften: die mit den wenigsten Eindrücken fallen weg */
function prune(t: Taste): Taste {
  const keys = Object.keys(t.f);
  if (keys.length <= MAX_FEATURES) return t;
  const keep = keys.sort((a, b) => t.f[b].n - t.f[a].n).slice(0, MAX_FEATURES);
  return { ...t, f: Object.fromEntries(keep.map((k) => [k, t.f[k]])) };
}

/** Vorliebe für eine Eigenschaft, vorsichtig bei wenigen Eindrücken (etwa -3 bis +3) */
export function affinity(t: Taste, k: string, now = Date.now()): number {
  const st = t.f[k];
  if (!st) return 0;
  const d = decay(st, now);
  return d.s / (d.n + PRIOR);
}

/** Kurzzeit-Gedächtnis: die letzten Reaktionen der laufenden Sitzung */
export interface SessionEvent {
  keys: string[];
  r: number;
}

function sessionBoost(session: SessionEvent[], keys: string[]): number {
  let sum = 0;
  let w = 1;
  for (let i = session.length - 1; i >= 0 && i >= session.length - 30; i--) {
    const e = session[i];
    const hits = e.keys.filter((k) => keys.includes(k)).length;
    if (hits) sum += e.r * w * Math.min(1, hits / 2);
    w *= 0.88;
  }
  return Math.max(-2, Math.min(2, sum / 3));
}

/** Bewertung einer Karte: Langzeit-Geschmack, laufende Sitzung, Erkunden, Nachfrage */
export function rank(t: Taste, c: DigCard, session: SessionEvent[] = [], now = Date.now()): number {
  const keys = features(c);
  let base = 0;
  let styleSum = 0;
  let styleN = 0;
  let explore = 0;
  for (const k of keys) {
    const a = affinity(t, k, now);
    if (k[0] === "s") {
      styleSum += a;
      styleN++;
    } else base += a * (KIND[k[0]] ?? 0.5);
    // Erkunden nur für Style und Label: wenig gesehen = Bonus, der mit jedem Eindruck schrumpft
    if (k[0] === "s" || k[0] === "l") {
      const n = t.f[k]?.n ?? 0;
      explore = Math.max(explore, Math.sqrt(Math.log(t.total + 2) / (n + 1)));
    }
  }
  if (styleN) base += styleSum / styleN;
  const demand = c.want && c.have != null ? Math.min(1, Math.log10(1 + c.want) * 0.25 + Math.min(1, c.want / Math.max(1, c.have)) * 0.3) : 0;
  return base + sessionBoost(session, keys) * 0.8 + Math.min(1.2, explore) * 0.35 + demand;
}

const similarity = (a: string[], b: string[]) => {
  let s = 0;
  for (const k of a) if (b.includes(k)) s += k[0] === "a" ? 1.2 : k[0] === "l" ? 0.8 : k[0] === "s" ? 0.35 : 0.1;
  return s;
};

/**
 * Reihenfolge festlegen: immer die beste nächste Karte, aber abgewertet, wenn sie den
 * letzten drei zu ähnlich ist (gleicher Artist, gleiches Label). Jede fünfte Karte ist
 * zum Erkunden da (Quelle „random“ oder „rare“, sonst die mit dem größten Erkundungs-Bonus).
 */
export function arrange(t: Taste, cards: DigCard[], session: SessionEvent[] = [], opts: { jitter?: () => number; before?: DigCard[]; now?: number } = {}): DigCard[] {
  const jitter = opts.jitter ?? Math.random;
  const now = opts.now ?? Date.now();
  const pool = cards.map((c) => ({ c, keys: features(c), s: rank(t, c, session, now) + (jitter() - 0.5) * 0.5 }));
  const out: DigCard[] = [];
  const recent = (opts.before ?? []).slice(-3).map((c) => features(c));
  while (pool.length) {
    const exploreSlot = (out.length + (opts.before?.length ?? 0)) % 5 === 4;
    let best = -1;
    let bestScore = -Infinity;
    pool.forEach((p, i) => {
      let v = p.s - recent.reduce((a, r, j) => a + similarity(p.keys, r) * (0.6 + j * 0.2), 0);
      if (exploreSlot) v = (p.c.source === "random" || p.c.source === "rare" ? 2 : 0) + p.keys.filter((k) => k[0] === "s" && (t.f[k]?.n ?? 0) < 3).length - Math.abs(p.s) * 0.1;
      // Derselbe Artist nie direkt hintereinander (nur wenn nichts anderes übrig ist)
      const last = out.at(-1) ?? opts.before?.at(-1);
      if (last && last.artist === p.c.artist) v -= 100;
      if (v > bestScore) {
        bestScore = v;
        best = i;
      }
    });
    const [p] = pool.splice(best, 1);
    out.push(p.c);
    recent.push(p.keys);
    if (recent.length > 3) recent.shift();
  }
  return out;
}

/** Stärkste Vorlieben einer Art (s, l, a, d, c), z. B. für „Dein Geschmack“ */
export function topTaste(t: Taste, kind: string, n: number, now = Date.now()): { key: string; value: number; seen: number }[] {
  return Object.keys(t.f)
    .filter((k) => k[0] === kind && k[1] === ":")
    .map((k) => ({ key: k.slice(2), value: affinity(t, k, now), seen: t.f[k].n }))
    .filter((x) => x.value > 0.05)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/** Aus einer Liste mit Gewichten ziehen (stärkere Vorlieben öfter, aber nicht immer) */
export function sample<T>(items: { item: T; weight: number }[], rand: () => number = Math.random): T | undefined {
  const pos = items.filter((x) => x.weight > 0);
  const total = pos.reduce((a, x) => a + x.weight, 0);
  if (!total) return undefined;
  let r = rand() * total;
  for (const x of pos) {
    r -= x.weight;
    if (r <= 0) return x.item;
  }
  return pos.at(-1)!.item;
}

/**
 * Startwert aus der eigenen Sammlung: was man besitzt, mag man. Bewusst vorsichtig
 * (höchstens 4 Eindrücke je Eigenschaft), damit das Diggen das Profil schnell formt.
 */
export function seedTaste(records: Parameters<typeof features>[0][], now = Date.now()): Taste {
  const count = new Map<string, number>();
  for (const r of records) for (const k of features(r)) count.set(k, (count.get(k) ?? 0) + 1);
  const max = new Map<string, number>();
  for (const [k, v] of count) max.set(k[0], Math.max(max.get(k[0]) ?? 1, v));
  const f: Record<string, TasteStat> = {};
  for (const [k, v] of count) {
    const share = v / (max.get(k[0]) ?? 1);
    f[k] = { s: share * 3 * (KIND[k[0]] ?? 0.5), n: 1 + share * 3, t: now };
  }
  return prune({ v: 2, f, total: 0 });
}

/** Etwas weniger davon: Vorliebe von Hand senken (oder ganz löschen) */
export function forget(t: Taste, key: string): Taste {
  const f = { ...t.f };
  delete f[key];
  return { ...t, f };
}
