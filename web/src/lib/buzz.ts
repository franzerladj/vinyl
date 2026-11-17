// Soziales im Freunde-Feed: Reaktionen und Kommentare auf Beiträge, Empfehlungen, Aktivitäts-Liste.
// Stand liegt auf dem Server (/api/buzz), hier zwischengespeichert für die Anzeige (auch offline).
import { useLiveQuery } from "dexie-react-hooks";
import { getKV, setKV } from "./db";
import { fetchWithTimeout } from "./api";
import { username } from "./store";

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
  inbox: InboxItem[];
  unread: number;
}
const EMPTY: Buzz = { reactions: [], comments: [], inbox: [], unread: 0 };
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

export const cachedBuzz = () => getKV<Buzz>(KEY, EMPTY);
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
