// Freunde: öffentliche Discogs-Sammlungen und Wantlists anderer Nutzer.
// Alles läuft über die offizielle API, gespeichert wird lokal auf dem Gerät.
import { ApiError, discogs } from "./api";
import { db, getKV, setKV, type Friend, type FriendItem } from "./db";
import { upsertBasics } from "./sync";
import { jobUpdate, username } from "./store";
import type { BasicInformation, Pagination } from "./types";

interface Profile {
  username: string;
  name?: string;
  avatar_url?: string;
  location?: string;
  num_collection?: number | null;
  num_wantlist?: number | null;
}

/** Profil laden und als Freund speichern. Wirft einen Fehler, wenn es den Namen nicht gibt. */
export async function addFriend(name: string): Promise<Friend> {
  const u = name.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?discogs\.com\/(user|de\/user)\//, "").replace(/\/.*$/, "");
  if (!u) throw new Error("Bitte einen Discogs-Namen eingeben");
  if (u.toLowerCase() === username().toLowerCase()) throw new Error("Das bist du selbst");
  let p: Profile;
  try {
    p = await discogs<Profile>(`/users/${encodeURIComponent(u)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new Error(`Discogs kennt „${u}“ nicht`);
    throw e;
  }
  const old = await db.friends.get(p.username);
  const f: Friend = {
    username: p.username,
    name: p.name || undefined,
    avatar: p.avatar_url || undefined,
    location: p.location || undefined,
    addedAt: old?.addedAt ?? Date.now(),
    lastSync: old?.lastSync,
    numCollection: p.num_collection ?? null,
    numWantlist: p.num_wantlist ?? null,
  };
  await db.friends.put(f);
  return f;
}

export async function removeFriend(name: string) {
  await db.transaction("rw", db.friends, db.friendItems, async () => {
    await db.friends.delete(name);
    await db.friendItems.where("username").equals(name).delete();
  });
}

type CollPage = { pagination: Pagination; releases: { id: number; date_added: string; basic_information: BasicInformation }[] };
type WantPage = { pagination: Pagination; wants: { id: number; date_added: string; basic_information: BasicInformation }[] };

async function loadList(u: string, kind: "coll" | "want"): Promise<{ items: FriendItem[]; private: boolean }> {
  const items: FriendItem[] = [];
  let page = 1;
  let pages = 1;
  try {
    do {
      const path = kind === "coll" ? `/users/${encodeURIComponent(u)}/collection/folders/0/releases?per_page=100&page=${page}&sort=added&sort_order=desc` : `/users/${encodeURIComponent(u)}/wants?per_page=100&page=${page}`;
      const d = await discogs<CollPage & WantPage>(path, { background: true });
      pages = Math.min(d.pagination.pages, 60);
      const rows = kind === "coll" ? d.releases : d.wants;
      await upsertBasics(rows.map((r) => r.basic_information));
      for (const r of rows) items.push({ key: `${u}:${kind}:${r.id}`, username: u, kind, releaseId: r.id, dateAdded: r.date_added });
      jobUpdate(`friend-${u}`, { done: page, total: pages });
      page++;
    } while (page <= pages);
  } catch (e) {
    // 403: der Freund hat diese Liste auf privat gestellt
    if (e instanceof ApiError && (e.status === 403 || e.status === 401)) return { items: [], private: true };
    throw e;
  }
  return { items, private: false };
}

export async function syncFriend(u: string) {
  const job = `friend-${u}`;
  jobUpdate(job, { label: `Sammlung von ${u}`, done: 0, total: 1 });
  try {
    const coll = await loadList(u, "coll");
    jobUpdate(job, { label: `Wantlist von ${u}`, done: 0, total: 1 });
    const wants = await loadList(u, "want");
    await db.transaction("rw", db.friends, db.friendItems, async () => {
      await db.friendItems.where("username").equals(u).delete();
      await db.friendItems.bulkPut([...coll.items, ...wants.items]);
      const f = await db.friends.get(u);
      if (f)
        await db.friends.put({
          ...f,
          lastSync: Date.now(),
          collectionPrivate: coll.private,
          wantsPrivate: wants.private,
          numCollection: coll.private ? null : coll.items.length,
          numWantlist: wants.private ? null : wants.items.length,
        });
    });
  } finally {
    jobUpdate(job, null);
  }
}

/** Alle Freunde aktualisieren, deren letzter Abgleich länger als maxAgeHours her ist */
export async function syncFriends(maxAgeHours = 24) {
  for (const f of await db.friends.toArray()) {
    if (f.lastSync && Date.now() - f.lastSync < maxAgeHours * 3600_000) continue;
    try {
      await syncFriend(f.username);
    } catch (e) {
      console.warn("Freund", f.username, e);
    }
  }
}

export interface FriendMatch {
  /** Platten, die der Freund hat und die auf deiner Wantlist stehen */
  hasYourWants: number[];
  /** Platten aus deiner Sammlung, die der Freund sucht */
  wantsYours: number[];
  /** Platten, die ihr beide habt */
  shared: number[];
  /** Wants, die ihr beide sucht */
  bothWant: number[];
}

export async function friendMatches(u: string): Promise<FriendMatch> {
  const [items, myColl, myWants] = await Promise.all([db.friendItems.where("username").equals(u).toArray(), db.collection.toArray(), db.wants.toCollection().primaryKeys()]);
  const mine = new Set(myColl.map((c) => c.releaseId));
  const wants = new Set(myWants);
  const theirColl = items.filter((i) => i.kind === "coll").map((i) => i.releaseId);
  const theirWants = items.filter((i) => i.kind === "want").map((i) => i.releaseId);
  return {
    hasYourWants: theirColl.filter((id) => wants.has(id)),
    wantsYours: theirWants.filter((id) => mine.has(id)),
    shared: theirColl.filter((id) => mine.has(id)),
    bothWant: theirWants.filter((id) => wants.has(id)),
  };
}

/** Link, mit dem ein Kumpel dich direkt als Freund hinzufügen kann */
export const inviteLink = () => `${location.origin}/friends?add=${encodeURIComponent(username())}`;

export const messageUrl = (u: string) => `https://www.discogs.com/messages/compose?to=${encodeURIComponent(u)}`;
export const profileUrl = (u: string) => `https://www.discogs.com/user/${encodeURIComponent(u)}`;
export const collectionUrl = (u: string) => `https://www.discogs.com/user/${encodeURIComponent(u)}/collection`;

// ---------------------------------------------------------------------------
// Eigenes Profil (Profilbild, Name) für Startseite und Einstellungen
// ---------------------------------------------------------------------------
export interface MyProfile {
  avatar?: string;
  name?: string;
  location?: string;
  fetchedAt: number;
}

export async function refreshMyProfile(maxAgeHours = 24): Promise<MyProfile | null> {
  const old = await getKV<MyProfile | null>("myProfile", null);
  if (old && Date.now() - old.fetchedAt < maxAgeHours * 3600_000) return old;
  const me = username();
  if (!me) return old;
  const p = await discogs<Profile>(`/users/${encodeURIComponent(me)}`, { background: true });
  const prof: MyProfile = { avatar: p.avatar_url || undefined, name: p.name || undefined, location: p.location || undefined, fetchedAt: Date.now() };
  await setKV("myProfile", prof);
  return prof;
}

// ---------------------------------------------------------------------------
// Geschmack: Übereinstimmung der Styles (Kosinus-Ähnlichkeit der Style-Häufigkeiten)
// ---------------------------------------------------------------------------
export async function tasteMatch(u: string): Promise<{ score: number | null; topShared: string[] }> {
  const [items, myColl] = await Promise.all([db.friendItems.where("username").equals(u).toArray(), db.collection.toArray()]);
  const theirIds = items.filter((i) => i.kind === "coll").map((i) => i.releaseId);
  const myIds = [...new Set(myColl.map((c) => c.releaseId))];
  if (theirIds.length < 5 || myIds.length < 5) return { score: null, topShared: [] };
  const [theirs, mine] = await Promise.all([db.releases.bulkGet(theirIds), db.releases.bulkGet(myIds)]);
  const vec = (rels: (import("./db").Release | undefined)[]) => {
    const m = new Map<string, number>();
    rels.forEach((r) => r?.styles.forEach((s) => m.set(s, (m.get(s) ?? 0) + 1)));
    return m;
  };
  const a = vec(theirs);
  const b = vec(mine);
  let dot = 0;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  const score = dot / (norm(a) * norm(b) || 1);
  const topShared = [...a.keys()].filter((k) => b.has(k)).sort((x, y) => (a.get(y)! + b.get(y)!) - (a.get(x)! + b.get(x)!)).slice(0, 3);
  return { score: Math.round(score * 100), topShared };
}

/** Wer von deinen Freunden hat oder sucht diese Platte? */
export async function friendsFor(releaseId: number) {
  const items = await db.friendItems.where("releaseId").equals(releaseId).toArray();
  const friends = new Map((await db.friends.bulkGet([...new Set(items.map((i) => i.username))])).filter(Boolean).map((f) => [f!.username, f!]));
  return items.filter((i) => friends.has(i.username)).map((i) => ({ friend: friends.get(i.username)!, kind: i.kind }));
}

/** Neu in den Sammlungen deiner Freunde (nach Discogs-Datum) */
export async function friendFeed(limit = 20) {
  const items = (await db.friendItems.toArray()).filter((i) => i.kind === "coll").sort((x, y) => y.dateAdded.localeCompare(x.dateAdded)).slice(0, limit);
  const [rels, friends] = await Promise.all([db.releases.bulkGet(items.map((i) => i.releaseId)), db.friends.toArray()]);
  const fm = new Map(friends.map((f) => [f.username, f]));
  return items.map((it, i) => ({ item: it, r: rels[i], friend: fm.get(it.username) })).filter((x) => x.r && x.friend);
}

// ---------------------------------------------------------------------------
// Verleihen
// ---------------------------------------------------------------------------
export async function lendRecord(releaseId: number, to: string | null) {
  const m = await db.recordMeta.get(releaseId);
  await db.recordMeta.put({ ...m, releaseId, lentTo: to, lentAt: to ? Date.now() : null });
  void import("./push").then((p) => p.syncPushData());
}

export async function lentRecords() {
  return (await db.recordMeta.toArray()).filter((m) => m.lentTo);
}
