// „Die Kiste in Bildern“: Zahlenreihen für die Diagramme auf /dj. Reine Logik, die Zeichnung liegt in
// web/src/components/KisteCharts.tsx. Alles aus Daten, die ohnehin auf dem Gerät liegen.

export interface KisteInput {
  collection: { releaseId: number; dateAdded: string }[];
  releases: Map<number, { year?: number; styles?: string[]; labels?: { name: string }[]; country?: string }>;
  /** Heute als ISO-Tag, für Tests */
  today?: string;
}

export interface KisteStats {
  total: number;
  /** Monat für Monat vom ersten Kauf bis heute: dazugekommen und Stand */
  growth: { month: string; added: number; total: number }[];
  /** Käufe je Monat, zeilenweise nach Jahr (neuestes Jahr zuerst), höchstens `maxYears` Jahre */
  calendar: { years: { year: number; months: number[]; sum: number }[]; max: number; best: { year: number; month: number; n: number } | null };
  /** Erscheinungsjahre der Platten, lückenlos vom ersten bis zum letzten Jahr */
  years: { year: number; n: number }[];
  peakYear: { year: number; n: number } | null;
  /** Platten ohne Erscheinungsjahr bei Discogs */
  noYear: number;
  styles: { name: string; n: number }[];
  labels: { name: string; n: number }[];
  countries: { name: string; n: number }[];
}

const cleanLabel = (s: string) => s.replace(/\s\(\d+\)$/, "");
const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([name, k]) => ({ name, n: k }));
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function kisteStats(i: KisteInput, maxYears = 6): KisteStats {
  const today = i.today ?? new Date().toISOString().slice(0, 10);
  const nowY = Number(today.slice(0, 4));
  const nowM = Number(today.slice(5, 7));
  // Ein Exemplar zählt einmal, auch wenn dieselbe Pressung doppelt im Regal steht: gezählt werden Exemplare
  const dated = i.collection.filter((c) => /^\d{4}-\d{2}/.test(c.dateAdded ?? "") && c.dateAdded.slice(0, 7) <= today.slice(0, 7));
  const perMonth = new Map<string, number>();
  for (const c of dated) bump(perMonth, c.dateAdded.slice(0, 7));

  const growth: KisteStats["growth"] = [];
  const first = [...perMonth.keys()].sort()[0];
  if (first) {
    let y = Number(first.slice(0, 4));
    let m = Number(first.slice(5, 7));
    let sum = 0;
    while (y < nowY || (y === nowY && m <= nowM)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const added = perMonth.get(key) ?? 0;
      sum += added;
      growth.push({ month: key, added, total: sum });
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
  }

  const firstYear = first ? Number(first.slice(0, 4)) : nowY;
  const calYears: KisteStats["calendar"]["years"] = [];
  let max = 0;
  let best: KisteStats["calendar"]["best"] = null;
  for (let y = nowY; y >= Math.max(firstYear, nowY - maxYears + 1); y--) {
    const months = Array.from({ length: 12 }, (_, k) => perMonth.get(`${y}-${String(k + 1).padStart(2, "0")}`) ?? 0);
    months.forEach((n, k) => {
      if (n > max) {
        max = n;
        best = { year: y, month: k + 1, n };
      }
    });
    calYears.push({ year: y, months, sum: months.reduce((a, b) => a + b, 0) });
  }

  const byYear = new Map<number, number>();
  const styles = new Map<string, number>();
  const labels = new Map<string, number>();
  const countries = new Map<string, number>();
  let noYear = 0;
  for (const c of i.collection) {
    const r = i.releases.get(c.releaseId);
    if (!r) continue;
    // Jahr 0 = bei Discogs unbekannt
    if (r.year && r.year > 1900 && r.year <= nowY + 1) byYear.set(r.year, (byYear.get(r.year) ?? 0) + 1);
    else noYear++;
    for (const s of r.styles ?? []) bump(styles, s);
    const l = r.labels?.[0]?.name;
    if (l && !/^not on label/i.test(l)) bump(labels, cleanLabel(l));
    if (r.country && r.country !== "Unknown") bump(countries, r.country);
  }
  const ys = [...byYear.keys()].sort((a, b) => a - b);
  const years: KisteStats["years"] = [];
  if (ys.length) for (let y = ys[0]; y <= ys[ys.length - 1]; y++) years.push({ year: y, n: byYear.get(y) ?? 0 });
  const peakYear = years.reduce<KisteStats["peakYear"]>((a, b) => (b.n > (a?.n ?? 0) ? b : a), null);

  return { total: i.collection.length, growth, calendar: { years: calYears, max, best }, years, peakYear, noYear, styles: top(styles, 6), labels: top(labels, 6), countries: top(countries, 6) };
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthName = (m: number) => MONTHS[m - 1] ?? "";
/** „2024-03“ → „März 2024“ */
export const monthLabel = (key: string) => `${monthName(Number(key.slice(5, 7)))} ${key.slice(0, 4)}`;
export const plattenText = (n: number) => (n === 1 ? "1 Platte" : `${n} Platten`);
