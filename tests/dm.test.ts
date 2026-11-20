// Nachrichten unter Freunden: Speicher (Arbeitsspeicher und D1-SQL gegen echtes SQLite) und Routen
import { describe, expect, it } from "vitest";
import { DM_SCHEMA, d1Dm, dmNotice, memoryDm, pairOf, type DmStore } from "../server/dm";
import type { D1Like } from "../server/devsync";
import { app } from "../server/app";
import { seal } from "../server/session";
import { daysUntilReview, reviewIsOpen, reviewSeason } from "../shared/year";

async function sqlite(): Promise<D1Like | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    for (const s of DM_SCHEMA) db.exec(s);
    const stmt = (sql: string) => ({
      bind: (...v: unknown[]) => {
        const p = db.prepare(sql);
        const args = v as (string | number | null)[];
        return {
          all: async <T,>() => ({ results: p.all(...args) as T[] }),
          first: async <T,>() => (p.get(...args) as T) ?? null,
          run: async () => p.run(...args),
        };
      },
    });
    return { prepare: stmt, batch: async (stmts: unknown[]) => Promise.all((stmts as { run(): Promise<unknown> }[]).map((s) => s.run())) };
  } catch {
    return null;
  }
}

async function exercise(store: DmStore) {
  expect(pairOf("Franz", "anna")).toBe("anna|franz");
  const a = await store.send({ from: "franz", to: "anna", kind: "text", text: "Hi", ts: 10 });
  const b = await store.send({ from: "anna", to: "franz", kind: "borrow", releaseId: 7, title: "Theo Parrish – Sound Sculptures", thumb: "https://i.discogs.com/x.jpg", ts: 20 });
  await store.send({ from: "bob", to: "franz", kind: "text", text: "Na?", ts: 30 });
  await store.send({ from: "anna", to: "bob", kind: "text", text: "geht franz nichts an", ts: 40 });
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const t = await store.thread("franz", "anna", 50);
  expect(t.map((m) => [m.from, m.kind, m.read])).toEqual([["franz", "text", false], ["anna", "borrow", false]]);
  expect(t[1]).toMatchObject({ releaseId: 7, title: "Theo Parrish – Sound Sculptures", thumb: "https://i.discogs.com/x.jpg" });
  // Blättern: nur was vor einer Nachricht lag
  expect((await store.thread("franz", "anna", 50, b)).map((m) => m.id)).toEqual([a]);
  expect((await store.thread("franz", "anna", 1)).map((m) => m.id)).toEqual([b]);
  // Übersicht: neueste Unterhaltung zuerst, mit Ungelesenem je Gegenüber; fremde Unterhaltungen tauchen nicht auf
  const list = await store.threads("franz");
  expect(list.map((x) => [x.with, x.last.kind, x.unread])).toEqual([["bob", "text", 1], ["anna", "borrow", 1]]);
  expect(await store.unread("franz")).toBe(2);
  await store.markRead("franz", "anna");
  expect(await store.unread("franz")).toBe(1);
  expect((await store.thread("franz", "anna", 50)).map((m) => m.read)).toEqual([false, true]);
  expect(await store.sentSince("anna", 0)).toBe(2);
  expect((await store.get(a))?.from).toBe("franz");
  await store.remove(a);
  expect(await store.get(a)).toBeNull();
  await store.clear("franz");
  expect(await store.threads("franz")).toEqual([]);
  expect((await store.threads("anna")).map((x) => x.with)).toEqual(["bob"]);
}

describe("Nachrichten: Speicher", () => {
  it("Arbeitsspeicher", async () => exercise(memoryDm()));
  it("D1-Abfragen gegen SQLite", async () => {
    const db = await sqlite();
    if (!db) return;
    await exercise(d1Dm(db));
  });
  it("Text der Mitteilung", () => {
    expect(dmNotice("Anna", { kind: "text", text: "Kommst du Freitag?", title: null })).toEqual({ title: "Anna", body: "Kommst du Freitag?" });
    expect(dmNotice("Anna", { kind: "borrow", text: null, title: "A – B" })).toEqual({ title: "Anna möchte sich eine Platte leihen", body: "A – B" });
    expect(dmNotice("Anna", { kind: "yes", text: "Samstag?", title: "A – B" }).body).toBe("A – B: Samstag?");
    expect(dmNotice("Anna", { kind: "no", text: null, title: "A – B" }).title).toBe("Anna: Gerade nicht");
  });
});

