// Preisanalyse ohne Lesezeichen: Marktstatistik mit Verlauf, Discogs-Preisempfehlung,
// Bewertung (Ampel) und Inventar-Scan der Lieblingshändler über die offizielle API.
import { ApiError, discogs } from "./api";
import { db, getKV, setKV, type MarketStat, type PricePoint, type PriceSuggestion } from "./db";
import { jobUpdate } from "./store";
import { evaluateDeal, type Deal } from "../../../shared/deals";
import type { Listing } from "../../../shared/optimizer";

interface Stats { lowest_price: { value: number; currency: string } | null; num_for_sale: number }
type Suggestions = Record<string, { value: number; currency: string }>;

const GRADE_SHORT: Record<string, string> = {
  "Mint (M)": "M",
  "Near Mint (NM or M-)": "NM",
  "Very Good Plus (VG+)": "VG+",
  "Very Good (VG)": "VG",
  "Good Plus (G+)": "G+",
  "Good (G)": "G",
  "Fair (F)": "F",
  "Poor (P)": "P",
};

/** Ob Discogs dem Nutzer Preisempfehlungen gibt (verlangt ausgefüllte Verkäufer-Einstellungen) */
export const suggestionsState = () => getKV<"ok" | "needs-seller-settings" | "unknown">("suggestionsState", "unknown");

export async function refreshPrices(ids: number[], opts: { maxAgeHours?: number; background?: boolean } = {}) {
  const maxAge = (opts.maxAgeHours ?? 12) * 3600_000;
  const cur = await getKV("currency", "EUR");
  const [stats, sugg] = await Promise.all([db.marketStats.bulkGet(ids), db.priceSuggestions.bulkGet(ids)]);
  let suggState = await suggestionsState();
  const todo = ids.filter((_, i) => !stats[i] || Date.now() - stats[i]!.fetchedAt > maxAge);
  if (!todo.length) return 0;
  const job = "stats";
  jobUpdate(job, { label: "Preise analysieren", done: 0, total: todo.length });
  try {
    let done = 0;
    for (const id of todo) {
      try {
        const s = await discogs<Stats>(`/marketplace/stats/${id}?curr_abbr=${cur}`, { background: opts.background ?? true });
        const stat: MarketStat = { releaseId: id, lowest: s.lowest_price?.value ?? null, currency: s.lowest_price?.currency ?? cur, numForSale: s.num_for_sale ?? 0, fetchedAt: Date.now() };
        await db.marketStats.put(stat);
        const last = await db.priceHistory.where("releaseId").equals(id).last();
        // Verlauf nur speichern, wenn sich etwas geändert hat oder ein Tag vergangen ist
        if (!last || last.lowest !== stat.lowest || last.numForSale !== stat.numForSale || Date.now() - last.at > 24 * 3600_000) {
          await db.priceHistory.add({ releaseId: id, at: stat.fetchedAt, lowest: stat.lowest, numForSale: stat.numForSale });
        }
        const old = sugg[ids.indexOf(id)];
        if (suggState !== "needs-seller-settings" && (!old || Date.now() - old.fetchedAt > 7 * 24 * 3600_000)) {
          try {
            const p = await discogs<Suggestions>(`/marketplace/price_suggestions/${id}`, { background: opts.background ?? true });
            const values: Record<string, number> = {};
            for (const [k, v] of Object.entries(p)) values[GRADE_SHORT[k] ?? k] = Math.round(v.value * 100) / 100;
            await db.priceSuggestions.put({ releaseId: id, values, currency: Object.values(p)[0]?.currency ?? cur, fetchedAt: Date.now() });
            if (suggState !== "ok") await setKV("suggestionsState", (suggState = "ok"));
          } catch (e) {
            if (e instanceof ApiError && /seller settings/i.test(e.message)) await setKV("suggestionsState", (suggState = "needs-seller-settings"));
          }
        }
      } catch (e) {
        console.warn("Preis", id, e);
      }
      jobUpdate(job, { done: ++done });
    }
  } finally {
    jobUpdate(job, null);
  }
  return todo.length;
}

export interface PriceInfo {
  stat?: MarketStat;
  suggestion?: PriceSuggestion;
  history: PricePoint[];
  target?: number | null;
  deal: Deal;
}

