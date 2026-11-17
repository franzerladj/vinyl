// Platte des Tages: jeden Tag eine andere aus der eigenen Kiste. Jahrestage zuerst
// („heute vor 3 Jahren gekauft“), sonst bevorzugt Platten, die lange nicht in einem Set liefen.

export interface DailyInput {
  id: number;
  dateAdded: string;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function dailyPick(all: DailyInput[], today: string, recentlyPlayed: Set<number> = new Set(), playable?: Set<number>): { id: number; reason: string } | null {
  if (!all.length) return null;
  // Lieber eine Platte, zu der es sicher eine Hörprobe gibt (sonst dreht sich der Teller stumm)
  const withSound = playable ? all.filter((r) => playable.has(r.id)) : [];
  const records = withSound.length ? withSound : all;
  const md = today.slice(5, 10);
  const year = Number(today.slice(0, 4));
  const ann = records.filter((r) => r.dateAdded?.slice(5, 10) === md && Number(r.dateAdded.slice(0, 4)) < year).sort((a, b) => a.id - b.id);
  if (ann.length) {
    const r = ann[hash(today) % ann.length];
    const n = year - Number(r.dateAdded.slice(0, 4));
    return { id: r.id, reason: `Heute vor ${n === 1 ? "einem Jahr" : `${n} Jahren`} gekauft` };
  }
  const rested = records.filter((r) => !recentlyPlayed.has(r.id));
  const pool = (rested.length ? rested : records).slice().sort((a, b) => a.id - b.id);
  return { id: pool[hash(today) % pool.length].id, reason: rested.length ? "Aus dem Regal gezogen" : "Platte des Tages" };
}
