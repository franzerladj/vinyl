// Freundschaften mit Anfrage und Annehmen. Der Stand liegt auf dem Server (KV `soc:<name>`),
// die Freundesliste selbst bleibt wie bisher auf dem Gerät (Tabelle friends).
import { db, getKV, setKV } from "./db";
import { fetchWithTimeout } from "./api";
import { addFriend, syncFriend } from "./friends";
import { toast, username } from "./store";

export interface Social {
  friends: string[];
  in: { from: string; at: number }[];
  out: string[];
}
const EMPTY: Social = { friends: [], in: [], out: [] };
const KEY = "social";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Zuletzt bekannter Stand (für die Anzeige, auch offline) */
export const cachedSocial = () => getKV<Social>(KEY, EMPTY);

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetchWithTimeout(path, { method: body === undefined ? "GET" : "POST", credentials: "include", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, 20_000);
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(j.message ?? `Fehler ${r.status}`);
  return j;
}

let running: Promise<Social> | null = null;
/**
 * Stand vom Server holen und die Freundesliste nachziehen: wer zugesagt hat, steht danach von selbst in der Liste.
 * Beim ersten Mal werden die bisher einzeln hinzugefügten Freunde als Anfrage nachgereicht.
 */
export function refreshSocial(): Promise<Social> {
  if (running) return running;
  running = (async () => {
    if (!username()) return EMPTY;
    let s: Social;
    try {
      s = await call<Social>("/api/friends");
    } catch {
      return cachedSocial();
    }
    const local = await db.friends.toArray();
    if (!(await getKV("socialMigrated", false))) {
      for (const f of local) {
        if (s.friends.some((x) => same(x, f.username)) || s.out.some((x) => same(x, f.username))) continue;
        try {
          const r = await call<{ status: string }>("/api/friends/request", { to: f.username });
          if (r.status === "befreundet") s = { ...s, friends: [...s.friends, f.username], in: s.in.filter((x) => !same(x.from, f.username)) };
          else s = { ...s, out: [...s.out, f.username] };
        } catch {
          /* beim nächsten Mal */
        }
      }
      await setKV("socialMigrated", true);
    }
    // Zugesagte Freundschaften, die auf diesem Gerät noch fehlen
    for (const name of s.friends) {
      if (local.some((f) => same(f.username, name))) continue;
      try {
        const f = await addFriend(name);
        toast(`${f.username} und du seid jetzt befreundet`);
        void syncFriend(f.username, true).catch(() => undefined);
      } catch {
        /* Discogs gerade nicht erreichbar: beim nächsten Mal */
      }
    }
    await setKV(KEY, s);
    return s;
  })().finally(() => (running = null));
  return running;
}

/** Anfrage schicken. „befreundet“, wenn der andere schon angefragt hatte. */
export async function requestFriend(to: string): Promise<"befreundet" | "angefragt" | null> {
  try {
    const r = await call<{ status: "befreundet" | "angefragt" }>("/api/friends/request", { to });
    void refreshSocial();
    return r.status;
  } catch {
    return null;
  }
}

export async function respondFriend(from: string, accept: boolean) {
  await call("/api/friends/respond", { from, accept });
  if (accept) {
    const f = await addFriend(from);
    void syncFriend(f.username, true).catch(() => undefined);
  }
  const s = await cachedSocial();
  await setKV(KEY, { ...s, in: s.in.filter((x) => !same(x.from, from)), friends: accept ? [...s.friends, from] : s.friends });
  void refreshSocial();
}

export async function unfriend(user: string) {
  await call("/api/friends/remove", { user }).catch(() => undefined);
  const s = await cachedSocial();
  await setKV(KEY, { friends: s.friends.filter((x) => !same(x, user)), out: s.out.filter((x) => !same(x, user)), in: s.in.filter((x) => !same(x.from, user)) });
}