/** Alles zur Preisbewertung für mehrere Releases auf einmal laden */
export async function loadPriceInfo(ids: number[]): Promise<Map<number, PriceInfo>> {
  const [stats, suggs, metas, hist, rels] = await Promise.all([
    db.marketStats.bulkGet(ids),
    db.priceSuggestions.bulkGet(ids),
    db.wantMeta.bulkGet(ids),
    db.priceHistory.where("releaseId").anyOf(ids).sortBy("at"),
    db.releases.bulkGet(ids),
  ]);
  const byRel = new Map<number, PricePoint[]>();
  for (const h of hist) byRel.set(h.releaseId, [...(byRel.get(h.releaseId) ?? []), h]);
  const out = new Map<number, PriceInfo>();
  ids.forEach((id, i) => {
    const stat = stats[i];
    const history = byRel.get(id) ?? [];
    const deal = evaluateDeal({
      lowest: stat?.lowest ?? null,
      numForSale: stat?.numForSale ?? 0,
      suggestedVgPlus: suggs[i]?.values["VG+"] ?? null,
      history: history.map((h) => h.lowest ?? 0),
      have: rels[i]?.community?.have,
      want: rels[i]?.community?.want,
      targetPrice: metas[i]?.targetPrice ?? null,
    });
    out.set(id, { stat, suggestion: suggs[i], history, target: metas[i]?.targetPrice ?? null, deal });
  });
  return out;
}

export const setTargetPrice = async (releaseId: number, targetPrice: number | null) => {
  await db.wantMeta.put({ releaseId, targetPrice });
  void import("./push").then((p) => p.syncPushData());
};

// ---------------------------------------------------------------------------
// Lieblingshändler: Inventar über die offizielle API nach Wants durchsuchen
// ---------------------------------------------------------------------------
interface InvPage {
  pagination: { pages: number };
  listings: { id: number; price: { value: number; currency: string }; condition: string; sleeve_condition: string; ships_from: string; seller: { username: string; stats?: { rating?: string } }; release: { id: number; description: string } }[];
}

export async function scanSeller(seller: string, maxPages = 50): Promise<number> {
  const wants = new Set(await db.wants.toCollection().primaryKeys());
  const job = `inv-${seller}`;
  jobUpdate(job, { label: `Inventar ${seller}`, done: 0, total: 1 });
  let found = 0;
  try {
    let page = 1;
    let pages = 1;
    // Erst alle Seiten sammeln, dann in einem Rutsch ersetzen: bricht die Suche ab, bleiben die alten Angebote stehen
    const all: Listing[] = [];
    do {
      const d = await discogs<InvPage>(`/users/${encodeURIComponent(seller)}/inventory?per_page=100&page=${page}&status=For%20Sale`, { background: true });
      pages = Math.min(d.pagination.pages, maxPages);
      for (const l of d.listings)
        if (wants.has(l.release.id))
          all.push({
            listingId: String(l.id),
            releaseId: l.release.id,
            seller: l.seller.username,
            price: l.price.value,
            condition: l.condition,
            sleeveCondition: l.sleeve_condition,
            shipsFrom: l.ships_from,
            sellerRating: l.seller.stats?.rating ? Number(l.seller.stats.rating) : null,
            title: l.release.description,
          });
      jobUpdate(job, { done: page, total: pages });
      page++;
    } while (page <= pages);
    found = all.length;
    const now = Date.now();
    await db.transaction("rw", db.listings, async () => {
      // Groß-/Kleinschreibung des Namens kann abweichen: alle Schreibweisen ersetzen
      const lower = seller.toLowerCase();
      const oldKeys = (await db.listings.toArray()).filter((l) => l.seller.toLowerCase() === lower).map((l) => l.listingId);
      const keep = new Map((await db.listings.bulkGet(oldKeys)).filter(Boolean).map((l) => [l!.listingId, l!.importedAt]));
      await db.listings.bulkDelete(oldKeys);
      // Schon bekannte Angebote behalten ihr altes Datum, damit sie nicht als „neu“ gemeldet werden
      await db.listings.bulkPut(all.map((h) => ({ ...h, importedAt: keep.get(h.listingId) ?? now })));
    });
    const old = await db.sellers.get(seller);
    await db.sellers.put({ name: seller, favorite: old?.favorite ?? true, addedAt: old?.addedAt ?? Date.now(), lastScan: Date.now(), lastHits: found });
  } finally {
    jobUpdate(job, null);
  }
  return found;
}

/** Alle Lieblingshändler prüfen, deren letzter Scan länger als maxAgeHours her ist */
export async function scanFavorites(maxAgeHours = 24) {
  const favs = (await db.sellers.toArray()).filter((s) => s.favorite && (!s.lastScan || Date.now() - s.lastScan > maxAgeHours * 3600_000));
  let total = 0;
  for (const s of favs) {
    try {
      total += await scanSeller(s.name);
    } catch (e) {
      console.warn("Händler", s.name, e);
    }
  }
  return total;
}

export const toggleFavorite = async (name: string) => {
  const s = await db.sellers.get(name);
  await db.sellers.put({ name, favorite: !(s?.favorite ?? false), addedAt: s?.addedAt ?? Date.now(), lastScan: s?.lastScan, lastHits: s?.lastHits });
};
