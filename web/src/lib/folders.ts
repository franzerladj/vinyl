// Ordner für Sammlung und Wantlist. Sammlung: echte Discogs-Ordner. Wantlist: Marke in der Notiz
// (siehe shared/folders.ts). Beide teilen sich eine Namensliste, die Discogs-Ordner.
import { useLiveQuery } from "dexie-react-hooks";
import { ApiError, discogs } from "./api";
import { logError } from "./pool";
import { db, getKV, setKV } from "./db";
import { jobUpdate, toast, username } from "./store";
import { cleanFolderName, customFolders, NO_FOLDER, sameFolder, wantFolderOf, withWantFolder, type Folder } from "../../../shared/folders";

const u = () => encodeURIComponent(username());
const KEY = "folders";

export const cachedFolders = () => getKV<Folder[]>(KEY, []);

/** Eigene Ordner, live aus dem lokalen Speicher */
export function useFolders(): Folder[] {
  return useLiveQuery(async () => customFolders(await cachedFolders()), [], []);
}

/** Namen für die Wantlist: Discogs-Ordner plus Namen, die nur in Want-Notizen vorkommen */
export function useWantFolderNames(): string[] {
  return useLiveQuery(
    async () => {
      const names = customFolders(await cachedFolders()).map((f) => f.name);
      for (const w of await db.wants.toArray()) {
        const n = wantFolderOf(w.notes);
        if (n && !names.some((x) => sameFolder(x, n))) names.push(n);
      }
      return names.sort((a, b) => a.localeCompare(b, "de"));
    },
    [],
    [],
  );
}

export async function syncFolders(background = true) {
  const r = await discogs<{ folders: Folder[] }>(`/users/${u()}/collection/folders`, { background });
  await setKV(KEY, (r.folders ?? []).map((f) => ({ id: f.id, name: f.name, count: f.count })));
}

export async function createFolder(raw: string): Promise<Folder> {
  const name = cleanFolderName(raw);
  if (!name) throw new Error("Bitte einen Namen eingeben");
  const list = await cachedFolders();
  const have = list.find((f) => f.id > NO_FOLDER && sameFolder(f.name, name));
  if (have) return have;
  const f = await discogs<Folder>(`/users/${u()}/collection/folders`, { method: "POST", body: { name } });
  const folder = { id: f.id, name: f.name ?? name, count: 0 };
  await setKV(KEY, [...list, folder]);
  return folder;
}

/** Ordner für einen Namen finden oder anlegen */
export async function folderIdFor(name: string) {
  const have = (await cachedFolders()).find((f) => f.id > NO_FOLDER && sameFolder(f.name, name));
  return (have ?? (await createFolder(name))).id;
}

export async function renameFolder(id: number, raw: string) {
  const name = cleanFolderName(raw);
  if (!name || id <= NO_FOLDER) return;
  const list = await cachedFolders();
  const old = list.find((f) => f.id === id);
  await discogs(`/users/${u()}/collection/folders/${id}`, { method: "POST", body: { name } });
  await setKV(KEY, list.map((f) => (f.id === id ? { ...f, name } : f)));
  // Wants mit dem alten Namen mitnehmen
  if (old) {
    const ids = (await db.wants.toArray()).filter((w) => sameFolder(wantFolderOf(w.notes), old.name)).map((w) => w.releaseId);
    if (ids.length) await setWantFolder(ids, name);
  }
}

/** Ordner löschen: Platten wandern nach „Ohne Ordner“ (Discogs löscht nur leere Ordner), Wants verlieren die Marke */
export async function deleteFolder(id: number) {
  if (id <= NO_FOLDER) return;
  const old = (await cachedFolders()).find((f) => f.id === id);
  const inside = await db.collection.where("folderId").equals(id).toArray();
  await moveInstances(inside, NO_FOLDER);
  // Erst wenn die Platten draußen sind, den Ordner bei Discogs löschen (in der Warteschlange hinten an)
  await setKV(KEY, (await cachedFolders()).filter((f) => f.id !== id));
  await push([{ t: "del", folderId: id }]);
  if (old) {
    const ids = (await db.wants.toArray()).filter((w) => sameFolder(wantFolderOf(w.notes), old.name)).map((w) => w.releaseId);
    if (ids.length) await setWantFolder(ids, null);
  }
}

// ---------- Warteschlange ----------
// Einsortieren wirkt sofort auf dem Gerät. Discogs wird im Hintergrund nachgezogen, eine Anfrage nach der
// anderen. Die offenen Schritte liegen im Speicher: geht die App zu oder bricht das Netz weg, geht es beim
// nächsten Start (oder wenn das Netz zurück ist) an derselben Stelle weiter.
type Pending = ({ t: "move"; instanceId: number; releaseId: number; from: number; to: number } | { t: "note"; releaseId: number; notes: string; rating: number } | { t: "del"; folderId: number }) & { tries?: number };
const QKEY = "folderQueue";
export const pendingFolderOps = () => getKV<Pending[]>(QKEY, []);

async function push(items: Pending[]) {
  const q = await pendingFolderOps();
  for (const it of items) {
    if (it.t === "move") {
      // Schon unterwegs? Dann nur das Ziel ändern, der Ausgangsordner bei Discogs bleibt der alte
      const i = q.findIndex((x) => x.t === "move" && x.instanceId === it.instanceId);
      if (i >= 0) {
        const prev = q[i] as Extract<Pending, { t: "move" }>;
        // Vorderster Schritt ist evtl. gerade unterwegs: nicht ändern, sondern vom alten Ziel aus weiter
        if (running && i === 0) {
          if (prev.to !== it.to) q.push({ ...it, from: prev.to });
          continue;
        }
        if (prev.from === it.to) q.splice(i, 1);
        else q[i] = { ...prev, to: it.to, tries: 0 };
        continue;
      }
    }
    if (it.t === "note") {
      const i = q.findIndex((x) => x.t === "note" && x.releaseId === it.releaseId);
      if (i >= 0) {
        q[i] = it;
        continue;
      }
    }
    q.push(it);
  }
  await setKV(QKEY, q);
  void resumeFolderQueue();
}

