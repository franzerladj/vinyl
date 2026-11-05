import { describe, expect, it } from "vitest";
import { coverage, decodeSet, encodeSet, type SharedSet } from "../shared/setShare";

const sample: SharedSet = {
  name: "Freitag B2B – Glashaus",
  date: "2026-11-20",
  venue: "Glashaus",
  curve: "journey",
  by: "franz",
  tracks: [
    { releaseId: 12, position: "A1", title: "Love Story [Vs Finally]", artist: "Layo & Bushwacka!", bpm: 124.5, key: "8A", note: "im Breakdown rein" },
    { releaseId: 34, position: "B2", title: "Ça va", artist: "Émile", bpm: 0 },
  ],
  crate: [
    { releaseId: 12, artist: "Layo & Bushwacka!", title: "Love Story" },
    { releaseId: 56, artist: "Can", title: "Future Days" },
  ],
  records: { 12: { artist: "Layo & Bushwacka!", title: "Love Story" }, 34: { artist: "Émile", title: "Été" } },
};

describe("Set teilen", () => {
  it("überlebt Hin und Zurück, auch mit Umlauten und Sonderzeichen", () => {
    const code = encodeSet(sample);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeSet(code)!;
    expect(back.name).toBe(sample.name);
    expect(back.tracks[0]).toMatchObject({ releaseId: 12, position: "A1", bpm: 124.5, key: "8A", note: "im Breakdown rein" });
    expect(back.tracks[1].bpm).toBeUndefined();
    expect(back.records[34].title).toBe("Été");
    // Kiste ohne die Platten, die schon im Set sind
    expect(back.crate.map((c) => c.releaseId)).toEqual([56]);
  });

  it("lehnt Unsinn ab", () => {
    expect(decodeSet("kaputt!!")).toBeNull();
    expect(decodeSet(btoa(JSON.stringify({ v: 2, t: [] })))).toBeNull();
    const evil = decodeSet(btoa(JSON.stringify({ v: 1, t: [["x", 1], [-5, "A"], [7, "A1", "T", "A", 9999]], d: "morgen" })))!;
    expect(evil.tracks).toHaveLength(1);
    expect(evil.tracks[0].bpm).toBeUndefined();
    expect(evil.date).toBeUndefined();
  });

  it("zählt, was man selbst hat", () => {
    const c = coverage(decodeSet(encodeSet(sample))!, new Set([12]));
    expect(c).toMatchObject({ records: 3, have: 1, playable: 1 });
    expect(c.missing.sort()).toEqual([34, 56]);
  });
});
