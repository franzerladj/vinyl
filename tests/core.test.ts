import { describe, expect, it } from "vitest";
import { keyDistance, parseKey, camelotString, bpmDelta } from "../shared/music";
import { optimizeBasket, rankSellers, type Listing } from "../shared/optimizer";
import { buildSetlist } from "../shared/setlist";

describe("music", () => {
  it("parst Tonarten in Camelot", () => {
    expect(camelotString(parseKey("Am"))).toBe("8A");
    expect(camelotString(parseKey("C"))).toBe("8B");
    expect(camelotString(parseKey("F#m"))).toBe("11A");
    expect(camelotString(parseKey("Bb minor"))).toBe("3A");
    expect(camelotString(parseKey("Dbmaj"))).toBe("3B");
    expect(camelotString(parseKey("5A"))).toBe("5A");
    expect(camelotString(parseKey("1m"))).toBe("8A");
    expect(camelotString(parseKey("1d"))).toBe("8B");
    expect(parseKey("xyz")).toBeNull();
  });
  it("bewertet harmonische Übergänge", () => {
    expect(keyDistance(parseKey("8A"), parseKey("8A"))).toBe(0);
    expect(keyDistance(parseKey("8A"), parseKey("9A"))).toBe(1);
    expect(keyDistance(parseKey("12A"), parseKey("1A"))).toBe(1);
    expect(keyDistance(parseKey("8A"), parseKey("8B"))).toBe(1);
    expect(keyDistance(parseKey("8A"), parseKey("2A"))).toBeGreaterThan(2);
  });
  it("berücksichtigt halbes/doppeltes Tempo", () => {
    expect(bpmDelta(85, 170)).toBe(0);
    expect(Math.round(bpmDelta(120, 126))).toBe(5);
  });
});

describe("optimizer", () => {
  const L = (seller: string, releaseId: number, price: number, shipping?: number): Listing => ({ listingId: `${seller}-${releaseId}`, seller, releaseId, price, shipping });
  const shipping = { firstItem: 6, perExtraItem: 1 };

  it("bündelt bei einem Händler, wenn Versand die Einzelpreise überwiegt", () => {
    const listings = [L("a", 1, 10), L("a", 2, 10), L("a", 3, 10), L("b", 1, 8), L("c", 2, 8), L("d", 3, 8)];
    const r = optimizeBasket(listings, { shipping });
    expect(r.baskets).toHaveLength(1);
    expect(r.baskets[0].seller).toBe("a");
    expect(r.total).toBe(30 + 6 + 2);
    expect(r.total).toBeLessThan(r.naiveTotal);
  });

  it("teilt auf, wenn ein Händler deutlich günstiger ist", () => {
    const listings = [L("a", 1, 10), L("a", 2, 40), L("b", 2, 10)];
    const r = optimizeBasket(listings, { shipping });
    expect(r.baskets.map((b) => b.seller).sort()).toEqual(["a", "b"]);
  });

  it("meldet fehlende Releases und respektiert Filter", () => {
    const listings = [L("a", 1, 10), L("a", 2, 100)];
    const r = optimizeBasket(listings, { shipping, wanted: [1, 2, 3], maxPricePerItem: 50 });
    expect(r.missing.sort()).toEqual([2, 3]);
    expect(r.itemsCount).toBe(1);
  });

  it("rankt Händler nach Anzahl Wants", () => {
    const listings = [L("a", 1, 10), L("b", 1, 9), L("b", 2, 9)];
    expect(rankSellers(listings, { shipping })[0].seller).toBe("b");
  });
});

describe("setlist", () => {
  it("baut eine Warmup-Kurve mit steigender Energie", () => {
    const tracks = Array.from({ length: 12 }, (_, i) => ({ id: String(i), bpm: 118 + i, key: `${(i % 12) + 1}A`, energy: 1 + (i % 10) }));
    const order = buildSetlist(tracks, { length: 8, curve: "warmup" });
    expect(order).toHaveLength(8);
    expect(new Set(order).size).toBe(8);
    const energies = order.map((id) => tracks[Number(id)].energy);
    expect(energies[0]).toBeLessThan(energies[energies.length - 1]);
  });
});

