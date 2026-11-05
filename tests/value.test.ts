import { describe, expect, it } from "vitest";
import { parseMoney, recordValue, roughly } from "../shared/value";

describe("Sammlungswert", () => {
  it("liest Discogs-Beträge", () => {
    expect(parseMoney("€1,234.56")).toEqual({ value: 1234.56, currency: "EUR" });
    expect(parseMoney("$12.00")).toEqual({ value: 12, currency: "USD" });
    expect(parseMoney("£980.10")).toEqual({ value: 980.1, currency: "GBP" });
    expect(parseMoney("CA$5.10")).toEqual({ value: 5.1, currency: "CAD" });
    expect(parseMoney("1.234,56 €")).toEqual({ value: 1234.56, currency: "EUR" });
    expect(parseMoney("€12,345")).toEqual({ value: 12345, currency: "EUR" });
    expect(parseMoney("¥15,000")).toEqual({ value: 15000, currency: "JPY" });
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
  });

  it("nimmt den Preis für den eigenen Zustand, sonst VG+, sonst das günstigste Angebot", () => {
    const suggestions = { NM: 30, "VG+": 20, VG: 12 };
    expect(recordValue({ grade: "VG", suggestions, lowest: 9 })).toEqual({ value: 12, basis: "grade" });
    expect(recordValue({ grade: null, suggestions, lowest: 9 })).toEqual({ value: 20, basis: "vgplus" });
    expect(recordValue({ grade: "VG", suggestions: null, lowest: 9 })).toEqual({ value: 9, basis: "lowest" });
    expect(recordValue({})).toBeNull();
  });

  it("rundet ohne Scheingenauigkeit", () => {
    expect(roughly(23.4)).toBe(23);
    expect(roughly(456)).toBe(460);
    expect(roughly(2318)).toBe(2300);
  });
});
