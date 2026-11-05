// Ordner für Sammlung und Wantlist. Sammlung: echte Discogs-Ordner. Wantlist: Marke in der Notiz
// (siehe shared/folders.ts). Beide teilen sich eine Namensliste, die Discogs-Ordner.
import { useLiveQuery } from "dexie-react-hooks";
import { discogs } from "./api";
import { db, getKV, setKV } from "./db";
import { toast, username } from "./store";
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
  const list = await cachedFolders();
  const old = list.find((f) => f.id === id);
  const inside = await db.collection.where("folderId").equals(id).toArray();
  await moveInstances(inside, NO_FOLDER);
  await discogs(`/users/${u()}/collection/folders/${id}`, { method: "DELETE" });
  await setKV(KEY, (await cachedFolders()).filter((f) => f.id !== id));
  if (old) {
    const ids = (await db.wants.toArray()).filter((w) => sameFolder(wantFolderOf(w.notes), old.name)).map((w) => w.releaseId);
    if (ids.length) await setWantFolder(ids, null);
  }
}

async function moveInstances(items: { instanceId: number; releaseId: number; folderId: number }[], to: number) {
  let moved = 0;
  for (const it of items) {
    if (it.folderId === to) continue;
    await discogs(`/users/${u()}/collection/folders/${it.folderId}/releases/${it.releaseId}/instances/${it.instanceId}`, { method: "POST", body: { folder_id: to } });
    await db.collection.update(it.instanceId, { folderId: to });
    await bumpCount(it.folderId, -1);
    await bumpCount(to, 1);
    moved++;
  }
  return moved;
}

async function bumpCount(id: number, d: number) {
  const list = await cachedFolders();
  await setKV(KEY, list.map((f) => (f.id === id ? { ...f, count: Math.max(0, f.count + d) } : f)));
}

/** Platten (alle Exemplare) in einen Ordner verschieben. NO_FOLDER = aus dem Ordner nehmen. */
export async function moveToFolder(releaseIds: number[], to: number) {
  const items = await db.collection.where("releaseId").anyOf(releaseIds).toArray();
  return moveInstances(items, to);
}

/** Wants einem Ordner zuordnen (null = ohne Ordner). Schreibt die Marke in die Discogs-Notiz. */
export async function setWantFolder(releaseIds: number[], folder: string | null) {
  let n = 0;
  for (const id of releaseIds) {
    const w = await db.wants.get(id);
    if (!w) continue;
    const notes = withWantFolder(w.notes, folder);
    if (notes === (w.notes ?? "")) continue;
    await discogs(`/users/${u()}/wants/${id}`, { method: "POST", body: { notes, rating: w.rating ?? 0 } });
    await db.wants.update(id, { notes });
    n++;
  }
  return n;
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

/** Läuft im Hintergrund, meldet sich mit einer kurzen Nachricht */
export function runFolderJob(label: string, job: () => Promise<number>) {
  toast(label);
  job().then(
    (n) => n > 0 && toast(n === 1 ? "Eine Platte einsortiert" : `${n} Platten einsortiert`),
    (e) => toast((e as Error).message),
  );
}
