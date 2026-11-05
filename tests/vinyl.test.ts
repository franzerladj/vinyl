import { describe, expect, it } from "vitest";
import { gradeRank, longGrade, pressingInfo, shortGrade } from "../shared/vinyl";

describe("Zustand", () => {
  it("liest Discogs-Werte und Kurzformen", () => {
    expect(shortGrade("Near Mint (NM or M-)")).toBe("NM");
    expect(shortGrade("Very Good Plus (VG+)")).toBe("VG+");
    expect(shortGrade("vg+")).toBe("VG+");
    expect(shortGrade("Generic")).toBe("Generic");
    expect(shortGrade("")).toBeUndefined();
    expect(longGrade("VG")).toBe("Very Good (VG)");
    expect(gradeRank("M")).toBeGreaterThan(gradeRank("VG+"));
    expect(gradeRank(undefined)).toBe(-1);
  });
});

describe("Pressung", () => {
  it("trennt Matrix, Schnitt und Presswerk", () => {
    const p = pressingInfo(
      [
        { type: "Matrix / Runout", value: "SOU 001 A NT", description: "Side A" },
        { type: "Matrix / Runout", value: "SOU 001 B NT", description: "Side B" },
        { type: "Barcode", value: "5021392033112" },
      ],
      [
        { name: "Dubplates & Mastering", entity_type_name: "Lacquer Cut At" },
        { name: "Optimal Media Production", entity_type_name: "Pressed By" },
        { name: "Rough Trade (2)", entity_type_name: "Distributed By" },
      ],
    );
    expect(p.matrix).toEqual(["SOU 001 A NT  (Side A)", "SOU 001 B NT  (Side B)"]);
    expect(p.barcode).toBe("5021392033112");
    expect(p.cut).toEqual(["Dubplates & Mastering"]);
    expect(p.pressed).toEqual(["Optimal Media Production"]);
    expect(p.other).toEqual([{ role: "Vertrieb", name: "Rough Trade" }]);
  });
});
