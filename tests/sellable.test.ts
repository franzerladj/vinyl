import { describe, expect, it } from "vitest";
import { sellCandidates, sinceText } from "../shared/sellable";

const today = "2026-11-18";
const base = { rating: 0, dateAdded: "2024-01-10T10:00:00-07:00", sets: 0 };

describe("Was könnte weg?", () => {
  it("nennt wertvolle Platten, die in keinem Set liefen, nach Wert sortiert", () => {
    const r = sellCandidates([{ ...base, id: 1, value: 40 }, { ...base, id: 2, value: 120, paid: 30 }, { ...base, id: 3, value: 60, sets: 2 }], today);
    expect(r.map((x) => x.id)).toEqual([2, 1]);
    expect(r[0].gain).toBe(90);
    expect(r[1].gain).toBeNull();
    expect(r[0].months).toBeGreaterThan(30);
  });

  it("lässt neue, geliebte, verliehene und billige Platten in Ruhe", () => {
    const r = sellCandidates(
      [
        { ...base, id: 1, value: 80, dateAdded: "2026-09-01T00:00:00Z" }, // neu
        { ...base, id: 2, value: 80, rating: 5 }, // Lieblingsplatte
        { ...base, id: 3, value: 80, lent: true }, // verliehen
        { ...base, id: 4, value: 6 }, // lohnt nicht
        { ...base, id: 5, value: null }, // Wert unbekannt
        { ...base, id: 6, value: 80, rating: 3 },
      ],
      today,
    );
    expect(r.map((x) => x.id)).toEqual([6]);
  });

  it("hält sich an Grenzen und Anzahl", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...base, id: i + 1, value: 20 + i }));
    expect(sellCandidates(many, today)).toHaveLength(12);
    expect(sellCandidates(many, today, { limit: 3, minValue: 45 }).map((x) => x.value)).toEqual([49, 48, 47]);
  });

  it("beschreibt die Zeit in der Sammlung", () => {
    expect(sinceText(8)).toBe("seit 8 Monaten");
    expect(sinceText(14)).toBe("seit über einem Jahr");
    expect(sinceText(40)).toBe("seit 3 Jahren");
  });
});
