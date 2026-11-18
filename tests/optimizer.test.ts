import { describe, expect, it } from "vitest";
import { optimizeBasket, sellerImport, sellerShipping, type Listing, type ShippingModel } from "../shared/optimizer";
import { DEFAULT_SHIP, importCosts } from "../shared/shipping";

const flat: ShippingModel = { firstItem: 5, perExtraItem: 1 };
const L = (seller: string, releaseId: number, price: number, extra: Partial<Listing> = {}): Listing => ({ listingId: `${seller}-${releaseId}-${price}`, seller, releaseId, price, ...extra });

/** Alle Zuordnungen durchprobieren (nur für kleine Fälle) */
function bruteForce(listings: Listing[], model: ShippingModel): number {
  const ids = [...new Set(listings.map((l) => l.releaseId))];
  let best = Infinity;
  const pick: Listing[] = [];
  const walk = (i: number) => {
    if (i === ids.length) {
      const by = new Map<string, Listing[]>();
      for (const l of pick) by.set(l.seller, [...(by.get(l.seller) ?? []), l]);
      let t = 0;
      for (const items of by.values()) t += items.reduce((s, x) => s + x.price, 0) + sellerShipping(items, model) + sellerImport(items, model);
      best = Math.min(best, t);
      return;
    }
    for (const l of listings.filter((x) => x.releaseId === ids[i])) {
      pick.push(l);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}

// Fester Zufall, damit der Test jedes Mal dasselbe prüft
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

describe("Warenkorb-Optimierer", () => {
  it("findet bei kleinen Fällen garantiert die günstigste Kombination", () => {
    const rand = rng(7);
    for (let n = 0; n < 80; n++) {
      const sellers = ["a", "b", "c", "d"].slice(0, 2 + Math.floor(rand() * 3));
      const listings: Listing[] = [];
      for (let id = 1; id <= 3 + Math.floor(rand() * 4); id++) {
        const offering = sellers.filter(() => rand() < 0.6);
        for (const s of offering.length ? offering : [sellers[0]]) listings.push(L(s, id, 3 + Math.round(rand() * 30)));
      }
      const res = optimizeBasket(listings, { shipping: flat });
      expect(res.missing).toEqual([]);
      expect(res.total).toBeCloseTo(bruteForce(listings, flat), 6);
    }
  });

  it("zeigt Stufen: was bringt jeder weitere Händler", () => {
    const listings = [L("a", 1, 10), L("a", 2, 10), L("b", 3, 8), L("c", 4, 30), L("b", 1, 12)];
    const res = optimizeBasket(listings, { shipping: flat });
    expect(res.variants.map((v) => [v.sellers, v.items])).toEqual([[1, 2], [2, 3], [3, 4]]);
    expect(res.variants[0].total).toBe(26); // a: 20 + 5 + 1
    expect(res.variants.at(-1)!.total).toBeCloseTo(res.total, 6);
    // Mit Händler-Grenze gilt die beste Stufe
    const two = optimizeBasket(listings, { shipping: flat, maxSellers: 2 });
    expect([two.itemsCount, two.baskets.length]).toEqual([3, 2]);
  });

  it("rechnet Einfuhrkosten bei Händlern außerhalb der EU ein", () => {
    const model: ShippingModel = { ...flat, regions: DEFAULT_SHIP };
    expect(importCosts(DEFAULT_SHIP, "Germany", 20, 5)).toBe(0);
    expect(importCosts(DEFAULT_SHIP, "Netherlands", 20, 13)).toBe(0);
    expect(importCosts(DEFAULT_SHIP, "United States", 20, 24)).toBeCloseTo(44 * 0.19 + 6, 2);
    expect(importCosts({ ...DEFAULT_SHIP, importTax: null }, "United States", 20, 24)).toBe(0);
    // Der US-Händler ist ohne Abgaben billiger, mit Abgaben gewinnt der aus der EU
    const listings = [L("us", 1, 10, { shipsFrom: "United States" }), L("nl", 1, 22, { shipsFrom: "Netherlands" })];
    const res = optimizeBasket(listings, { shipping: model });
    expect(res.baskets[0].seller).toBe("nl");
    const free = optimizeBasket(listings, { shipping: { ...flat, regions: { ...DEFAULT_SHIP, importTax: null } } });
    expect(free.baskets[0].seller).toBe("us");
    const us = optimizeBasket([listings[0]], { shipping: model });
    expect(us.baskets[0].importCost).toBeCloseTo(34 * 0.19 + 6, 2);
    expect(us.total).toBeCloseTo(10 + 24 + 34 * 0.19 + 6, 2);
  });

  it("nimmt beim selben Händler die bessere Platte, wenn sie höchstens 10 % mehr kostet", () => {
    const res = optimizeBasket([L("a", 1, 20, { condition: "Very Good (VG)" }), L("a", 1, 21, { condition: "Near Mint (NM or M-)" }), L("a", 2, 10, { condition: "Very Good (VG)" }), L("a", 2, 14, { condition: "Mint (M)" })], { shipping: flat });
    const price = (id: number) => res.baskets[0].items.find((i) => i.releaseId === id)!.price;
    expect([price(1), price(2)]).toEqual([21, 10]);
  });
});