describe("Nachrichten: Routen", () => {
  const SECRET = "x".repeat(32);
  const ORIGIN = "https://crate.example";
  const kv = new Map<string, string>();
  const env = {
    SESSION_SECRET: SECRET,
    APP_URL: ORIGIN,
    PUSH: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k), list: async () => ({ keys: [], list_complete: true }) },
  };
  const cookie = async (u: string, verified = true) => `crate_session=${await seal(SECRET, { token: "t", secret: "s", username: u, verified, iat: Date.now() })}`;
  const call = async (u: string, path: string, body?: unknown, method?: string) =>
    app.request(`${ORIGIN}${path}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie(u) }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

  it("schreiben nur unter Freunden, Leihanfrage und Antwort, lesen und löschen", async () => {
    kv.set("soc:dmfranz", JSON.stringify({ friends: ["DmAnna"], in: [], out: [] }));
    kv.set("soc:dmanna", JSON.stringify({ friends: ["dmfranz"], in: [], out: [] }));
    expect((await call("dmfranz", "/api/dm/fremd", { text: "Hallo" })).status).toBe(403);
    expect((await call("dmfranz", "/api/dm/dmfranz", { text: "Selbstgespräch" })).status).toBe(400);
    expect((await call("dmfranz", "/api/dm/DmAnna", { text: "   " })).status).toBe(400);
    // Leihanfrage ohne Platte geht nicht
    expect((await call("dmfranz", "/api/dm/DmAnna", { kind: "borrow", text: "Bitte" })).status).toBe(400);
    const r = await call("dmfranz", "/api/dm/DmAnna", { kind: "borrow", releaseId: 7, title: "Theo Parrish – Sound Sculptures", thumb: "https://evil.example/x.jpg", text: "  Fürs  Wochenende? " });
    expect(r.status).toBe(200);
    const sent = ((await r.json()) as { message: { id: number; text: string; thumb: string | null; kind: string } }).message;
    // Text gesäubert, fremde Bild-Adresse verworfen
    expect([sent.kind, sent.text, sent.thumb]).toEqual(["borrow", "Fürs Wochenende?", null]);
    const list = (await (await call("dmanna", "/api/dm")).json()) as { threads: { with: string; unread: number }[]; unread: number };
    expect(list).toMatchObject({ unread: 1, threads: [{ with: "dmfranz", unread: 1 }] });
    // Der Zähler steht auch in der Übersicht fürs Soziale (Punkt am Freunde-Tab)
    expect(((await (await call("dmanna", "/api/buzz")).json()) as { dm: number }).dm).toBe(1);
    expect((await call("dmanna", "/api/dm/dmfranz/read", {})).status).toBe(200);
    expect(((await (await call("dmanna", "/api/dm")).json()) as { unread: number }).unread).toBe(0);
    expect((await call("dmanna", "/api/dm/dmfranz", { kind: "yes", releaseId: 7, title: "Theo Parrish – Sound Sculptures" })).status).toBe(200);
    const thread = (await (await call("dmfranz", "/api/dm/dmanna")).json()) as { messages: { kind: string; from: string; read: boolean }[]; friends: boolean };
    expect(thread.friends).toBe(true);
    expect(thread.messages.map((m) => [m.from, m.kind, m.read])).toEqual([["dmfranz", "borrow", true], ["dmanna", "yes", false]]);
    // Löschen: nur die eigene Nachricht
    expect((await call("dmanna", `/api/dm/msg/${sent.id}`, undefined, "DELETE")).status).toBe(404);
    expect((await call("dmfranz", `/api/dm/msg/${sent.id}`, undefined, "DELETE")).status).toBe(200);
    // Dritte sehen nichts davon
    expect(((await (await call("dmbob", "/api/dm/dmanna")).json()) as { messages: unknown[]; friends: boolean })).toEqual({ messages: [], friends: false });
  });
  it("ohne bestätigte Anmeldung nichts", async () => {
    expect((await app.request(`${ORIGIN}/api/dm`, {}, env)).status).toBe(401);
    const r = await app.request(`${ORIGIN}/api/dm/dmanna`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie("dmfranz", false) }, body: JSON.stringify({ text: "Hi" }) }, env);
    expect(r.status).toBe(401);
  });
});

describe("Jahresrückblick: erst ab dem 15. Dezember", () => {
  const d = (s: string) => new Date(s);
  it("offen ab dem 15.12., davor zu", () => {
    expect(reviewIsOpen(2026, d("2026-11-20T12:00:00"))).toBe(false);
    expect(reviewIsOpen(2026, d("2026-12-14T23:00:00"))).toBe(false);
    expect(reviewIsOpen(2026, d("2026-12-15T00:00:00"))).toBe(true);
    expect(reviewIsOpen(2025, d("2026-03-01T12:00:00"))).toBe(true);
    expect(daysUntilReview(2026, d("2026-12-10T18:00:00"))).toBe(5);
    expect(daysUntilReview(2026, d("2026-12-20T18:00:00"))).toBe(0);
  });
  it("auf Start: Vorfreude im Dezember, offen bis Ende Januar, sonst nichts", () => {
    expect(reviewSeason(d("2026-11-30T12:00:00"))).toBeNull();
    expect(reviewSeason(d("2026-12-01T09:00:00"))).toEqual({ state: "soon", year: 2026, days: 14 });
    expect(reviewSeason(d("2026-12-14T09:00:00"))).toEqual({ state: "soon", year: 2026, days: 1 });
    expect(reviewSeason(d("2026-12-15T09:00:00"))).toEqual({ state: "open", year: 2026, days: 0 });
    expect(reviewSeason(d("2027-01-20T09:00:00"))).toEqual({ state: "open", year: 2026, days: 0 });
    expect(reviewSeason(d("2027-02-01T09:00:00"))).toBeNull();
  });
});
