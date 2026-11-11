import { describe, expect, it } from "vitest";
import { applyOp, compact, definedOnly, type SyncRow } from "../shared/devsync";

const row = (v: Record<string, unknown>, ts: number): SyncRow => ({ t: "tracks", k: "1:A", v, fts: Object.fromEntries(Object.keys(v).map((f) => [f, ts])), ts });

describe("Abgleich zwischen Geräten", () => {
  it("neuere Änderung gewinnt feldweise", () => {
    const r = applyOp(row({ bpm: 120, notes: "a" }, 10), { t: "tracks", k: "1:A", ts: 20, patch: { notes: "b" } });
    expect(r?.v).toEqual({ bpm: 120, notes: "b" });
    expect(applyOp(r, { t: "tracks", k: "1:A", ts: 15, patch: { notes: "alt" } })).toBeNull();
  });
  it("eine automatische Messung ersetzt nie einen eigenen Wert", () => {
    const manual = row({ bpm: 124, bpmSource: "manuell" }, 10);
    expect(applyOp(manual, { t: "tracks", k: "1:A", ts: 99, patch: { bpm: 123, bpmSource: "Analyse" } })).toBeNull();
    // ein neuerer eigener Wert schon
    expect(applyOp(manual, { t: "tracks", k: "1:A", ts: 99, patch: { bpm: 125, bpmSource: "Mithören" } })?.v?.bpm).toBe(125);
    // und eine Messung ändert die anderen Felder trotzdem
    expect(applyOp(manual, { t: "tracks", k: "1:A", ts: 99, patch: { bpm: 123, bpmSource: "Analyse", stars: 4 } })?.v).toEqual({ bpm: 124, bpmSource: "manuell", stars: 4 });
  });
  it("beim ersten Hochladen beider Geräte bleibt der zuerst hochgeladene Stand", () => {
    const first = applyOp(null, { t: "tracks", k: "1:A", ts: 1, patch: { bpm: 126, bpmSource: "Deezer" } });
    expect(applyOp(first, { t: "tracks", k: "1:A", ts: 1, patch: { bpm: 63, bpmSource: "Analyse", stars: 3 } })?.v).toEqual({ bpm: 126, bpmSource: "Deezer", stars: 3 });
  });
  it("Löschen und Wiederanlegen", () => {
    const del = applyOp(row({ name: "Set" }, 10), { t: "tracks", k: "1:A", ts: 20, del: true });
    expect(del?.v).toBeNull();
    expect(applyOp(del, { t: "tracks", k: "1:A", ts: 15, patch: { name: "alt" } })).toBeNull();
    expect(applyOp(del, { t: "tracks", k: "1:A", ts: 30, patch: { name: "neu" } })?.v).toEqual({ name: "neu" });
  });
  it("fasst Patches zusammen und lässt leere Felder weg", () => {
    const c = compact([
      { t: "sets", k: "1", ts: 1, patch: { name: "a" } },
      { t: "sets", k: "1", ts: 2, patch: { venue: "b" } },
      { t: "sets", k: "2", ts: 3, del: true },
    ]);
    expect(c).toEqual([{ t: "sets", k: "1", ts: 2, patch: { name: "a", venue: "b" } }, { t: "sets", k: "2", ts: 3, del: true }]);
    expect(definedOnly({ a: 1, b: undefined, c: null, id: 4 }, ["id"])).toEqual({ a: 1 });
  });
});

import { app } from "../server/app";
import { seal } from "../server/session";
const SECRET = "y".repeat(40);
const ORIGIN = "https://crate.test";
const env = { SESSION_SECRET: SECRET, APP_URL: ORIGIN };
const cookie = async (username: string, verified = true) => `crate_session=${await seal(SECRET, { token: "t", secret: "s", username, verified, iat: Date.now() })}`;
const push = async (user: string, ops: unknown, verified = true) =>
  app.request(`${ORIGIN}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie(user, verified) }, body: JSON.stringify({ ops }) }, env);
const pull = async (user: string, since = 0) => (await app.request(`${ORIGIN}/api/sync/pull?since=${since}`, { headers: { Cookie: await cookie(user) } }, env)).json();

describe("Abgleich-Schnittstelle", () => {
  it("nur mit bestätigter Anmeldung", async () => {
    expect((await app.request(`${ORIGIN}/api/sync/pull`, {}, env)).status).toBe(401);
    expect((await push("franz", [], false)).status).toBe(401);
  });
  it("Rundweg: Handy schreibt, Laptop liest, Messung überschreibt keinen eigenen Wert", async () => {
    const t = Date.now();
    expect((await push("handy-test", [{ t: "tracks", k: "5:A1", ts: t, patch: { bpm: 124, bpmSource: "manuell" } }, { t: "sets", k: "1700000000000", ts: t, patch: { name: "Freitag" } }])).status).toBe(200);
    await push("handy-test", [{ t: "tracks", k: "5:A1", ts: t + 10, patch: { bpm: 62, bpmSource: "Analyse" } }]);
    const r = await pull("handy-test");
    expect(r.rows.find((x: { k: string }) => x.k === "5:A1").v).toEqual({ bpm: 124, bpmSource: "manuell" });
    expect(r.rows.find((x: { t: string }) => x.t === "sets").v.name).toBe("Freitag");
    expect((await pull("handy-test", r.seq)).rows).toHaveLength(0);
  });
  it("Nutzer sehen nur ihre eigenen Daten", async () => {
    await push("anna-test", [{ t: "kv", k: "stylus", ts: 1, patch: { value: { since: "2026-01-01" } } }]);
    const other = await pull("bert-test");
    expect(other.rows).toHaveLength(0);
  });
  it("lehnt ungültige Daten und fremde Seiten ab", async () => {
    expect((await push("franz", [{ t: "releases", k: "1", ts: 1, patch: {} }])).status).toBe(400);
    expect((await push("franz", Array.from({ length: 401 }, (_, i) => ({ t: "kv", k: String(i), ts: 1, patch: {} })))).status).toBe(400);
    const r = await app.request(`${ORIGIN}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: await cookie("franz") }, body: "{}" }, env);
    expect(r.status).toBe(403);
  });
});

describe("Abgleich-Daten löschen", () => {
  it("löscht nur die eigenen Daten", async () => {
    await push("del-a", [{ t: "kv", k: "stylus", ts: 1, patch: { value: 1 } }]);
    await push("del-b", [{ t: "kv", k: "stylus", ts: 1, patch: { value: 2 } }]);
    const r = await app.request(`${ORIGIN}/api/sync`, { method: "DELETE", headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie("del-a") } }, env);
    expect(r.status).toBe(200);
    expect((await pull("del-a")).rows).toHaveLength(0);
    expect((await pull("del-b")).rows).toHaveLength(1);
  });
});

describe("Alles löschen", () => {
  it("entfernt Abgleich-Daten und meldet ab", async () => {
    await push("weg-test", [{ t: "kv", k: "stylus", ts: 1, patch: { value: 1 } }]);
    const r = await app.request(`${ORIGIN}/api/me`, { method: "DELETE", headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie("weg-test") } }, env);
    expect(r.status).toBe(200);
    expect(r.headers.get("Set-Cookie")).toContain("crate_session=;");
    expect((await pull("weg-test")).rows).toHaveLength(0);
    expect((await app.request(`${ORIGIN}/api/me`, { method: "DELETE" }, env)).status).toBe(401);
  });
});
