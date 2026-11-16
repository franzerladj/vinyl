// „Neu bei Freunden“: Neuzugänge und neue Wants der Freunde, je Freund und Tag zu einem Beitrag gebündelt.

export interface FeedItem {
  username: string;
  kind: "coll" | "want";
  releaseId: number;
  /** ISO-Datum von Discogs */
  dateAdded: string;
}

export interface FeedPost {
  /** eindeutig je Freund, Tag und Art */
  id: string;
  username: string;
  kind: "coll" | "want";
  /** jüngster Eintrag des Beitrags (ms) */
  at: number;
  releaseIds: number[];
}

/**
 * Beiträge, neueste zuerst. Mehrere Platten eines Freundes am selben Tag ergeben einen Beitrag
 * (wer 30 Platten auf einmal einträgt, soll nicht den ganzen Feed füllen).
 */
export function feedPosts(items: FeedItem[], opts: { limit?: number; perPost?: number; sinceMs?: number } = {}): FeedPost[] {
  const { limit = 8, perPost = 12, sinceMs = 0 } = opts;
  const posts = new Map<string, FeedPost>();
  for (const it of items) {
    const at = Date.parse(it.dateAdded);
    if (!Number.isFinite(at) || at < sinceMs) continue;
    const id = `${it.username}|${it.kind}|${it.dateAdded.slice(0, 10)}`;
    const p = posts.get(id) ?? { id, username: it.username, kind: it.kind, at, releaseIds: [] };
    p.at = Math.max(p.at, at);
    if (!p.releaseIds.includes(it.releaseId)) p.releaseIds.push(it.releaseId);
    posts.set(id, p);
  }
  return [...posts.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((p) => ({ ...p, releaseIds: p.releaseIds.slice(0, perPost) }));
}

/** „heute“, „gestern“, „vor 3 Tagen“, „vor 2 Wochen“, sonst Datum */
export function agoText(at: number, now = Date.now()): string {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 14) return `vor ${days} Tagen`;
  if (days < 60) return `vor ${Math.round(days / 7)} Wochen`;
  return new Date(at).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
}
