// Soziales im Freunde-Feed: Reaktionen und Kommentare auf Beiträge, Empfehlungen, Aktivitäts-Liste.
// Stand liegt auf dem Server (/api/buzz), hier zwischengespeichert für die Anzeige (auch offline).
import { useLiveQuery } from "dexie-react-hooks";
import { getKV, setKV } from "./db";
import { fetchWithTimeout } from "./api";
import { ask, username } from "./store";
import { db } from "./db";
import type { OwnPost, OwnPostKind, SetPostData, SpotPostData } from "../../../shared/ownPost";

export interface Reaction {
  owner: string;
  post: string;
  from: string;
  ts: number;
}
export interface BuzzComment {
  id: number;
  owner: string;
  post: string;
  from: string;
  text: string;
  ts: number;
}
export interface InboxItem {
  id: number;
  from: string;
  kind: "react" | "comment" | "recommend";
  post?: string | null;
  releaseId?: number | null;
  title?: string | null;
  text?: string | null;
  ts: number;
  read: boolean;
}
export interface Buzz {
  reactions: Reaction[];
  comments: BuzzComment[];
  /** Eigene Beiträge von Freunden und dir: Set gespielt, Platte des Moments */
  posts: OwnPost[];
  inbox: InboxItem[];
  unread: number;
}
const EMPTY: Buzz = { reactions: [], comments: [], posts: [], inbox: [], unread: 0 };
const KEY = "buzz";

/** Beitrag im Feed heißt „freund|art|tag“, der Server kennt Besitzer und „art|tag“ getrennt */
export const postRef = (feedId: string) => {
  const [owner, kind, day] = feedId.split("|");
  return { owner: owner.toLowerCase(), post: `${kind}|${day}` };
};

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetchWithTimeout(path, { method: method ?? (body === undefined ? "GET" : "POST"), credentials: "include", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, 20_000);
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(j.message ?? `Fehler ${r.status}`);
  return j;
}

export const cachedBuzz = async (): Promise<Buzz> => ({ ...EMPTY, ...(await getKV<Partial<Buzz>>(KEY, EMPTY)) });
/** Für Komponenten: aktueller Stand, aktualisiert sich von selbst */
export const useBuzz = () => useLiveQuery(() => cachedBuzz(), [], EMPTY);

let running: Promise<Buzz> | null = null;
export function refreshBuzz(): Promise<Buzz> {
  if (running) return running;
  running = (async () => {
    if (!username() || !navigator.onLine) return cachedBuzz();
    try {
      const b = await call<Buzz>("/api/buzz");
      await setKV(KEY, b);
      return b;
    } catch {
      return cachedBuzz();
    }
  })().finally(() => (running = null));
  return running;
}

const me = () => (username() ?? "").toLowerCase();

/** Reaktion setzen oder zurücknehmen: sofort in der Anzeige, dann zum Server */
export async function react(feedId: string, on: boolean, ctx: { title?: string; releaseId?: number } = {}) {
  const { owner, post } = postRef(feedId);
  const b = await cachedBuzz();
  const rest = b.reactions.filter((r) => !(r.owner === owner && r.post === post && r.from === me()));
  await setKV(KEY, { ...b, reactions: on ? [...rest, { owner, post, from: me(), ts: Date.now() }] : rest });
  try {
    await call("/api/buzz/react", { owner, post, on, ...ctx });
  } catch (e) {
    await setKV(KEY, b); // zurück auf den alten Stand
    throw e;
  }
}

export async function comment(feedId: string, text: string, ctx: { title?: string; releaseId?: number } = {}) {
  const { owner, post } = postRef(feedId);
  const c = await call<BuzzComment>("/api/buzz/comment", { owner, post, text, ...ctx });
  const b = await cachedBuzz();
  await setKV(KEY, { ...b, comments: [...b.comments, c] });
  return c;
}

export async function deleteComment(id: number) {
  await call(`/api/buzz/comment/${id}`, undefined, "DELETE");
  const b = await cachedBuzz();
  await setKV(KEY, { ...b, comments: b.comments.filter((c) => c.id !== id) });
}

export function recommend(to: string, releaseId: number, title: string, text?: string) {
  return call("/api/buzz/recommend", { to, releaseId, title, text });
}

export async function markInboxRead() {
  const b = await cachedBuzz();
  if (!b.unread) return;
  await setKV(KEY, { ...b, unread: 0, inbox: b.inbox.map((i) => ({ ...i, read: true })) });
  await call("/api/buzz/read", {}).catch(() => undefined);
}

