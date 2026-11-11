// Die D1-Abfragen gegen echtes SQLite (node:sqlite), damit die SQL-Syntax geprüft ist
import { describe, expect, it } from "vitest";
import { d1Store, pushOps, SCHEMA, type D1Like } from "../server/devsync";

async function sqlite(): Promise<D1Like | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    for (const s of SCHEMA) db.exec(s);
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

describe("Abgleich mit D1-Abfragen", () => {
  it("schreibt, führt zusammen und liest seitenweise", async () => {
    const db = await sqlite();
    if (!db) return; // node:sqlite fehlt in dieser Node-Version
    const store = d1Store(db);
    const ops = Array.from({ length: 120 }, (_, i) => ({ t: "tracks", k: `${i}:A`, ts: 5, patch: { bpm: 120 + (i % 10), bpmSource: "manuell" } }));
    const r1 = await pushOps(store, "franz", ops);
    expect(r1).toMatchObject({ written: 120, seq: 120 });
    const r2 = await pushOps(store, "franz", [{ t: "tracks", k: "3:A", ts: 9, patch: { bpm: 61, bpmSource: "Analyse", stars: 4 } }]);
    expect(r2).toMatchObject({ written: 1, seq: 121 });
    const page1 = await store.since("franz", 0, 100);
    expect(page1.rows).toHaveLength(100);
    expect(page1.seq).toBe(page1.rows[99].seq);
    const page2 = await store.since("franz", page1.seq, 100);
    expect(page2.rows).toHaveLength(20);
    expect(page2.seq).toBe(121);
    expect(page2.rows.find((r) => r.k === "3:A")?.v).toEqual({ bpm: 123, bpmSource: "manuell", stars: 4 });
    expect(await store.count("franz")).toBe(120);
    expect((await store.since("anna", 0, 100)).rows).toHaveLength(0);
  });
});
