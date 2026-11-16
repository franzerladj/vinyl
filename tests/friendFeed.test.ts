import { describe, expect, it } from "vitest";
import { agoText, feedPosts } from "../shared/friendFeed";

const it_ = (username: string, kind: "coll" | "want", releaseId: number, dateAdded: string) => ({ username, kind, releaseId, dateAdded });

describe("Neu bei Freunden", () => {
  it("bündelt je Freund, Tag und Art, neueste zuerst", () => {
    const posts = feedPosts([
      it_("anna", "coll", 1, "2026-11-10T10:00:00-08:00"),
      it_("anna", "coll", 2, "2026-11-10T12:00:00-08:00"),
      it_("anna", "want", 3, "2026-11-10T13:00:00-08:00"),
      it_("bert", "coll", 4, "2026-11-12T09:00:00-08:00"),
      it_("anna", "coll", 1, "2026-11-10T10:00:00-08:00"),
    ]);
    expect(posts.map((p) => [p.username, p.kind, p.releaseIds])).toEqual([
      ["bert", "coll", [4]],
      ["anna", "want", [3]],
      ["anna", "coll", [1, 2]],
    ]);
  });
  it("begrenzt Beiträge und Platten je Beitrag, lässt Altes und Kaputtes weg", () => {
    const many = Array.from({ length: 30 }, (_, i) => it_("carl", "coll", i, "2026-11-01T10:00:00Z"));
    expect(feedPosts(many, { perPost: 5 })[0].releaseIds).toHaveLength(5);
    expect(feedPosts([it_("x", "coll", 1, "kaputt"), it_("y", "coll", 2, "2020-01-01T00:00:00Z")], { sinceMs: Date.parse("2026-01-01") })).toEqual([]);
    expect(feedPosts(Array.from({ length: 20 }, (_, i) => it_(`f${i}`, "coll", i, "2026-11-01T10:00:00Z")), { limit: 3 })).toHaveLength(3);
  });
  it("Zeitangabe", () => {
    const now = new Date(2026, 10, 16, 12).getTime();
    expect(agoText(new Date(2026, 10, 16, 1).getTime(), now)).toBe("heute");
    expect(agoText(new Date(2026, 10, 15, 23).getTime(), now)).toBe("gestern");
    expect(agoText(new Date(2026, 10, 11).getTime(), now)).toBe("vor 5 Tagen");
    expect(agoText(new Date(2026, 9, 19).getTime(), now)).toBe("vor 4 Wochen");
  });
});
