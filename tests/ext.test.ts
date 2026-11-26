// Chrome-Erweiterung, Server-Seite: Sicht auf eine Platte aus dem Geräte-Abgleich, Bereichssuche im Speicher,
// Route nur mit bestätigter Anmeldung, und schreibende Anfragen aus der Erweiterung sind erlaubt.
import { describe, expect, it } from "vitest";
import { EXT_ID, EXT_KEY, EXT_ORIGIN, EXT_VERSION, extRelease } from "../shared/ext";
import { SCHEMA, d1Store, memoryStore, type D1Like, type SyncStore } from "../server/devsync";
import { app, crossSite } from "../server/app";
import { seal } from "../server/session";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

async function sqlite(): Promise<D1Like | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    for (const s of SCHEMA) db.exec(s);
    const stmt = (sql: string) => ({
      bind: (...v: unknown[]) => {
        const p = db.prepare(sql);
        const args = v as (string | number | null)[];
        return { all: async <T,>() => ({ results: p.all(...args) as T[] }), first: async <T,>() => (p.get(...args) as T) ?? null, run: async () => p.run(...args) };
      },
    });
    return { prepare: stmt, batch: async (stmts: unknown[]) => Promise.all((stmts as { run(): Promise<unknown> }[]).map((s) => s.run())) };
  } catch {
    return null;
  }
}

const row = (t: "tracks" | "sets" | "recordMeta", k: string, v: Record<string, unknown> | null) => ({ t, k, v, fts: {}, ts: 1 });
const ROWS = [
  row("tracks", "3:A1", { position: "A1", title: "Bar A Thym", bpm: 124, key: "9A", energy: 6 }),
  row("tracks", "3:B1", { position: "B1", title: "Reprise", bpm: null, key: null }),
  row("tracks", "30:A1", { position: "A1", title: "Andere Platte", bpm: 130 }),
  row("tracks", "3:C1", null), // gelöscht
  row("sets", "1700", { name: "Freitag im Klubraum", date: "2026-11-13", venue: "Klubraum", trackIds: ["3:A1", "9:A1"], played: ["3:A1"] }),
  row("sets", "1800", { name: "Sommerfest", date: "2026-07-01", trackIds: ["9:A1"], crateIds: ["3:B1"] }),
  row("sets", "1900", { name: "Ohne diese Platte", trackIds: ["9:A1"] }),
  row("recordMeta", "3", { shelf: "Regal 2", lentTo: "kumpel" }),
];

async function scans(store: SyncStore) {
  await store.put("franz", ROWS);
  await store.put("anna", [row("tracks", "3:A1", { position: "A1", title: "Fremd" })]);
  const tracks = await store.scan("franz", "tracks", "3:", 80);
  // Nur diese Platte (nicht 30:…), nur der eigene Nutzer, nach Schlüssel sortiert
  expect(tracks.map((r) => r.k)).toEqual(["3:A1", "3:B1", "3:C1"]);
  expect((await store.scan("franz", "sets", "", 300)).length).toBe(3);
  expect((await store.scan("franz", "tracks", "3:", 1)).length).toBe(1);
  expect(await store.scan("niemand", "tracks", "3:", 80)).toEqual([]);
}

describe("Erweiterung: Speicher und Sicht auf eine Platte", () => {
  it("Bereichssuche im Arbeitsspeicher", async () => scans(memoryStore()));
  it("Bereichssuche gegen SQLite", async () => {
    const db = await sqlite();
    if (db) await scans(d1Store(db));
  });
  it("Tracks dieser Platte mit Tempo und Tonart, Sets mit „gespielt“, Regal und verliehen", () => {
    const v = extRelease(3, { tracks: ROWS.filter((r) => r.t === "tracks" && r.k.startsWith("3:")), sets: ROWS.filter((r) => r.t === "sets"), meta: ROWS[7], any: true });
    expect(v.sync).toBe(true);
    expect(v.tracks).toEqual([
      { position: "A1", title: "Bar A Thym", bpm: 124, key: "9A", energy: 6 },
      { position: "B1", title: "Reprise", bpm: null, key: null, energy: null },
    ]);
    // Neuestes Set zuerst, „gespielt“ nur wo ein Track der Platte abgehakt ist, Set ohne die Platte fehlt
    expect(v.sets).toEqual([
      { name: "Freitag im Klubraum", date: "2026-11-13", venue: "Klubraum", played: true },
      { name: "Sommerfest", date: "2026-07-01", venue: undefined, played: false },
    ]);
    expect([v.shelf, v.lentTo]).toEqual(["Regal 2", "kumpel"]);
  });
  it("ohne Abgleich: leer und als solches gekennzeichnet", () => {
    expect(extRelease(3, { tracks: [], sets: [], meta: null, any: false })).toEqual({ sync: false, tracks: [], sets: [], shelf: undefined, lentTo: undefined });
  });
});

