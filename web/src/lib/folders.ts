// Ordner für Sammlung und Wantlist. Eine Platte kann in mehreren liegen (siehe shared/folders.ts):
// Sammlung: der erste ist der echte Discogs-Ordner, weitere stehen als Marke in der Notiz des Exemplars.
// Wantlist: nur Marken in der Notiz. Beide teilen sich eine Namensliste, die Discogs-Ordner.
import { useLiveQuery } from "dexie-react-hooks";
import { ApiError, discogs } from "./api";
import { logError } from "./pool";
import { db, getKV, setKV } from "./db";
import { jobUpdate, toast, username } from "./store";
import { addFolder, cleanFolderName, customFolders, filedNames, filedOf, NO_FOLDER, noteFolders, removeFolder, sameFolder, withFolders, type Filed, type Folder } from "../../../shared/folders";

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
      for (const w of await db.wants.toArray()) for (const n of noteFolders(w.notes)) if (!names.some((x) => sameFolder(x, n))) names.push(n);
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
  // Marken mit dem alten Namen mitnehmen (Wants und Platten, die zusätzlich in diesem Ordner liegen)
  if (old && !sameFolder(old.name, name)) await rewriteMarks((names) => names.map((x) => (sameFolder(x, old.name) ? name : x)), old.name);
}

/** Ordner-Marken in den Notizen von Wants und Platten umschreiben (Umbenennen, Löschen) */
async function rewriteMarks(change: (names: string[]) => string[], only: string) {
  const items: Pending[] = [];
  for (const w of await db.wants.toArray()) {
    const cur = noteFolders(w.notes);
    if (!cur.some((x) => sameFolder(x, only))) continue;
    const notes = withFolders(w.notes, change(cur));
    await db.wants.update(w.releaseId, { notes });
    items.push({ t: "note", releaseId: w.releaseId, notes, rating: w.rating ?? 0 });
  }
  for (const c of await db.collection.toArray()) {
    const cur = noteFolders(c.note);
    if (!cur.some((x) => sameFolder(x, only))) continue;
    const note = withFolders(c.note, change(cur));
    await db.collection.update(c.instanceId, { note: note || undefined });
    items.push({ t: "cnote", instanceId: c.instanceId, releaseId: c.releaseId, note });
  }
  if (items.length) await push(items);
}

/**
 * Ordner löschen: die Platten bleiben, nur ohne diesen Ordner. Liegt eine noch in einem anderen, rückt der nach,
 * sonst wandert sie nach „Ohne Ordner“ (Discogs löscht nur leere Ordner). Wants und Zweit-Ordner verlieren die Marke.
 */
export async function deleteFolder(id: number) {
  if (id <= NO_FOLDER) return;
  const old = (await cachedFolders()).find((f) => f.id === id);
  const inside = await db.collection.where("folderId").equals(id).toArray();
  if (old) await fileRecords([...new Set(inside.map((c) => c.releaseId))], old.name, false);
  // Was (bei unbekanntem Namen) noch drin liegt, nach „Ohne Ordner“
  await moveInstances(await db.collection.where("folderId").equals(id).toArray(), NO_FOLDER);
  // Erst wenn die Platten draußen sind, den Ordner bei Discogs löschen (in der Warteschlange hinten an)
  await setKV(KEY, (await cachedFolders()).filter((f) => f.id !== id));
  await push([{ t: "del", folderId: id }]);
  if (old) await rewriteMarks((names) => names.filter((x) => !sameFolder(x, old.name)), old.name);
}

// ---------- Warteschlange ----------
// Einsortieren wirkt sofort auf dem Gerät. Discogs wird im Hintergrund nachgezogen, eine Anfrage nach der
// anderen. Die offenen Schritte liegen im Speicher: geht die App zu oder bricht das Netz weg, geht es beim
// nächsten Start (oder wenn das Netz zurück ist) an derselben Stelle weiter.
type Pending = (
  | { t: "move"; instanceId: number; releaseId: number; from: number; to: number }
  | { t: "note"; releaseId: number; notes: string; rating: number }
  // Notiz eines Exemplars der Sammlung (weitere Ordner als Marke)
  | { t: "cnote"; instanceId: number; releaseId: number; note: string }
  | { t: "del"; folderId: number }
) & { tries?: number };
const QKEY = "folderQueue";
export const pendingFolderOps = () => getKV<Pending[]>(QKEY, []);

// Die Warteschlange wird gelesen, geändert und zurückgeschrieben. Passiert das an zwei Stellen gleichzeitig
// (neues Einsortieren, während ein Schritt gerade fertig wird), ginge sonst ein Schritt verloren: nacheinander ausführen.
let queueLock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const p = queueLock.then(fn, fn);
  queueLock = p.catch(() => undefined);
  return p;
}

async function push(items: Pending[]) {
  await locked(() => pushLocked(items));
  void resumeFolderQueue();
}

