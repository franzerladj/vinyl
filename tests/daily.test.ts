import { describe, expect, it } from "vitest";
import { dailyPick } from "../shared/daily";

describe("Platte des Tages", () => {
  const recs = [1, 2, 3, 4, 5].map((id) => ({ id, dateAdded: `2025-0${id}-10T10:00:00` }));
  it("bleibt über den Tag gleich und wechselt am nächsten", () => {
    const a = dailyPick(recs, "2026-11-17");
    expect(dailyPick(recs, "2026-11-17")).toEqual(a);
    const days = new Set(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"].map((d) => dailyPick(recs, d)!.id));
    expect(days.size).toBeGreaterThan(1);
  });
  it("Jahrestag gewinnt", () => {
    expect(dailyPick(recs, "2028-03-10")).toEqual({ id: 3, reason: "Heute vor 3 Jahren gekauft" });
    expect(dailyPick(recs, "2026-03-10")!.reason).toBe("Heute vor einem Jahr gekauft");
  });
  it("nimmt lieber eine Platte mit Hörprobe", () => {
    for (const d of ["2026-11-17", "2026-11-18", "2026-11-19"]) expect(dailyPick(recs, d, new Set(), new Set([2]))!.id).toBe(2);
  });
  it("lässt kürzlich Gespieltes aus", () => {
    const out = dailyPick(recs, "2026-11-17", new Set([1, 2, 3, 4]));
    expect(out!.id).toBe(5);
  });
});
