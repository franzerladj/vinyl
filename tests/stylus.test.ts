import { describe, expect, it } from "vitest";
import { durationSeconds, stylusMinutes, stylusWear } from "../shared/stylus";

describe("Nadel-Stunden", () => {
  it("liest Laufzeiten", () => {
    expect(durationSeconds("6:30")).toBe(390);
    expect(durationSeconds("1:02:10")).toBe(3730);
    expect(durationSeconds("")).toBeNull();
  });
  it("zählt vergangene Sets seit dem Einbau, markierte Tracks und eigene Minuten", () => {
    const sec = (id: string) => (id === "a" ? 600 : null);
    const sets = [
      { date: "2026-01-10", trackIds: ["a", "b"] }, // vor dem Einbau
      { date: "2026-03-01", trackIds: ["a", "b"] }, // 10 + 6 min
      { date: "2026-03-05", trackIds: ["a", "b", "c"], played: ["a"] }, // nur a: 10 min
      { date: "2026-12-24", trackIds: ["a"] }, // Zukunft
      { trackIds: ["a"] }, // ohne Datum
    ];
    expect(stylusMinutes({ since: "2026-02-01", extraMinutes: 30 }, sets, sec, "2026-11-05")).toBe(16 + 10 + 30);
  });
  it("Verschleiß nur mit Herstellerangabe", () => {
    expect(stylusWear(120, 300)).toBeCloseTo(2 / 300);
    expect(stylusWear(120)).toBeNull();
  });
});