async function pushLocked(items: Pending[]) {
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
    if (it.t === "cnote") {
      // Neuere Fassung ersetzt die wartende (die vorderste ist evtl. gerade unterwegs: dann hinten anstellen)
      const i = q.findIndex((x, k) => x.t === "cnote" && x.instanceId === it.instanceId && !(running && k === 0));
      if (i >= 0) {
        q[i] = it;
        continue;
      }
    }
    q.push(it);
  }
  await setKV(QKEY, q);
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
        else if (it.t === "cnote") {
          // Discogs will den Ordner, in dem das Exemplar gerade wirklich liegt (ein Verschieben kann noch hinten anstehen)
          const row = await db.collection.get(it.instanceId);
          const mv = q.find((x) => x.t === "move" && x.instanceId === it.instanceId) as Extract<Pending, { t: "move" }> | undefined;
          const folder = mv ? mv.from : row?.folderId;
          // Geschickt wird die Notiz, wie sie jetzt auf dem Gerät steht: inzwischen kann z. B. ein Kaufpreis dazugekommen sein.
          // Platte inzwischen aus der Sammlung entfernt: nichts mehr zu tun
          if (row && folder != null) await discogs(`/users/${u()}/collection/folders/${folder}/releases/${it.releaseId}/instances/${it.instanceId}/fields/3`, { method: "POST", body: { value: row.note ?? "" }, retry: true });
        }
        else await discogs(`/users/${u()}/collection/folders/${it.folderId}`, { method: "DELETE", retry: true });
        done++;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        // Netz weg, Discogs überlastet oder Zeit abgelaufen: später weiter, nichts verwerfen
        const transient = status === 0 || status === 408 || status === 429 || status >= 500;
        if (transient && (it.tries ?? 0) < 8) {
          drop = false;
          await locked(async () => {
            const cur = await pendingFolderOps();
            if (cur[0] && JSON.stringify(cur[0]) === JSON.stringify(it)) await setKV(QKEY, [{ ...it, tries: (it.tries ?? 0) + 1 }, ...cur.slice(1)]);
          });
          retryTimer = setTimeout(() => void resumeFolderQueue(), 30_000);
          break;
        }
        await logError("Ordner", e);
      } finally {
        if (drop) await locked(() => settle(it));
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

/** Ordner einer Platte der Sammlung (alle Exemplare zusammen), der echte Discogs-Ordner zuerst */
export function recordFolders(copies: { folderId: number; note?: string }[], folders: Folder[]): string[] {
  const out: string[] = [];
  for (const c of copies) {
    const primary = folders.find((f) => f.id === c.folderId && f.id > NO_FOLDER)?.name ?? null;
    for (const n of filedNames(filedOf(primary, c.note))) if (!out.some((x) => sameFolder(x, n))) out.push(n);
  }
  return out;
}

/** Je Platte die Nummern aller Ordner, in denen sie liegt (für die Auswahl „Platten aus“ im Set) */
export function folderIdsByRelease(coll: { releaseId: number; folderId: number; note?: string }[], folders: Folder[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const c of coll) {
    const ids = out.get(c.releaseId) ?? [];
    const add = (id: number) => void (ids.includes(id) || ids.push(id));
    add(c.folderId);
    for (const n of noteFolders(c.note)) {
      const f = folders.find((x) => x.id > NO_FOLDER && sameFolder(x.name, n));
      if (f) add(f.id);
    }
    out.set(c.releaseId, ids);
  }
  return out;
}

/**
 * Platten der Sammlung in einen Ordner legen (on) oder herausnehmen. Andere Ordner der Platte bleiben.
 * Der erste Ordner ist der echte Discogs-Ordner, jeder weitere eine Marke in der Notiz.
 * Wirkt sofort auf dem Gerät, Discogs folgt über die Warteschlange.
 */
export async function fileRecords(releaseIds: number[], rawName: string, on: boolean): Promise<number> {
  const name = cleanFolderName(rawName);
  if (!name || !releaseIds.length) return 0;
  // Den Ordner gibt es bei Discogs vielleicht noch nicht (bisher nur auf der Wantlist benutzt)
  if (on) await folderIdFor(name);
  const folders = await cachedFolders();
  const idOf = (n: string | null) => (n ? (folders.find((f) => f.id > NO_FOLDER && sameFolder(f.name, n))?.id ?? null) : NO_FOLDER);
  const copies = await db.collection.where("releaseId").anyOf(releaseIds).toArray();
  const ops: Pending[] = [];
  const touched = new Set<number>();
  for (const c of copies) {
    const primary = folders.find((f) => f.id === c.folderId && f.id > NO_FOLDER)?.name ?? null;
    const cur: Filed = filedOf(primary, c.note);
    const next = on ? addFolder(cur, name) : removeFolder(cur, name);
    const patch: { folderId?: number; note?: string | undefined } = {};
    if (!sameFolder(next.primary, cur.primary) && (next.primary || cur.primary)) {
      // Rückt ein Ordner nach, den es bei Discogs nicht (mehr) gibt, wird er dort angelegt
      const to = idOf(next.primary) ?? (await folderIdFor(next.primary!));
      if (to !== c.folderId) {
        patch.folderId = to;
        ops.push({ t: "move", instanceId: c.instanceId, releaseId: c.releaseId, from: c.folderId, to });
      }
    }
    const note = withFolders(c.note, next.extra);
    if (note !== (c.note ?? "")) {
      patch.note = note || undefined;
      ops.push({ t: "cnote", instanceId: c.instanceId, releaseId: c.releaseId, note });
    }
    if ("folderId" in patch || "note" in patch) {
      await db.collection.update(c.instanceId, patch);
      touched.add(c.releaseId);
    }
  }
  if (ops.length) await push(ops);
  return touched.size;
}

/** Wants in einen Ordner legen (on) oder herausnehmen. Schreibt die Marken in die Discogs-Notiz. */
export async function fileWants(releaseIds: number[], rawName: string, on: boolean): Promise<number> {
  const name = cleanFolderName(rawName);
  if (!name) return 0;
  const items: Pending[] = [];
  for (const id of releaseIds) {
    const w = await db.wants.get(id);
    if (!w) continue;
    const cur = noteFolders(w.notes);
    const next = on ? (cur.some((x) => sameFolder(x, name)) ? cur : [...cur, name]) : cur.filter((x) => !sameFolder(x, name));
    const notes = withFolders(w.notes, next);
    if (notes === (w.notes ?? "")) continue;
    await db.wants.update(id, { notes });
    items.push({ t: "note", releaseId: id, notes, rating: w.rating ?? 0 });
  }
  await push(items);
  return items.length;
}

/** Aus allen Ordnern nehmen */
export async function unfileAll(kind: "coll" | "want", releaseId: number): Promise<number> {
  if (kind === "want") {
    const w = await db.wants.get(releaseId);
    let n = 0;
    for (const f of noteFolders(w?.notes)) n += await fileWants([releaseId], f, false);
    return n ? 1 : 0;
  }
  const names = recordFolders(await db.collection.where("releaseId").equals(releaseId).toArray(), await cachedFolders());
  let n = 0;
  for (const f of names) n += await fileRecords([releaseId], f, false);
  return n ? 1 : 0;
}

/** Wants einem einzigen Ordner zuordnen (null = ohne Ordner): ersetzt alle bisherigen */
export async function setWantFolder(releaseIds: number[], folder: string | null) {
  const items: Pending[] = [];
  for (const id of releaseIds) {
    const w = await db.wants.get(id);
    if (!w) continue;
    const notes = withFolders(w.notes, folder ? [folder] : []);
    if (notes === (w.notes ?? "")) continue;
    await db.wants.update(id, { notes });
    items.push({ t: "note", releaseId: id, notes, rating: w.rating ?? 0 });
  }
  await push(items);
  return items.length;
}

/** Ordner, in dem das Exemplar bei Discogs gerade wirklich liegt (Verschiebung kann noch unterwegs sein) */
export async function discogsFolderOf(instanceId: number, local: number) {
  const mv = (await pendingFolderOps()).find((x) => x.t === "move" && x.instanceId === instanceId) as Extract<Pending, { t: "move" }> | undefined;
  return mv ? mv.from : local;
}

/** Nach einem Sync: noch nicht übertragene Änderungen wieder lokal anwenden (sonst springt die Platte zurück) */
export async function reapplyPending() {
  for (const it of await pendingFolderOps()) {
    if (it.t === "move") await db.collection.update(it.instanceId, { folderId: it.to });
    else if (it.t === "note") await db.wants.update(it.releaseId, { notes: it.notes });
    else if (it.t === "cnote") {
      // Nur die Ordner-Marken zurückholen: der Rest der Notiz (z. B. Kaufpreis) kommt frisch von Discogs
      const row = await db.collection.get(it.instanceId);
      if (row) await db.collection.update(it.instanceId, { note: withFolders(row.note, noteFolders(it.note)) || undefined });
    }
  }
}

/** Beim Kauf: weitere Ordner des Wants (der erste ist der Discogs-Ordner, siehe folderForNewRecord) */
export async function extraFoldersForNewRecord(releaseId: number): Promise<string[]> {
  return noteFolders((await db.wants.get(releaseId))?.notes).slice(1);
}

/** Beim Kauf: erster Ordner des Wants, sonst ohne Ordner */
export async function folderForNewRecord(releaseId: number): Promise<number> {
  const w = await db.wants.get(releaseId);
  const name = noteFolders(w?.notes)[0];
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