describe("Erweiterung: Kennung und Zugang", () => {
  it("Kennung folgt aus dem Schlüssel im Manifest", () => {
    const hex = createHash("sha256").update(Buffer.from(EXT_KEY, "base64")).digest("hex").slice(0, 32);
    expect([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("")).toBe(EXT_ID);
    const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
    expect(manifest.key).toBe(EXT_KEY);
    expect(manifest.version).toBe(EXT_VERSION);
    // Nur Crate und die Discogs-Schnittstelle, keine Berechtigung für alle Seiten
    expect(manifest.host_permissions).toEqual(["https://crate-8vf.pages.dev/*", "https://api.discogs.com/*"]);
    expect(manifest.permissions).not.toContain("tabs");
    expect(JSON.stringify(manifest.content_scripts)).not.toContain("<all_urls>");
  });
  it("die Datei zum Laden passt zu den Quellen (sonst: python3 tools/ext/pack.py)", () => {
    const src = fileURLToPath(new URL("../extension", import.meta.url));
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const h = createHash("sha256");
    for (const f of walk(src).map((f) => relative(src, f).split("\\").join("/")).sort()) {
      h.update(f);
      h.update(readFileSync(join(src, f)));
    }
    const packed = JSON.parse(readFileSync(new URL("../web/public/download/crate-erweiterung.json", import.meta.url), "utf8"));
    expect(packed).toEqual({ version: EXT_VERSION, sha: h.digest("hex") });
  });
  it("schreibende Anfragen aus der Erweiterung gelten nicht als fremde Seite, andere Erweiterungen schon", () => {
    const own = ["https://crate.example", EXT_ORIGIN];
    // So kommt es aus Chrome an (im Browser-Test gemessen): Sec-Fetch-Site none, Origin der Erweiterung
    expect(crossSite("none", EXT_ORIGIN, own)).toBe(false);
    expect(crossSite("none", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", own)).toBe(true);
    expect(crossSite("cross-site", EXT_ORIGIN, own)).toBe(true);
  });
  it("Route nur mit bestätigter Anmeldung, Antwort aus dem Abgleich", async () => {
    const SECRET = "x".repeat(32);
    const ORIGIN = "https://crate.example";
    const env = { SESSION_SECRET: SECRET, APP_URL: ORIGIN };
    const cookie = async (u: string, verified = true) => `crate_session=${await seal(SECRET, { token: "t", secret: "s", username: u, verified, iat: Date.now() })}`;
    expect((await app.request(`${ORIGIN}/api/ext/release/3`, {}, env)).status).toBe(401);
    expect((await app.request(`${ORIGIN}/api/ext/release/3`, { headers: { Cookie: await cookie("ExtFranz", false) } }, env)).status).toBe(401);
    expect((await app.request(`${ORIGIN}/api/ext/release/abc`, { headers: { Cookie: await cookie("ExtFranz") } }, env)).status).toBe(400);
    // Über den Abgleich hochladen, wie es die App tut (aus der Erweiterung heraus, also mit ihrem Origin)
    const push = await app.request(
      `${ORIGIN}/api/sync/push`,
      { method: "POST", headers: { "Content-Type": "application/json", Origin: EXT_ORIGIN, "Sec-Fetch-Site": "none", Cookie: await cookie("ExtFranz") }, body: JSON.stringify({ ops: [{ t: "tracks", k: "3:A1", patch: { position: "A1", title: "Bar A Thym", bpm: 124, key: "9A" }, ts: 5 }] }) },
      env,
    );
    expect(push.status).toBe(200);
    const r = await app.request(`${ORIGIN}/api/ext/release/3`, { headers: { Cookie: await cookie("ExtFranz") } }, env);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { sync: boolean; tracks: { title: string; bpm: number }[] };
    expect(j.sync).toBe(true);
    expect(j.tracks.map((t) => [t.title, t.bpm])).toEqual([["Bar A Thym", 124]]);
    // Fremde sehen nichts davon
    const other = (await (await app.request(`${ORIGIN}/api/ext/release/3`, { headers: { Cookie: await cookie("ExtAnna") } }, env)).json()) as { sync: boolean; tracks: unknown[] };
    expect(other).toMatchObject({ sync: false, tracks: [] });
  });
});
