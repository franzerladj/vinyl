// Jahresrückblick: was kam dazu, was lief am häufigsten, wo wurde aufgelegt.

export interface YearInput {
  year: number;
  today?: string;
  collection: { releaseId: number; dateAdded: string }[];
  releases: Map<number, { id: number; title: string; artist: string; year: number; labels: { name: string }[]; styles: string[]; thumb?: string; cover?: string }>;
  sets: { date?: string; venue?: string; trackIds: string[]; played?: string[] }[];
  trackRelease: (trackId: string) => number | undefined;
  trackSeconds?: (trackId: string) => number | null;
}

const top = <T,>(m: Map<T, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const bump = <T,>(m: Map<T, number>, k: T) => m.set(k, (m.get(k) ?? 0) + 1);
const cleanLabel = (s: string) => s.replace(/\s\(\d+\)$/, "");

export function yearReview(i: YearInput) {
  const y = String(i.year);
  const today = i.today ?? new Date().toISOString().slice(0, 10);
  const added = i.collection.filter((c) => c.dateAdded?.startsWith(y)).map((c) => i.releases.get(c.releaseId)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const labels = new Map<string, number>();
  const styles = new Map<string, number>();
  for (const r of added) {
    if (r.labels[0] && !/^not on label/i.test(r.labels[0].name)) bump(labels, cleanLabel(r.labels[0].name));
    for (const s of r.styles) bump(styles, s);
  }
  const sets = i.sets.filter((s) => s.date?.startsWith(y) && s.date <= today);
  const plays = new Map<number, number>();
  let seconds = 0;
  for (const s of sets) {
    const ids = s.played?.length ? s.played : s.date! < today ? s.trackIds : [];
    const seen = new Set<number>();
    for (const id of ids) {
      seconds += i.trackSeconds?.(id) ?? 360;
      const rid = i.trackRelease(id);
      // Pro Set zählt eine Platte einmal, auch wenn beide Seiten liefen
      if (rid && !seen.has(rid)) {
        seen.add(rid);
        bump(plays, rid);
      }
    }
  }
  const venues = new Set(sets.map((s) => s.venue?.trim()).filter(Boolean));
  const oldest = added.filter((r) => r.year > 0).sort((a, b) => a.year - b.year)[0];
  return {
    year: i.year,
    added: added.length,
    addedCovers: added.slice(-6).reverse(),
    topLabels: top(labels, 3).map(([name, n]) => ({ name, n })),
    topStyles: top(styles, 3).map(([name, n]) => ({ name, n })),
    sets: sets.length,
    venues: venues.size,
    hours: Math.round(seconds / 3600),
    mostPlayed: top(plays, 5)
      .map(([rid, n]) => ({ release: i.releases.get(rid), n }))
      .filter((x) => x.release),
    oldest,
  };
}

export type YearReview = ReturnType<typeof yearReview>;
