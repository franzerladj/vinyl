// Abgleich eigener Daten zwischen Geräten (Handy, Laptop …), Logik in shared/devsync.ts.
// Jede lokale Änderung an Tracks, Sets, Regal-Daten, Wunschpreisen, Händlern, Freunden und einigen
// Einstellungen landet als Patch in einem Ausgang und wird gesammelt hochgeladen. Beim Start und wenn die
// App wieder in den Vordergrund kommt, holt das Gerät die Änderungen der anderen Geräte ab.
import Dexie, { type Table } from "dexie";
import { db, getKV, setKV, type DJSet } from "./db";
import { jobUpdate, username } from "./store";
import { compact, definedOnly, SYNC_KV, type Patch, type SyncOp, type SyncTable } from "../../../shared/devsync";

const OUTBOX = "devsyncOutbox";
const SEQ = "devsyncSeq";
const INIT = "devsyncInit";
const LAST = "devsyncLast";
/** Auf diesem Gerät ausgeschaltet (bleibt lokal) */
const OFF = "devsyncOff";
export const devSyncOff = () => getKV<boolean>(OFF, false);

let outbox: SyncOp[] = [];
let outboxUser = "";
/** Transaktion, in der abgeholte Daten geschrieben werden (die eigenen Hooks schweigen dann) */
let applyingTx: unknown = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

const quiet = () => applyingTx !== null && Dexie.currentTransaction === applyingTx;

let off = false;
function record(op: SyncOp) {
  if (quiet() || off) return;
  outbox.push(op);
  // Außerhalb der laufenden Transaktion speichern und später hochladen
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persistOutbox(), 400);
  // Spätestens nach 4 s hochladen, auch wenn im Hintergrund laufend weitere Änderungen dazukommen
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, 4000);
}

const persistOutbox = () => setKV(OUTBOX, { user: outboxUser, ops: compact(outbox) });

/** Welche Tabelle unter welchem Schlüssel abgeglichen wird */
const keyOf: Record<Exclude<SyncTable, "kv">, (pk: unknown, obj: Record<string, unknown>) => string | null> = {
  tracks: (pk) => String(pk),
  // Sets zählen lokal hoch (1, 2, 3 …), das passt auf zwei Geräten nicht zusammen: Schlüssel ist der Anlegezeitpunkt
  sets: (_pk, obj) => (obj?.createdAt ? String(obj.createdAt) : null),
  recordMeta: (pk) => String(pk),
  wantMeta: (pk) => String(pk),
  sellers: (pk) => String(pk),
  friends: (pk) => String(pk),
};
const DROP: Partial<Record<SyncTable, string[]>> = { sets: ["id"] };

function hook(name: Exclude<SyncTable, "kv">) {
  const table = (db as unknown as Record<string, Table<Record<string, unknown>, unknown>>)[name];
  table.hook("creating", (pk, obj) => {
    const k = keyOf[name](pk, obj);
    if (k) record({ t: name, k, ts: Date.now(), patch: definedOnly(obj, DROP[name]) });
  });
  table.hook("updating", (mods, pk, obj) => {
    const k = keyOf[name](pk, obj);
    if (!k) return;
    const patch: Patch = {};
    for (const [f, v] of Object.entries(mods)) if (!f.includes(".") && !(DROP[name] ?? []).includes(f)) patch[f] = v === undefined ? null : v;
    if (Object.keys(patch).length) record({ t: name, k, ts: Date.now(), patch });
  });
  table.hook("deleting", (pk, obj) => {
    const k = keyOf[name](pk, obj ?? {});
    if (k) record({ t: name, k, ts: Date.now(), del: true });
  });
}

