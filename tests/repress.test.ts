import { describe, expect, it } from "vitest";
import { newPressings } from "../shared/repress";

describe("Repress-Alarm", () => {
  const v = (id: number, released: string, format = 'Vinyl, 12"') => ({ id, released, format });
  it("meldet beim ersten Blick nur frische Vinyl-Pressungen", () => {
    const r = newPressings([v(1, "1994"), v(2, "2026"), v(3, "2025", "CD"), v(4, "2025"), v(9, "2026")], null, 9, 2026);
    expect(r.map((x) => x.id)).toEqual([2, 4]);
  });
  it("meldet danach nur unbekannte, keine alten Nachträge", () => {
    const r = newPressings([v(1, "1994"), v(2, "2026"), v(5, "2026"), v(6, "1999")], new Set([1, 2]), 9, 2026);
    expect(r.map((x) => x.id)).toEqual([5]);
  });
});