let running = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Offene Ordner-Schritte zu Discogs schicken. Läuft nur einmal gleichzeitig. */
export async function resumeFolderQueue() {
  if (running || !username()) return;
  running = true;
  clearTimeout(retryTimer);
  let done = 0;
  try {
    for (;;) {
      const q = await pendingFolderOps();
      if (!q.length) break;
      jobUpdate("folders", { label: "Ordner zu Discogs", done, total: done + q.length });
      const it = q[0];
      let drop = true;
      try {
        if (it.t === "move") await discogs(`/users/${u()}/collection/folders/${it.from}/releases/${it.releaseId}/instances/${it.instanceId}`, { method: "POST", body: { folder_id: it.to }, retry: true });
        else if (it.t === "note") await discogs(`/users/${u()}/wants/${it.releaseId}`, { method: "POST", body: { notes: it.notes, rating: it.rating }, retry: true });
        else await discogs(`/users/${u()}/collection/folders/${it.folderId}`, { method: "DELETE", retry: true });
        done++;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        // Netz weg, Discogs überlastet oder Zeit abgelaufen: später weiter, nichts verwerfen
        const transient = status === 0 || status === 408 || status === 429 || status >= 500;
        if (transient && (it.tries ?? 0) < 8) {
          drop = false;
          const cur = await pendingFolderOps();
          if (cur[0] && JSON.stringify(cur[0]) === JSON.stringify(it)) await setKV(QKEY, [{ ...it, tries: (it.tries ?? 0) + 1 }, ...cur.slice(1)]);
          retryTimer = setTimeout(() => void resumeFolderQueue(), 30_000);
          break;
        }
        await logError("Ordner", e);
      } finally {
        if (drop) await settle(it);
      }
    }
  } finally {
    running = false;
    jobUpdate("folders", null);
  }
}

/** Erledigten Schritt entfernen. Wurde er inzwischen geändert (anderes Ziel, neue Notiz), bleibt der Rest stehen. */
async function settle(it: Pending) {
  const cur = await pendingFolderOps();
  const head = cur[0];
  const same = (x: Pending) => JSON.stringify({ ...x, tries: 0 }) === JSON.stringify({ ...it, tries: 0 });
  if (!head) return;
  if (same(head)) return setKV(QKEY, cur.slice(1));
  if (it.t === "move" && head.t === "move" && head.instanceId === it.instanceId) {
    // Liegt jetzt bei Discogs im alten Ziel: von dort weiter
    return setKV(QKEY, head.to === it.to ? cur.slice(1) : [{ ...head, from: it.to, tries: 0 }, ...cur.slice(1)]);
  }
  // Notiz wurde geändert: neue Fassung bleibt vorne und wird als nächstes geschickt
}

async function moveInstances(items: { instanceId: number; releaseId: number; folderId: number }[], to: number) {
  const todo = items.filter((it) => it.folderId !== to);
  // Sofort auf dem Gerät umsortieren, Discogs folgt
  await db.transaction("rw", db.collection, async () => {
    for (const it of todo) await db.collection.update(it.instanceId, { folderId: to });
  });
  await push(todo.map((it) => ({ t: "move" as const, instanceId: it.instanceId, releaseId: it.releaseId, from: it.folderId, to })));
  return new Set(todo.map((it) => it.releaseId)).size;
}

/** Platten (alle Exemplare) in einen Ordner verschieben. NO_FOLDER = aus dem Ordner nehmen. */
export async function moveToFolder(releaseIds: number[], to: number) {
  const items = await db.collection.where("releaseId").anyOf(releaseIds).toArray();
  return moveInstances(items, to);
}

/** Wants einem Ordner zuordnen (null = ohne Ordner). Schreibt die Marke in die Discogs-Notiz. */
export async function setWantFolder(releaseIds: number[], folder: string | null) {
  const items: Pending[] = [];
  for (const id of releaseIds) {
    const w = await db.wants.get(id);
    if (!w) continue;
    const notes = withWantFolder(w.notes, folder);
    if (notes === (w.notes ?? "")) continue;
    await db.wants.update(id, { notes });
    items.push({ t: "note", releaseId: id, notes, rating: w.rating ?? 0 });
  }
  await push(items);
  return items.length;
}

/** Nach einem Sync: noch nicht übertragene Änderungen wieder lokal anwenden (sonst springt die Platte zurück) */
export async function reapplyPending() {
  for (const it of await pendingFolderOps()) {
    if (it.t === "move") await db.collection.update(it.instanceId, { folderId: it.to });
    else if (it.t === "note") await db.wants.update(it.releaseId, { notes: it.notes });
  }
}

/** Beim Kauf: Ordner des Wants, sonst ohne Ordner */
export async function folderForNewRecord(releaseId: number): Promise<number> {
  const w = await db.wants.get(releaseId);
  const name = wantFolderOf(w?.notes);
  if (!name) return NO_FOLDER;
  try {
    return await folderIdFor(name);
  } catch {
    return NO_FOLDER;
  }
}

/** Wirkt sofort auf dem Gerät, Discogs folgt im Hintergrund (Fortschritt unten in der Leiste) */
export function runFolderJob(_label: string, job: () => Promise<number>) {
  job().then(
    (n) => n > 0 && toast(n === 1 ? "Eine Platte einsortiert" : `${n} Platten einsortiert`),
    (e) => toast((e as Error).message),
  );
}
