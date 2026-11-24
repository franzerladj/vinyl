// Zahlenreihen für „Die Kiste in Bildern“
import { describe, expect, it } from "vitest";
import { kisteStats, monthLabel, plattenText } from "../shared/kiste";

const rel = (year: number, styles: string[], label: string, country = "Germany") => ({ year, styles, labels: [{ name: label }], country });
const releases = new Map([
  [1, rel(1996, ["Deep House", "House"], "Prescription")],
  [2, rel(1996, ["Deep House"], "Prescription (2)")],
  [3, rel(2001, ["Techno"], "M-Plant", "US")],
  [4, rel(0, ["Techno"], "Not On Label")],
  [5, rel(1998, ["House"], "Guidance", "US")],
]);
const collection = [
  { releaseId: 1, dateAdded: "2025-11-03T10:00:00-07:00" },
  { releaseId: 2, dateAdded: "2025-11-20T10:00:00-07:00" },
  { releaseId: 3, dateAdded: "2026-01-05T10:00:00-07:00" },
  { releaseId: 4, dateAdded: "2026-03-09T10:00:00-07:00" },
  { releaseId: 5, dateAdded: "2026-03-10T10:00:00-07:00" },
  { releaseId: 5, dateAdded: "2026-03-11T10:00:00-07:00" }, // zweites Exemplar
];

describe("Die Kiste in Bildern", () => {
  const s = kisteStats({ collection, releases, today: "2026-04-15" });
  it("Wachstum: lückenlos Monat für Monat bis heute, Stand läuft auf", () => {
    expect(s.growth.map((g) => g.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(s.growth.map((g) => g.added)).toEqual([2, 0, 1, 0, 3, 0]);
    expect(s.growth.map((g) => g.total)).toEqual([2, 2, 3, 3, 6, 6]);
    expect(s.total).toBe(6);
  });
  it("Kalender: je Jahr zwölf Monate, neuestes zuerst, mit dem stärksten Monat", () => {
    expect(s.calendar.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(s.calendar.years[0].months).toEqual([1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.calendar.years[1].months[10]).toBe(2);
    expect([s.calendar.max, s.calendar.best]).toEqual([3, { year: 2026, month: 3, n: 3 }]);
    // Bei langer Geschichte nur die letzten Jahre
    const long = kisteStats({ collection: [{ releaseId: 1, dateAdded: "2012-05-01" }, ...collection], releases, today: "2026-04-15" });
    expect(long.calendar.years.map((y) => y.year)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
    expect(long.growth[0].month).toBe("2012-05");
  });
  it("Erscheinungsjahre: lückenlos, unbekanntes Jahr zählt extra", () => {
    expect(s.years).toEqual([
      { year: 1996, n: 2 },
      { year: 1997, n: 0 },
      { year: 1998, n: 2 },
      { year: 1999, n: 0 },
      { year: 2000, n: 0 },
      { year: 2001, n: 1 },
    ]);
    expect(s.peakYear).toEqual({ year: 1996, n: 2 });
    expect(s.noYear).toBe(1);
  });
  it("Styles, Labels und Länder nach Häufigkeit, Label ohne Discogs-Zähler, ohne „Not On Label“", () => {
    expect(s.styles.slice(0, 3)).toEqual([{ name: "House", n: 3 }, { name: "Deep House", n: 2 }, { name: "Techno", n: 2 }]);
    expect(s.labels).toEqual([{ name: "Guidance", n: 2 }, { name: "Prescription", n: 2 }, { name: "M-Plant", n: 1 }]);
    expect(s.countries).toEqual([{ name: "Germany", n: 3 }, { name: "US", n: 3 }]);
  });
  it("leere Sammlung und Datum in der Zukunft", () => {
    const e = kisteStats({ collection: [], releases, today: "2026-04-15" });
    expect([e.growth, e.years, e.peakYear, e.calendar.max]).toEqual([[], [], null, 0]);
    const f = kisteStats({ collection: [{ releaseId: 1, dateAdded: "2027-01-01" }], releases, today: "2026-04-15" });
    expect(f.growth).toEqual([]);
  });
  it("Texte", () => {
    expect(monthLabel("2024-03")).toBe("März 2024");
    expect([plattenText(1), plattenText(12)]).toEqual(["1 Platte", "12 Platten"]);
  });
});