import { estimateVibe } from "../shared/vibes";
describe("vibes", () => {
  it("schätzt Energie aus Style und BPM", () => {
    const deep = estimateVibe({ styles: ["Deep House"], bpm: 118 });
    const techno = estimateVibe({ styles: ["Techno"], bpm: 134 });
    expect(deep.energy).toBeLessThan(techno.energy);
    expect(deep.moods).toContain("deep");
    expect(techno.slot).toBe("peak");
  });
  it("nutzt Last.fm-Tags und Audio-Energie", () => {
    const base = estimateVibe({ styles: ["House"], bpm: 122 });
    const chill = estimateVibe({ styles: ["House"], bpm: 122, tags: [{ name: "chillout", count: 100 }, { name: "dreamy", count: 60 }] });
    expect(chill.energy).toBeLessThan(base.energy);
    expect(chill.moods).toContain("chill");
    const loud = estimateVibe({ styles: ["House"], bpm: 122, audioEnergy: 10 });
    expect(loud.energy).toBeGreaterThan(base.energy);
    expect(loud.sources).toContain("Audio");
  });
});

import { evaluateDeal, planBudget } from "../shared/deals";
describe("deals", () => {
  it("bewertet gegen die Discogs-Empfehlung", () => {
    expect(evaluateDeal({ lowest: 10, numForSale: 5, suggestedVgPlus: 20 }).ampel).toBe("green");
    expect(evaluateDeal({ lowest: 20, numForSale: 5, suggestedVgPlus: 20 }).ampel).toBe("yellow");
    expect(evaluateDeal({ lowest: 40, numForSale: 5, suggestedVgPlus: 20 }).ampel).toBe("red");
  });
  it("nutzt den Preisverlauf, wenn keine Empfehlung da ist", () => {
    const d = evaluateDeal({ lowest: 12, numForSale: 4, history: [20, 21, 19, 12] });
    expect(d.referenceSource).toBe("Preisverlauf");
    expect(d.ampel).toBe("green");
    expect(d.change).toBe(-7);
  });
  it("erkennt seltene, gefragte Platten und Wunschpreise", () => {
    const d = evaluateDeal({ lowest: 30, numForSale: 2, have: 100, want: 400, targetPrice: 35 });
    expect(d.urgency).toBe("hot");
    expect(d.underTarget).toBe(true);
    expect(evaluateDeal({ lowest: 30, numForSale: 0 }).score).toBe(0);
  });
  it("plant ein Budget", () => {
    const r = planBudget([{ id: 1, price: 50, score: 90 }, { id: 2, price: 20, score: 80 }, { id: 3, price: 20, score: 10 }], 80, 5);
    expect(r.picked.map((x) => x.id)).toEqual([1, 2]);
    expect(r.total).toBe(80);
  });
});

describe("Versand nach Herkunft", () => {
  it("unterscheidet Inland, EU und Welt", async () => {
    const { regionOf, estimateShipping, DEFAULT_SHIP } = await import("../shared/shipping");
    expect(regionOf("Germany", "Germany")).toBe("home");
    expect(regionOf("Netherlands", "Germany")).toBe("eu");
    expect(regionOf("UK", "Germany")).toBe("world");
    expect(regionOf("Germany", "Switzerland")).toBe("world");
    expect(estimateShipping(DEFAULT_SHIP, "Germany", 3)).toBe(7.5);
  });
  it("rechnet den Warenkorb mit dem Versand aus dem Land des Händlers", async () => {
    const { DEFAULT_SHIP } = await import("../shared/shipping");
    const l = (id: string, rid: number, seller: string, from: string, price = 10): Listing => ({ listingId: id, releaseId: rid, seller, price, condition: "NM", shipsFrom: from });
    const r = optimizeBasket([l("1", 1, "berlin", "Germany"), l("2", 2, "berlin", "Germany"), l("3", 1, "tokyo", "Japan", 8)], {
      shipping: { firstItem: 13, perExtraItem: 2, regions: DEFAULT_SHIP },
    });
    // Beim Händler in Deutschland: 20 € + 5,50 + 1 statt Japan mit 24 € Versand
    expect(r.baskets).toHaveLength(1);
    expect(r.baskets[0].seller).toBe("berlin");
    expect(r.baskets[0].shipping).toBe(6.5);
  });
});
