// Soziales im Feed: Speicher (Arbeitsspeicher und D1-SQL gegen echtes SQLite) und Routen
import { describe, expect, it } from "vitest";
import { BUZZ_SCHEMA, cleanText, d1Buzz, memoryBuzz, validPost, type BuzzStore } from "../server/buzz";
import type { D1Like } from "../server/devsync";
import { app } from "../server/app";
import { seal } from "../server/session";

async function sqlite(): Promise<D1Like | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    for (const s of BUZZ_SCHEMA) db.exec(s);
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

async function exercise(store: BuzzStore) {
  const post = "coll|2026-11-17";
  expect(await store.react({ owner: "anna", post, from: "franz", ts: 10 }, true)).toBe(true);
  expect(await store.react({ owner: "anna", post, from: "franz", ts: 11 }, true)).toBe(false); // schon gesetzt
  const id = await store.comment({ owner: "anna", post, from: "franz", text: "Wo hast du die her?", ts: 12 });
  expect(id).toBeGreaterThan(0);
  await store.comment({ owner: "bob", post, from: "franz", text: "x", ts: 13 });
  const seen = await store.forOwners(["anna"], 0);
  expect(seen.reactions).toEqual([{ owner: "anna", post, from: "franz", ts: 10 }]);
  expect(seen.comments.map((c) => c.text)).toEqual(["Wo hast du die her?"]);
  expect(await store.commentsSince("franz", 0)).toBe(2);
  await store.notify({ to: "anna", from: "franz", kind: "react", post, releaseId: 5, title: "A – B", ts: 20 });
  await store.notify({ to: "anna", from: "franz", kind: "recommend", releaseId: 6, title: "C – D", text: "Hör rein", ts: 30 });
  const inbox = await store.inbox("anna", 10);
  expect(inbox.map((i) => [i.kind, i.read])).toEqual([["recommend", false], ["react", false]]);
  await store.markRead("anna");
  expect((await store.inbox("anna", 10)).every((i) => i.read)).toBe(true);
  expect(await store.react({ owner: "anna", post, from: "franz", ts: 40 }, false)).toBe(true);
  expect((await store.getComment(id))?.from).toBe("franz");
  await store.deleteComment(id);
  expect(await store.getComment(id)).toBeNull();
  await store.clear("franz");
  expect((await store.forOwners(["anna", "bob"], 0)).comments).toEqual([]);
  expect(await store.inbox("anna", 10)).toEqual([]);
}

describe("Soziales: Speicher", () => {
  it("Arbeitsspeicher", async () => exercise(memoryBuzz()));
  it("D1-Abfragen gegen SQLite", async () => {
    const db = await sqlite();
    if (!db) return;
    await exercise(d1Buzz(db));
  });
  it("prüft Beitrags-Schlüssel und säubert Text", () => {
    expect(validPost("coll|2026-11-17")).toBe(true);
    expect(validPost("coll|2026-11-17' OR 1=1")).toBe(false);
    expect(cleanText("  Hallo\n\u0000 Welt  ", 8)).toBe("Hallo We");
  });
});

describe("Soziales: Routen", () => {
  const SECRET = "x".repeat(32);
  const ORIGIN = "https://crate.example";
  const kv = new Map<string, string>();
  const env = {
    SESSION_SECRET: SECRET,
    APP_URL: ORIGIN,
    PUSH: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k), list: async () => ({ keys: [], list_complete: true }) },
  };
  const cookie = async (u: string) => `crate_session=${await seal(SECRET, { token: "t", secret: "s", username: u, verified: true, iat: Date.now() })}`;
  const post = async (u: string, path: string, body: unknown) => app.request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie(u) }, body: JSON.stringify(body) }, env);
  const get = async (u: string) => (await app.request(`${ORIGIN}/api/buzz`, { headers: { Cookie: await cookie(u) } }, env)).json() as Promise<{ reactions: { from: string }[]; comments: { id: number; text: string }[]; inbox: { kind: string; from: string; title: string | null }[]; unread: number }>;

  it("nur unter Freunden, mit Aktivität beim Empfänger", async () => {
    kv.set("soc:franz", JSON.stringify({ friends: ["Anna"], in: [], out: [] }));
    kv.set("soc:anna", JSON.stringify({ friends: ["franz"], in: [], out: [] }));
    const p = "coll|2026-11-17";
    expect((await post("franz", "/api/buzz/react", { owner: "fremd", post: p })).status).toBe(403);
    expect((await post("franz", "/api/buzz/react", { owner: "Anna", post: "kaputt" })).status).toBe(400);
    expect((await post("franz", "/api/buzz/react", { owner: "Anna", post: p, title: "Theo Parrish – Sound Sculptures", releaseId: 7 })).status).toBe(200);
    const c = await post("franz", "/api/buzz/comment", { owner: "Anna", post: p, text: "  Stark!  ", title: "Theo Parrish – Sound Sculptures" });
    expect(c.status).toBe(200);
    expect((await post("franz", "/api/buzz/recommend", { to: "anna", releaseId: 9, title: "Moodymann – Black Mahogani", text: "Für dich" })).status).toBe(200);
    expect((await post("franz", "/api/buzz/recommend", { to: "fremd", releaseId: 9, title: "x" })).status).toBe(403);
    const anna = await get("anna");
    expect(anna.reactions.map((r) => r.from)).toEqual(["franz"]);
    expect(anna.comments.map((x) => x.text)).toEqual(["Stark!"]);
    expect(anna.inbox.map((i) => i.kind).sort()).toEqual(["comment", "react", "recommend"]);
    expect(anna.unread).toBe(3);
    await post("anna", "/api/buzz/read", {});
    expect((await get("anna")).unread).toBe(0);
    // Wem der Beitrag gehört, darf den Kommentar löschen; Fremde nicht
    const id = anna.comments[0].id;
    const del = async (u: string) => (await app.request(`${ORIGIN}/api/buzz/comment/${id}`, { method: "DELETE", headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie(u) } }, env)).status;
    expect(await del("bob")).toBe(404);
    expect(await del("anna")).toBe(200);
    expect((await get("franz")).comments).toEqual([]);
  });
  it("ohne Anmeldung nichts", async () => {
    expect((await app.request(`${ORIGIN}/api/buzz`, {}, env)).status).toBe(401);
  });
});
