// Nachrichten unter Freunden (Text, Leihanfrage, Antwort). Stand liegt auf dem Server (/api/dm),
// hier zwischengespeichert, damit Unterhaltungen sofort und auch ohne Netz zu sehen sind.
import { useLiveQuery } from "dexie-react-hooks";
import { getKV, setKV } from "./db";
import { fetchWithTimeout } from "./api";
import { username } from "./store";
import { refreshBuzz } from "./buzz";

export type DmKind = "text" | "borrow" | "yes" | "no";
export interface Dm {
  id: number;
  from: string;
  to: string;
  kind: DmKind;
  text?: string | null;
  releaseId?: number | null;
  title?: string | null;
  thumb?: string | null;
  ts: number;
  read: boolean;
  /** Nur auf dem Gerät: wird gerade gesendet bzw. kam nicht an */
  pending?: boolean;
  failed?: boolean;
}
export interface DmThread {
  with: string;
  last: Dm;
  unread: number;
}
export interface DmBody {
  kind?: DmKind;
  text?: string;
  releaseId?: number;
  title?: string;
  thumb?: string;
}

const THREADS = "dmThreads";
const threadKey = (u: string) => `dmThread:${u.toLowerCase()}`;

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetchWithTimeout(path, { method: method ?? (body === undefined ? "GET" : "POST"), credentials: "include", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(j.message ?? `Fehler ${r.status}`);
  return j;
}

export const useThreads = () => useLiveQuery(() => getKV<DmThread[]>(THREADS, []), [], [] as DmThread[]);
export const useThread = (u: string) => useLiveQuery(() => getKV<Dm[]>(threadKey(u), []), [u], [] as Dm[]);

let listing: Promise<DmThread[]> | null = null;
export function refreshThreads(): Promise<DmThread[]> {
  if (listing) return listing;
  listing = (async () => {
    if (!username() || !navigator.onLine) return getKV<DmThread[]>(THREADS, []);
    try {
      const r = await call<{ threads: DmThread[] }>("/api/dm");
      await setKV(THREADS, r.threads);
      return r.threads;
    } catch {
      return getKV<DmThread[]>(THREADS, []);
    }
  })().finally(() => (listing = null));
  return listing;
}

/** Unterhaltung laden. Liefert, ob man sich (noch) schreiben darf. */
export async function refreshThread(u: string): Promise<{ friends: boolean } | null> {
  if (!username() || !navigator.onLine) return null;
  try {
    const r = await call<{ messages: Dm[]; friends: boolean }>(`/api/dm/${encodeURIComponent(u)}`);
    // Was gerade unterwegs ist, bleibt stehen, bis der Server es kennt
    const local = (await getKV<Dm[]>(threadKey(u), [])).filter((m) => m.pending || m.failed);
    await setKV(threadKey(u), [...r.messages, ...local]);
    return { friends: r.friends };
  } catch {
    return null;
  }
}

/** Als gelesen merken, auf dem Server und in der Übersicht (der Punkt am Freunde-Tab geht aus) */
export async function markThreadRead(u: string) {
  const threads = await getKV<DmThread[]>(THREADS, []);
  if (threads.some((t) => t.with === u.toLowerCase() && t.unread)) await setKV(THREADS, threads.map((t) => (t.with === u.toLowerCase() ? { ...t, unread: 0 } : t)));
  try {
    await call(`/api/dm/${encodeURIComponent(u)}/read`, {});
    void refreshBuzz();
  } catch {
    /* beim nächsten Öffnen */
  }
}

let localId = -1;
/** Senden: die Nachricht steht sofort da, der Server folgt. Schlägt es fehl, bleibt sie mit „Nicht gesendet“ stehen. */
export async function sendDm(u: string, body: DmBody): Promise<boolean> {
  const me = (username() ?? "").toLowerCase();
  const key = threadKey(u);
  const temp: Dm = { id: localId--, from: me, to: u.toLowerCase(), kind: body.kind ?? "text", text: body.text ?? null, releaseId: body.releaseId ?? null, title: body.title ?? null, thumb: body.thumb ?? null, ts: Date.now(), read: true, pending: true };
  await setKV(key, [...(await getKV<Dm[]>(key, [])), temp]);
  try {
    const r = await call<{ message: Dm }>(`/api/dm/${encodeURIComponent(u)}`, body);
    await setKV(key, (await getKV<Dm[]>(key, [])).map((m) => (m.id === temp.id ? r.message : m)));
    void refreshThreads();
    return true;
  } catch (e) {
    await setKV(key, (await getKV<Dm[]>(key, [])).map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true, text: m.text } : m)));
    throw e;
  }
}

/** Eine nicht gesendete Nachricht verwerfen oder eine eigene löschen */
export async function deleteDm(u: string, m: Dm) {
  const key = threadKey(u);
  if (m.id > 0) await call(`/api/dm/msg/${m.id}`, undefined, "DELETE");
  await setKV(key, (await getKV<Dm[]>(key, [])).filter((x) => x.id !== m.id));
  void refreshThreads();
}

/** Kurztext für die Übersicht */
export function dmPreview(m: Dm, me: string): string {
  const mine = m.from === me.toLowerCase();
  const what = m.title ?? "eine Platte";
  if (m.kind === "borrow") return mine ? `Leihanfrage: ${what}` : `Möchte sich leihen: ${what}`;
  if (m.kind === "yes") return `${mine ? "Du: " : ""}Klar, kannst du haben · ${what}`;
  if (m.kind === "no") return `${mine ? "Du: " : ""}Gerade nicht · ${what}`;
  return `${mine ? "Du: " : ""}${m.text || what}`;
}

/** Offene Leihanfragen an mich in dieser Unterhaltung: noch keine Antwort zur selben Platte danach */
export function openBorrow(messages: Dm[], m: Dm, me: string): boolean {
  if (m.kind !== "borrow" || m.to !== me.toLowerCase()) return false;
  return !messages.some((x) => x.id > m.id && x.from === me.toLowerCase() && (x.kind === "yes" || x.kind === "no") && x.releaseId === m.releaseId);
}
