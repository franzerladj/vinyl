// Repress-Alarm im Hintergrund: Master-Versionen der Wants höchstens einmal pro Woche prüfen
import { discogs } from "./api";
import { db, getKV, setKV } from "./db";
import { newPressings, type Version } from "../../../shared/repress";

interface Seen {
  [masterId: string]: { at: number; ids: number[] };
}
export interface RepressNews {
  wantId: number;
  masterId: number;
  version: Version;
  at: number;
}

export const repressNews = () => getKV<RepressNews[]>("repressNews", []);
export const dismissRepress = async (wantId: number) => setKV("repressNews", (await repressNews()).filter((n) => n.wantId !== wantId));

export async function checkRepresses(limit = 15): Promise<RepressNews[]> {
  const wants = await db.wants.toArray();
  const rels = (await db.releases.bulkGet(wants.map((w) => w.releaseId))).filter((r) => r?.masterId);
  const seen = await getKV<Seen>("repressSeen", {});
  const due = rels.filter((r) => Date.now() - (seen[r!.masterId!]?.at ?? 0) > 7 * 86400_000).slice(0, limit);
  const found: RepressNews[] = [];
  for (const r of due) {
    try {
      const res = await discogs<{ versions: Version[] }>(`/masters/${r!.masterId}/versions?sort=released&sort_order=desc&per_page=25`, { background: true });
      const prev = seen[r!.masterId!];
      const fresh = newPressings(res.versions ?? [], prev ? new Set(prev.ids) : null, r!.id);
      seen[r!.masterId!] = { at: Date.now(), ids: [...new Set([...(prev?.ids ?? []), ...(res.versions ?? []).map((v) => v.id)])].slice(-200) };
      if (fresh[0]) found.push({ wantId: r!.id, masterId: r!.masterId!, version: fresh[0], at: Date.now() });
    } catch (e) {
      console.warn("Repress", r!.masterId, e);
    }
  }
  await setKV("repressSeen", seen);
  if (found.length) {
    const old = (await repressNews()).filter((n) => !found.some((f) => f.wantId === n.wantId));
    await setKV("repressNews", [...found, ...old].slice(0, 100));
  }
  return found;
}
