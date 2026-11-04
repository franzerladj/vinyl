// Versand schätzen nach Herkunft des Händlers: Inland, EU, Rest der Welt.
// Discogs nennt das Land in „ships_from“ (englische Namen).

export type ShipRegion = "home" | "eu" | "world";
export interface ShipRates {
  /** Versand für die erste Platte */
  first: number;
  /** Aufschlag je weiterer Platte beim selben Händler */
  extra: number;
}
export interface ShipConfig {
  /** Eigenes Land, wie Discogs es schreibt (z. B. "Germany") */
  home: string;
  rates: Record<ShipRegion, ShipRates>;
}

const EU = new Set([
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Czechia", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece",
  "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
]);

/** Typische Preise für eine LP (Stand 2026, Päckchen/Paket mit Sendungsnummer) */
export const DEFAULT_SHIP: ShipConfig = {
  home: "Germany",
  rates: { home: { first: 5.5, extra: 1 }, eu: { first: 13, extra: 2 }, world: { first: 24, extra: 4 } },
};

export const HOME_COUNTRIES: [string, string][] = [
  ["Germany", "Deutschland"], ["Austria", "Österreich"], ["Switzerland", "Schweiz"], ["Netherlands", "Niederlande"], ["Belgium", "Belgien"],
  ["Luxembourg", "Luxemburg"], ["France", "Frankreich"], ["Italy", "Italien"], ["Spain", "Spanien"], ["Poland", "Polen"], ["Czech Republic", "Tschechien"],
  ["Denmark", "Dänemark"], ["Sweden", "Schweden"], ["UK", "Großbritannien"],
];

export const countryName = (c: string) => HOME_COUNTRIES.find(([k]) => k === c)?.[1] ?? c;

export function regionOf(shipsFrom: string | undefined | null, home: string): ShipRegion | null {
  if (!shipsFrom) return null;
  const c = shipsFrom.trim();
  if (c === home || (c === "United Kingdom" && home === "UK")) return "home";
  // Schweiz und UK zählen nicht zur EU: von dort nach Deutschland wie Rest der Welt (Zoll)
  if (EU.has(c) && EU.has(home)) return "eu";
  if (EU.has(c) && !EU.has(home)) return "world";
  return "world";
}

/** Versand für einen Händler mit n Platten */
export function estimateShipping(cfg: ShipConfig, shipsFrom: string | undefined | null, n: number): number {
  const r = cfg.rates[regionOf(shipsFrom, cfg.home) ?? "eu"];
  return n <= 0 ? 0 : r.first + (n - 1) * r.extra;
}
