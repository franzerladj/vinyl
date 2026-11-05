import { describe, expect, it } from "vitest";
import { isVinyl, labelCompletion, normCatno } from "../shared/labels";

describe("Label-Vollständigkeit", () => {
  const rel = (id: number, catno: string, format = '12"', year = 2000 + id) => ({ id, catno, format, year, title: `T${id}`, artist: "A" });
  it("zählt je Katalognummer, nur Vinyl, auch andere Pressungen", () => {
    const releases = [rel(1, "SS 001"), rel(2, "SS001", "Vinyl, LP"), rel(3, "SS-002"), rel(4, "SS 003", "CD"), rel(5, "SS 004"), rel(6, "none"), rel(7, "none")];
    const r = labelCompletion(releases, new Set([2]), new Set([5]), new Set([normCatno("SS 002")]));
    expect(r.total).toBe(5); // 001, 002, 004, zweimal ohne Nummer; CD fällt raus
    expect(r.have).toBe(2); // 001 über eine Pressung, 002 über die Katalognummer
    expect(r.missing.map((e) => e.catno)).toContain("SS 004");
    expect(r.entries.find((e) => e.catno === "SS 004")?.wanted).toBe(true);
    expect(r.entries.find((e) => normCatno(e.catno) === "SS001")?.main.id).toBe(1);
  });
  it("erkennt Vinyl-Formate", () => {
    expect(isVinyl('12", EP')).toBe(true);
    expect(isVinyl("LP, Album")).toBe(true);
    expect(isVinyl('7"')).toBe(true);
    expect(isVinyl("CD, Album")).toBe(false);
    expect(isVinyl("File, MP3")).toBe(false);
  });
});
