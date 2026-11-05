// Releases eines Labels von Discogs (höchstens 5 Seiten à 100), eine Woche zwischengespeichert
import { discogs } from "./api";
import { getKV, setKV } from "./db";
import type { LabelRelease } from "../../../shared/labels";

interface Page {
  pagination: { pages: number; items: number };
  releases: { id: number; title: string; artist: string; catno: string; year?: number; format?: string; thumb?: string }[];
}

export interface LabelData {
  name: string;
  releases: LabelRelease[];
  items: number;
  truncated: boolean;
  at: number;
}

const MAX_PAGES = 5;

export async function loadLabel(id: number, force = false): Promise<LabelData> {
  const key = `label:${id}`;
  const old = await getKV<LabelData | null>(key, null);
  if (!force && old && Date.now() - old.at < 7 * 86400_000) return old;
  const info = await discogs<{ name: string }>(`/labels/${id}`);
  const releases: LabelRelease[] = [];
  let pages = 1;
  let items = 0;
  for (let p = 1; p <= Math.min(pages, MAX_PAGES); p++) {
    const r = await discogs<Page>(`/labels/${id}/releases?page=${p}&per_page=100`);
    pages = r.pagination.pages;
    items = r.pagination.items;
    for (const x of r.releases) releases.push({ id: x.id, title: x.title, artist: x.artist, catno: x.catno, year: x.year || undefined, format: x.format, thumb: x.thumb });
  }
  const data: LabelData = { name: info.name, releases, items, truncated: pages > MAX_PAGES, at: Date.now() };
  await setKV(key, data);
  return data;
}
