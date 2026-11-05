import { describe, expect, it } from "vitest";
import { yearReview } from "../shared/year";

const rel = (id: number, label: string, styles: string[], year: number) => ({ id, title: `T${id}`, artist: "A", year, labels: [{ name: label }], styles });

describe("Jahresrückblick", () => {
  it("zählt Neuzugänge, Labels, Sets und meistgespielte Platten im Jahr", () => {
    const releases = new Map([rel(1, "KDJ", ["Deep House"], 1996), rel(2, "KDJ", ["Deep House", "Soul"], 2001), rel(3, "Trax (2)", ["Chicago House"], 1987), rel(4, "Eternal", ["Techno"], 2016)].map((r) => [r.id, r]));
    const r = yearReview({
      year: 2026,
      today: "2026-11-05",
      collection: [
        { releaseId: 1, dateAdded: "2026-02-01T10:00:00Z" },
        { releaseId: 2, dateAdded: "2026-05-01T10:00:00Z" },
        { releaseId: 3, dateAdded: "2026-07-01T10:00:00Z" },
        { releaseId: 4, dateAdded: "2025-07-01T10:00:00Z" },
      ],
      releases,
      sets: [
        { date: "2026-03-01", venue: "Glashaus", trackIds: ["1:A", "1:B", "3:A"] },
        { date: "2026-04-01", venue: "Glashaus", trackIds: ["1:A", "2:A"] },
        { date: "2026-12-31", venue: "Silvester", trackIds: ["4:A"] },
      ],
      trackRelease: (id) => Number(id.split(":")[0]),
    });
    expect(r.added).toBe(3);
    expect(r.topLabels[0]).toEqual({ name: "KDJ", n: 2 });
    expect(r.topLabels.map((l) => l.name)).toContain("Trax");
    expect(r.topStyles[0]).toEqual({ name: "Deep House", n: 2 });
    expect(r.sets).toBe(2);
    expect(r.venues).toBe(1);
    expect(r.mostPlayed[0].release?.id).toBe(1);
    expect(r.mostPlayed[0].n).toBe(2);
    expect(r.oldest?.year).toBe(1987);
    expect(r.hours).toBe(1); // 5 Tracks à 6 Minuten
  });
});
