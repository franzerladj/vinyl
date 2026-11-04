import { regionOf, type ShipConfig } from "./shipping";
// Warenkorb-Optimierer: möglichst viele Wants bei möglichst wenigen Händlern, Versand mitgerechnet.

export interface Listing {
  listingId: string;
  releaseId: number;
  seller: string;
  price: number; // in Zielwährung
  shipping?: number | null; // Versand laut Angebot (falls bekannt), für das erste Item
  condition?: string;
  sleeveCondition?: string;
  sellerRating?: number | null; // Prozent
  shipsFrom?: string;
  title?: string;
}

export interface ShippingModel {
  /** Versand für das erste Item, wenn das Angebot keinen nennt */
  firstItem: number;
  /** Aufschlag je weiterer Platte beim selben Händler */
  perExtraItem: number;
  /** Genauer: Preise nach Herkunft des Händlers (Inland, EU, Welt) */
  regions?: ShipConfig;
}

export interface OptimizeOptions {
  shipping: ShippingModel;
  maxPricePerItem?: number;
  minSellerRating?: number;
  minCondition?: Grade;
  /** Release-IDs, die gekauft werden sollen (Standard: alle in den Listings) */
  wanted?: number[];
  /** Maximale Anzahl Händler im Ergebnis */
  maxSellers?: number;
}

export type Grade = "M" | "NM" | "VG+" | "VG" | "G+" | "G" | "F" | "P";
const GRADE_ORDER: Grade[] = ["P", "F", "G", "G+", "VG", "VG+", "NM", "M"];

export function parseGrade(text: string | undefined): Grade | null {
  if (!text) return null;
  const m = text.match(/\((M|NM or M-|NM|M-|VG\+|VG|G\+|G|F|P)\)/) ?? text.match(/\b(NM|M-|VG\+|VG|G\+|M|G|F|P)\b/);
  if (!m) return null;
  const g = m[1];
  if (g === "M-" || g === "NM or M-") return "NM";
  return g as Grade;
}

export const gradeAtLeast = (g: Grade | null, min: Grade) => (g ? GRADE_ORDER.indexOf(g) >= GRADE_ORDER.indexOf(min) : true);

export interface SellerBasket {
  seller: string;
  items: Listing[];
  itemsTotal: number;
  shipping: number;
  total: number;
}

export interface OptimizeResult {
  baskets: SellerBasket[];
  missing: number[]; // gewünschte Releases ohne passendes Angebot
  total: number;
  itemsCount: number;
  /** Vergleich: jede Platte einzeln beim billigsten Angebot kaufen */
  naiveTotal: number;
}

export function sellerShipping(items: Listing[], model: ShippingModel): number {
  if (items.length === 0) return 0;
  let first = model.firstItem;
  let extra = model.perExtraItem;
  if (model.regions) {
    const r = model.regions.rates[regionOf(items[0].shipsFrom, model.regions.home) ?? "eu"];
    first = r.first;
    extra = r.extra;
  }
  const base = Math.max(...items.map((i) => i.shipping ?? first));
  return base + (items.length - 1) * extra;
}

function filterListings(listings: Listing[], opts: OptimizeOptions): Listing[] {
  const wanted = opts.wanted ? new Set(opts.wanted) : null;
  return listings.filter(
    (l) =>
      (!wanted || wanted.has(l.releaseId)) &&
      (opts.maxPricePerItem == null || l.price <= opts.maxPricePerItem) &&
      (opts.minSellerRating == null || l.sellerRating == null || l.sellerRating >= opts.minSellerRating) &&
      (!opts.minCondition || gradeAtLeast(parseGrade(l.condition), opts.minCondition)),
  );
}

/** Rangliste: welche Händler haben wie viele verschiedene Wants? */
export function rankSellers(listings: Listing[], opts: OptimizeOptions) {
  const by = new Map<string, Map<number, Listing>>();
  for (const l of filterListings(listings, opts)) {
    const m = by.get(l.seller) ?? new Map<number, Listing>();
    const prev = m.get(l.releaseId);
    if (!prev || l.price < prev.price) m.set(l.releaseId, l);
    by.set(l.seller, m);
  }
  return [...by.entries()]
    .map(([seller, m]) => {
      const items = [...m.values()];
      const itemsTotal = items.reduce((s, i) => s + i.price, 0);
      const shipping = sellerShipping(items, opts.shipping);
      return { seller, items, itemsTotal, shipping, total: itemsTotal + shipping, rating: items[0]?.sellerRating ?? null };
    })
    .sort((a, b) => b.items.length - a.items.length || a.total / a.items.length - b.total / b.items.length);
}

function cost(assign: Map<number, Listing>, model: ShippingModel): number {
  const bySeller = new Map<string, Listing[]>();
  for (const l of assign.values()) bySeller.set(l.seller, [...(bySeller.get(l.seller) ?? []), l]);
  let total = 0;
  for (const items of bySeller.values()) total += items.reduce((s, i) => s + i.price, 0) + sellerShipping(items, model);
  return total;
}

