import { describe, expect, it } from "vitest";
import { emptyWeights, learn, mix, score, splitTitle, top, type DigCard } from "../shared/dig";

const card = (id: number, artist: string, styles: string[], extra: Partial<DigCard> = {}): DigCard => ({
  id, artist, title: `T${id}`, thumb: "", cover: "", styles, source: "random", reason: "", ...extra,
});

describe("Digging-Feed", () => {
  it("lernt aus Wantlist und Wegwischen", () => {
    let w = emptyWeights();
    w = learn(w, { styles: ["Deep House"], label: "Running Back", artist: "Tama Sumo" }, "want");
    w = learn(w, { styles: ["Trance"], artist: "X" }, "skip");
    expect(w.style["Deep House"]).toBe(3);
    expect(w.style.Trance).toBe(-2);
    expect(top(w.style, 3)).toEqual(["Deep House"]);
    expect(score(w, card(1, "A", ["Deep House"]))).toBeGreaterThan(score(w, card(2, "B", ["Trance"])));
  });

  it("deckelt Gewichte", () => {
    let w = emptyWeights();
    for (let i = 0; i < 20; i++) w = learn(w, { styles: ["Disco"], artist: "A" }, "want");
    expect(w.style.Disco).toBe(20);
  });

  it("mischt Quellen, ohne Bekanntes, Doppelte und Artist-Wiederholung", () => {
    const a = [card(1, "A", []), card(2, "A", []), card(3, "B", [])];
    const b = [card(3, "B", []), card(4, "C", []), card(5, "D", [])];
    const out = mix([a, b], emptyWeights(), new Set([5]), () => 0);
    const ids = out.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(5);
    for (let i = 1; i < out.length; i++) expect(out[i].artist === out[i - 1].artist && out.length > 2 && i < out.length - 1).toBe(false);
  });

  it("trennt Artist und Titel", () => {
    expect(splitTitle("Moodymann (2) - Silence In The Secret Garden")).toEqual({ artist: "Moodymann", title: "Silence In The Secret Garden" });
  });
});