function hookKV() {
  // Hooks dürfen nichts zurückgeben: ein Rückgabewert von „creating“ würde sonst zum Schlüssel
  const onWrite = (key: unknown, value: unknown) => {
    if (SYNC_KV.has(String(key))) record({ t: "kv", k: String(key), ts: Date.now(), patch: { value: value ?? null } });
  };
  db.kv.hook("creating", (pk, obj) => {
    onWrite(pk ?? obj.key, obj.value);
  });
  db.kv.hook("updating", (mods, pk) => {
    if ("value" in mods) onWrite(pk, (mods as { value?: unknown }).value);
  });
  db.kv.hook("deleting", (pk) => {
    if (SYNC_KV.has(String(pk))) record({ t: "kv", k: String(pk), ts: Date.now(), del: true });
  });
}

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  (Object.keys(keyOf) as Exclude<SyncTable, "kv">[]).forEach(hook);
  hookKV();
}
// Gleich beim Laden: Änderungen vor dem Start (z. B. beim ersten Sync) gehen sonst verloren
installHooks();

let flushing: Promise<void> | null = null;
/** Ausgang hochladen */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const u = username().toLowerCase();
      if (!u || outboxUser !== u) return;
      for (let round = 0; round < 40 && outbox.length; round++) {
        // Nur was jetzt im Ausgang liegt; was während des Hochladens dazukommt, bleibt hinten dran
        const taken = outbox.length;
        const all = compact(outbox.slice(0, taken));
        const ops = all.slice(0, 300);
        const r = await fetch("/api/sync/push", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }), keepalive: ops.length < 60 });
        // 400: kaputte Daten nicht ewig wiederholen; andere Fehler (offline, 401, 5xx): später nochmal
        if (!r.ok && r.status !== 400) break;
        outbox = [...all.slice(300), ...outbox.slice(taken)];
        if (r.ok) await setKV(LAST, Date.now());
      }
    } catch {
      /* offline: beim nächsten Mal */
    } finally {
      await persistOutbox().catch(() => undefined);
      flushing = null;
    }
  })();
  return flushing;
}

interface PullRow {
  t: SyncTable;
  k: string;
  v: Patch | null;
  ts: number;
}

/** Änderungen der anderen Geräte abholen und einspielen */
export async function pull(): Promise<number> {
  let since = await getKV<number>(SEQ, 0);
  let applied = 0;
  for (let round = 0; round < 50; round++) {
    const r = await fetch(`/api/sync/pull?since=${since}`, { credentials: "include" });
    if (!r.ok) throw new Error(`Abgleich ${r.status}`);
    const res = (await r.json()) as { seq: number; more: boolean; rows: PullRow[] };
    if (!Array.isArray(res.rows) || typeof res.seq !== "number") break;
    if (res.rows.length) applied += await applyRows(res.rows);
    since = res.seq;
    await setKV(SEQ, since);
    if (!res.more) break;
  }
  return applied;
}

async function applyRows(rows: PullRow[]) {
  let n = 0;
  await db.transaction("rw", [db.tracks, db.sets, db.recordMeta, db.wantMeta, db.sellers, db.friends, db.kv], async (tx) => {
    applyingTx = Dexie.currentTransaction ?? tx;
    try {
      for (const row of rows) {
        n++;
        if (row.t === "kv") {
          if (!SYNC_KV.has(row.k)) continue;
          if (row.v === null) await db.kv.delete(row.k);
          else await db.kv.put({ key: row.k, value: row.v.value });
          continue;
        }
        if (row.t === "sets") {
          const createdAt = Number(row.k);
          const local = await db.sets.where("createdAt").equals(createdAt).first();
          if (row.v === null) {
            if (local?.id) await db.sets.delete(local.id);
          } else await db.sets.put({ ...(local ?? {}), ...(row.v as unknown as DJSet), createdAt, id: local?.id });
          continue;
        }
        const table = (db as unknown as Record<string, Table<Record<string, unknown>, unknown>>)[row.t];
        const pk = row.t === "tracks" || row.t === "sellers" || row.t === "friends" ? row.k : Number(row.k);
        if (row.v === null) {
          await table.delete(pk);
          continue;
        }
        const local = await table.get(pk);
        const keyField = row.t === "tracks" ? "id" : row.t === "sellers" ? "name" : row.t === "friends" ? "username" : "releaseId";
        // Tracks ohne lokale Platte trotzdem anlegen: sie kommen mit der Tracklist zusammen
        await table.put({ ...(local ?? {}), ...row.v, [keyField]: pk });
      }
    } finally {
      applyingTx = null;
    }
  });
  return n;
}