/**
 * Heuristik in drei Schritten:
 * 1. Greedy: wiederholt den Händler wählen, der die günstigsten Kosten pro neu abgedeckter Platte hat.
 * 2. Lokale Suche: einzelne Platten zu bereits gewählten Händlern verschieben, wenn es billiger wird.
 * 3. Händler auflösen: kleine Händler entfernen und deren Platten umverteilen, wenn es billiger wird.
 */
export function optimizeBasket(listings: Listing[], opts: OptimizeOptions): OptimizeResult {
  const pool = filterListings(listings, opts);
  const model = opts.shipping;
  const wantedIds = opts.wanted ?? [...new Set(listings.map((l) => l.releaseId))];
  const available = new Set(pool.map((l) => l.releaseId));
  const missing = wantedIds.filter((id) => !available.has(id));

  // günstigstes Angebot je (Händler, Release)
  const offers = new Map<string, Map<number, Listing>>();
  for (const l of pool) {
    const m = offers.get(l.seller) ?? new Map<number, Listing>();
    const prev = m.get(l.releaseId);
    if (!prev || l.price < prev.price) m.set(l.releaseId, l);
    offers.set(l.seller, m);
  }

  // 1. Greedy
  const assign = new Map<number, Listing>();
  const chosen = new Set<string>();
  while (assign.size < available.size) {
    let best: { seller: string; items: Listing[]; ratio: number } | null = null;
    for (const [seller, m] of offers) {
      const already = [...assign.values()].filter((l) => l.seller === seller);
      const newItems = [...m.values()].filter((l) => !assign.has(l.releaseId)).sort((a, b) => a.price - b.price);
      if (newItems.length === 0) continue;
      // bestes Präfix (nicht jedes Angebot muss genommen werden)
      for (let k = 1; k <= newItems.length; k++) {
        const take = newItems.slice(0, k);
        const marginalShip = sellerShipping([...already, ...take], model) - sellerShipping(already, model);
        const ratio = (take.reduce((s, i) => s + i.price, 0) + marginalShip) / k;
        if (!best || ratio < best.ratio - 1e-9) best = { seller, items: take, ratio };
      }
    }
    if (!best) break;
    if (opts.maxSellers && !chosen.has(best.seller) && chosen.size >= opts.maxSellers) break;
    chosen.add(best.seller);
    for (const l of best.items) assign.set(l.releaseId, l);
  }

  // 2. + 3. Lokale Suche
  let current = cost(assign, model);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (const [rid, l] of [...assign]) {
      for (const seller of chosen) {
        if (seller === l.seller) continue;
        const alt = offers.get(seller)?.get(rid);
        if (!alt) continue;
        assign.set(rid, alt);
        const c = cost(assign, model);
        if (c + 1e-9 < current) {
          current = c;
          improved = true;
          break;
        }
        assign.set(rid, l);
      }
    }
    for (const seller of [...chosen]) {
      const mine = [...assign.values()].filter((l) => l.seller === seller);
      if (mine.length === 0) {
        chosen.delete(seller);
        continue;
      }
      const trial = new Map(assign);
      let ok = true;
      for (const l of mine) {
        let bestAlt: Listing | null = null;
        for (const other of chosen) {
          if (other === seller) continue;
          const alt = offers.get(other)?.get(l.releaseId);
          if (alt && (!bestAlt || alt.price < bestAlt.price)) bestAlt = alt;
        }
        if (!bestAlt) {
          ok = false;
          break;
        }
        trial.set(l.releaseId, bestAlt);
      }
      if (ok) {
        const c = cost(trial, model);
        if (c + 1e-9 < current) {
          for (const [k, v] of trial) assign.set(k, v);
          chosen.delete(seller);
          current = c;
          improved = true;
        }
      }
    }
  }

  const bySeller = new Map<string, Listing[]>();
  for (const l of assign.values()) bySeller.set(l.seller, [...(bySeller.get(l.seller) ?? []), l]);
  const baskets = [...bySeller.entries()]
    .map(([seller, items]) => {
      const itemsTotal = items.reduce((s, i) => s + i.price, 0);
      const shipping = sellerShipping(items, model);
      return { seller, items, itemsTotal, shipping, total: itemsTotal + shipping };
    })
    .sort((a, b) => b.items.length - a.items.length);

  // Vergleichswert: jede Platte einzeln beim günstigsten Angebot inkl. Versand
  let naiveTotal = 0;
  for (const rid of available) {
    const cheapest = Math.min(...pool.filter((l) => l.releaseId === rid).map((l) => l.price + sellerShipping([l], model)));
    naiveTotal += cheapest;
  }

  return {
    baskets,
    missing: [...missing, ...[...available].filter((id) => !assign.has(id))],
    total: baskets.reduce((s, b) => s + b.total, 0),
    itemsCount: assign.size,
    naiveTotal,
  };
}
