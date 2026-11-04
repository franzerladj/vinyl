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