/** Erstes Mal auf diesem Gerät: alles Eigene hochladen. Zeitstempel 1, damit echte Änderungen anderer Geräte gewinnen. */
async function initialUpload(ts = 1) {
  const ops: SyncOp[] = [];
  const add = (t: SyncTable, k: string | null, obj: Record<string, unknown>) => {
    if (!k) return;
    const patch = definedOnly(obj, DROP[t]);
    if (Object.keys(patch).length) ops.push({ t, k, ts, patch });
  };
  for (const name of Object.keys(keyOf) as Exclude<SyncTable, "kv">[]) {
    const table = (db as unknown as Record<string, Table<Record<string, unknown>, unknown>>)[name];
    const pkName = table.schema.primKey.name;
    for (const obj of await table.toArray()) {
      // Leere Track-Datensätze (nur Titel aus der Tracklist) bringen den anderen Geräten nichts
      if (name === "tracks" && obj.bpm == null && obj.key == null && obj.energy == null && !obj.stars && !obj.notes && !obj.cueIn && !obj.cueOut) continue;
      add(name, keyOf[name](obj[pkName], obj), obj);
    }
  }
  for (const key of SYNC_KV) {
    const row = await db.kv.get(key);
    if (row) ops.push({ t: "kv", k: key, ts, patch: { value: row.value } });
  }
  outbox.push(...ops);
  await flush();
}

/** Dieses Gerät als Vorlage für alle anderen: alles mit aktuellem Zeitstempel hochladen */
export const pushEverything = () => initialUpload(Date.now());

let syncing: Promise<void> | null = null;
/** Hochladen, dann abholen. Beim ersten Mal den Bestand des Geräts hochladen. */
export function syncNow(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    const u = username().toLowerCase();
    if (!u) return;
    await flush();
    const got = await pull();
    if ((await getKV<string | null>(INIT, null)) !== u) {
      // Nur beim ersten Mal sichtbar: das kann bei einer großen Sammlung ein paar Sekunden dauern
      jobUpdate("devsync", { label: "Geräte abgleichen", done: 0, total: 1 });
      try {
        await initialUpload();
        await setKV(INIT, u);
        await pull();
      } finally {
        jobUpdate("devsync", null);
      }
    }
    await setKV(LAST, Date.now());
    if (got) window.dispatchEvent(new CustomEvent("crate:devsync", { detail: got }));
  })().finally(() => (syncing = null));
  return syncing;
}

/** Nach dem Login: Ausgang laden, abgleichen, beim Zurückkommen in die App erneut */
export async function startDevSync() {
  const u = username().toLowerCase();
  if (!u || started) return;
  off = await devSyncOff();
  if (off) return;
  const saved = await getKV<{ user: string; ops: SyncOp[] } | null>(OUTBOX, null);
  outboxUser = u;
  // Ausgang eines anderen Kontos gehört nicht hierher
  outbox = saved && saved.user === u ? [...saved.ops, ...outbox] : outbox;
  started = true;
  await syncNow().catch(() => undefined);
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      void flush();
    } else if (Date.now() - hiddenAt > 15_000) void syncNow().catch(() => undefined);
  });
  window.addEventListener("online", () => void syncNow().catch(() => undefined));
  // Offen nebeneinander (Handy und Laptop): alle zwei Minuten nachsehen
  setInterval(() => !document.hidden && void syncNow().catch(() => undefined), 120_000);
}

export const lastDevSync = () => getKV<number>(LAST, 0);
export const pendingDevSync = () => outbox.length;

/** Abgleich auf diesem Gerät aus- oder einschalten */
export async function setDevSync(on: boolean) {
  off = !on;
  await setKV(OFF, !on);
  if (on) {
    // Beim Wiedereinschalten den Bestand neu hochladen, damit nichts fehlt
    await setKV(INIT, null);
    if (started) await syncNow();
    else await startDevSync();
  } else outbox = [];
}

/** Alles vom Server löschen und den Abgleich auf diesem Gerät ausschalten */
export async function deleteDevSyncData() {
  const r = await fetch("/api/sync", { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error(`Löschen ${r.status}`);
  await setDevSync(false);
  await setKV(SEQ, 0);
}