/** Reaktionen und Kommentare zu einem Beitrag */
export function forPost(b: Buzz, feedId: string) {
  const { owner, post } = postRef(feedId);
  const reactions = b.reactions.filter((r) => r.owner === owner && r.post === post);
  return { reactions, mine: reactions.some((r) => r.from === me()), comments: b.comments.filter((c) => c.owner === owner && c.post === post) };
}

// ---------------------------------------------------------------------------
// Eigene Beiträge: „hat ein Set gespielt“ und „Platte des Moments“
// ---------------------------------------------------------------------------

export async function publish(kind: OwnPostKind, ref: string, data: SetPostData | SpotPostData) {
  await call("/api/buzz/post", { kind, ref, data });
  const b = await cachedBuzz();
  const me_ = me();
  await setKV(KEY, { ...b, posts: [{ owner: me_, kind, ref, data, ts: Date.now() }, ...b.posts.filter((p) => !(p.owner === me_ && p.kind === kind && p.ref === ref))] });
}

export async function unpublish(kind: OwnPostKind, ref: string) {
  await call("/api/buzz/post", { kind, ref, remove: true });
  const b = await cachedBuzz();
  await setKV(KEY, { ...b, posts: b.posts.filter((p) => !(p.owner === me() && p.kind === kind && p.ref === ref)) });
}

/** Sollen gespielte Sets im Feed der Freunde erscheinen? Noch nicht gefragt = undefined */
export const shareSetsChoice = () => getKV<boolean | undefined>("feedShareSets", undefined);
export const setShareSets = (on: boolean) => setKV("feedShareSets", on);

let checking = false;
/**
 * Gespielte Sets der letzten 30 Tage in den Feed der Freunde stellen. Beim ersten Mal wird gefragt,
 * die Antwort gilt für alle weiteren (änderbar auf der Freunde-Seite). Ohne Freunde passiert nichts.
 */
export async function publishPlayedSets() {
  if (checking || !username() || !navigator.onLine) return;
  checking = true;
  try {
    if ((await db.friends.count()) === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const done = new Set(await getKV<string[]>("feedPosted", []));
    const sets = (await db.sets.toArray()).filter((s) => s.date && s.date >= since && s.trackIds.length > 0 && (s.date < today || (s.date === today && (s.played?.length ?? 0) > 0)) && !done.has(String(s.createdAt)));
    if (!sets.length) return;
    let ok = await shareSetsChoice();
    if (ok === undefined) {
      const first = sets[0];
      ok = await ask({ title: "Set im Feed zeigen?", body: `Deine Freunde sehen dann, dass du „${first.name || "ein Set"}“ gespielt hast: Name, Ort, Anzahl der Tracks und ein paar Cover. Das gilt auch für künftige Sets und lässt sich unter „Freunde“ wieder abschalten.`, ok: "Zeigen", cancel: "Nicht zeigen" });
      await setShareSets(ok);
    }
    for (const s of sets) {
      if (ok) {
        const ids = s.played?.length ? s.played : s.trackIds;
        const tracks = (await db.tracks.bulkGet(ids)).filter(Boolean) as { releaseId: number; artist: string; title: string }[];
        const rids = [...new Set(tracks.map((t) => t.releaseId))];
        const rels = (await db.releases.bulkGet(rids.slice(0, 8))).filter(Boolean) as { thumb?: string; cover?: string }[];
        const data: SetPostData = { name: s.name || "Set", venue: s.venue, date: s.date, tracks: ids.length, records: rids.length, covers: rels.map((r) => r.cover || r.thumb || "").filter(Boolean).slice(0, 4), picks: tracks.slice(0, 3).map((t) => ({ artist: t.artist, title: t.title })) };
        try {
          await publish("set", String(s.createdAt), data);
        } catch {
          continue; // beim nächsten Mal
        }
      }
      done.add(String(s.createdAt));
    }
    await setKV("feedPosted", [...done].slice(-200));
  } finally {
    checking = false;
  }
}

/** Platte des Moments im Profil geändert: als Beitrag zeigen (das Profil ist ohnehin für Freunde sichtbar) */
export async function publishSpotlight(sp: { id: number; title: string; artist: string; cover?: string } | undefined, before?: number) {
  if (!sp || sp.id === before || !username()) return;
  try {
    await publish("spot", String(sp.id), { id: sp.id, title: sp.title, artist: sp.artist, cover: sp.cover });
  } catch {
    /* nicht schlimm */
  }
}
