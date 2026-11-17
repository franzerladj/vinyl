import { describe, expect, it } from "vitest";
import { affinity, arrange, emptyTaste, features, learnTaste, rank, seedTaste, topTaste, viewReward, type SessionEvent } from "../shared/taste";
import type { DigCard } from "../shared/dig";

const card = (id: number, artist: string, styles: string[], extra: Partial<DigCard> = {}): DigCard => ({
  id, artist, title: `T${id}`, thumb: "", cover: "", styles, source: "foryou", reason: "", ...extra,
});
const NOW = 1_800_000_000_000;

describe("Geschmacksprofil", () => {
  it("liest Eigenschaften einer Karte", () => {
    expect(features(card(1, "Theo Parrish", ["Deep House", "Disco"], { label: "Sound Signature", year: "1997", country: "US" }))).toEqual(["s:Deep House", "s:Disco", "l:Sound Signature", "a:Theo Parrish", "d:1990", "c:US"]);
  });

  it("schnelles Weiterwischen ist ein Nein, langes Hören ein Ja", () => {
    expect(viewReward(0.8)).toBeLessThan(0);
    expect(viewReward(30, 20)).toBeGreaterThan(2);
  });

  it("lernt still aus Verweildauer: Deep House angehört, Trance weggeswipt", () => {
    let t = emptyTaste();
    for (let i = 0; i < 5; i++) {
      t = learnTaste(t, card(i, `A${i}`, ["Deep House"]), "view", { seconds: 20, listened: 18, now: NOW });
      t = learnTaste(t, card(10 + i, `B${i}`, ["Trance"]), "view", { seconds: 0.7, now: NOW });
    }
    expect(affinity(t, "s:Deep House", NOW)).toBeGreaterThan(1);
    expect(affinity(t, "s:Trance", NOW)).toBeLessThan(0);
    expect(rank(t, card(99, "X", ["Deep House"]), [], NOW)).toBeGreaterThan(rank(t, card(98, "Y", ["Trance"]), [], NOW));
  });

  it("ein einzelnes Like zählt bei wenig Wissen vorsichtig, viele Eindrücke festigen", () => {
    let t = learnTaste(emptyTaste(), card(1, "A", ["Disco"]), "like", { now: NOW });
    const one = affinity(t, "s:Disco", NOW);
    for (let i = 0; i < 6; i++) t = learnTaste(t, card(2 + i, `A${i}`, ["Disco"]), "like", { now: NOW });
    expect(one).toBeGreaterThan(0);
    expect(affinity(t, "s:Disco", NOW)).toBeGreaterThan(one);
  });

  it("Vorlieben verblassen mit der Zeit", () => {
    const t = learnTaste(emptyTaste(), card(1, "A", ["Disco"]), "want", { now: NOW });
    expect(affinity(t, "s:Disco", NOW + 200 * 864e5)).toBeLessThan(affinity(t, "s:Disco", NOW) / 2 + 0.01);
  });

  it("die laufende Sitzung zieht sofort mit", () => {
    const t = emptyTaste();
    const session: SessionEvent[] = [{ keys: features(card(1, "A", ["Italo-Disco"])), r: 3 }];
    expect(rank(t, card(2, "B", ["Italo-Disco"]), session, NOW)).toBeGreaterThan(rank(t, card(3, "C", ["Ambient"]), session, NOW));
  });

  it("ordnet mit Abwechslung: nie derselbe Artist hintereinander, jede fünfte Karte erkundet", () => {
    let t = emptyTaste();
    for (let i = 0; i < 8; i++) t = learnTaste(t, card(i, "Fav", ["House"], { label: "L" }), "like", { now: NOW });
    const cards = [
      ...Array.from({ length: 6 }, (_, i) => card(100 + i, "Fav", ["House"], { label: "L" })),
      ...Array.from({ length: 6 }, (_, i) => card(200 + i, `Other${i}`, ["House"], { label: `L${i}` })),
      card(300, "Wild", ["Dub"], { source: "random" }),
    ];
    const out = arrange(t, cards, [], { jitter: () => 0.5, now: NOW });
    expect(out).toHaveLength(cards.length);
    for (let i = 1; i < 6; i++) expect(out[i].artist === "Fav" && out[i - 1].artist === "Fav").toBe(false);
    expect(out[4].id).toBe(300);
  });

  it("Startwert aus der Sammlung, die Top-Liste zeigt die Lieblinge", () => {
    const recs = [
      ...Array.from({ length: 10 }, (_, i) => ({ styles: ["Deep House"], label: "Running Back", artist: `A${i}`, year: "2015" })),
      { styles: ["Techno"], label: "Tresor", artist: "B", year: "1995" },
    ];
    const t = seedTaste(recs, NOW);
    expect(topTaste(t, "s", 2, NOW).map((x) => x.key)).toEqual(["Deep House", "Techno"]);
    expect(topTaste(t, "l", 1, NOW)[0].key).toBe("Running Back");
    expect(affinity(t, "s:Deep House", NOW)).toBeLessThan(1); // vorsichtig, Diggen formt schnell nach
  });
});
