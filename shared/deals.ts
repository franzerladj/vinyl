// Preis-Bewertung für Wants: Ampel (günstig / fair / teuer) und Dringlichkeit.
// Quellen: Discogs-Preisempfehlung je Zustand (aus echten Verkäufen), eigener
// Preisverlauf, Nachfrage (want/have) und Anzahl der Angebote.

export type Ampel = "green" | "yellow" | "red" | "unknown";
export type Urgency = "hot" | "normal" | "relaxed";

export interface DealInput {
  lowest: number | null;
  numForSale: number;
  /** Discogs-Preisempfehlung für VG+ (falls verfügbar) */
  suggestedVgPlus?: number | null;
  /** Bisher beobachtete günstigste Preise (ältester zuerst) */
  history?: number[];
  have?: number;
  want?: number;
  targetPrice?: number | null;
}

export interface Deal {
  ampel: Ampel;
  urgency: Urgency;
  /** Verhältnis günstigster Preis zu Referenzpreis (1 = genau Marktwert) */
  ratio: number | null;
  reference: number | null;
  referenceSource: "Discogs-Empfehlung" | "Preisverlauf" | null;
  underTarget: boolean;
  /** Preisänderung gegenüber dem vorigen Stand (negativ = günstiger) */
  change: number | null;
  reasons: string[];
  /** 0..100, höher = lohnender jetzt zu kaufen */
  score: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

export function evaluateDeal(i: DealInput): Deal {
  const reasons: string[] = [];
  const hist = (i.history ?? []).filter((v) => v > 0);
  let reference: number | null = null;
  let referenceSource: Deal["referenceSource"] = null;
  if (i.suggestedVgPlus && i.suggestedVgPlus > 0) {
    reference = i.suggestedVgPlus;
    referenceSource = "Discogs-Empfehlung";
  } else if (hist.length >= 3) {
    reference = median(hist);
    referenceSource = "Preisverlauf";
  }

  const change = hist.length >= 2 && i.lowest != null ? i.lowest - hist[hist.length - 2] : null;
  let ampel: Ampel = "unknown";
  let ratio: number | null = null;
  if (i.lowest != null && i.numForSale > 0 && reference) {
    ratio = i.lowest / reference;
    ampel = ratio <= 0.85 ? "green" : ratio <= 1.15 ? "yellow" : "red";
    reasons.push(ratio <= 0.85 ? `${Math.round((1 - ratio) * 100)} % unter ${referenceSource === "Preisverlauf" ? "üblichem Preis" : "Marktwert"}` : ratio > 1.15 ? `${Math.round((ratio - 1) * 100)} % über ${referenceSource === "Preisverlauf" ? "üblichem Preis" : "Marktwert"}` : "fairer Preis");
  }
  if (change != null && change < -0.5) reasons.push(`${Math.abs(change).toFixed(2).replace(".", ",")} € günstiger als zuletzt`);

  const underTarget = i.targetPrice != null && i.lowest != null && i.numForSale > 0 && i.lowest <= i.targetPrice;
  if (underTarget) reasons.push("unter deinem Wunschpreis");

  // Dringlichkeit: gefragt und selten = jetzt zuschlagen
  const demand = i.have && i.have > 0 && i.want != null ? i.want / i.have : null;
  let urgency: Urgency = "normal";
  if (i.numForSale > 0 && i.numForSale <= 3 && (demand ?? 0) >= 1.5) {
    urgency = "hot";
    reasons.push(`nur ${i.numForSale} Angebot${i.numForSale > 1 ? "e" : ""}, stark gesucht`);
  } else if (i.numForSale >= 25) {
    urgency = "relaxed";
    reasons.push("viele Angebote, kein Stress");
  }

  let score = 40;
  if (ampel === "green") score += 30;
  if (ampel === "red") score -= 25;
  if (underTarget) score += 20;
  if (urgency === "hot") score += 15;
  if (urgency === "relaxed") score -= 10;
  if (change != null && change < 0) score += 5;
  if (i.numForSale === 0) score = 0;
  return { ampel, urgency, ratio, reference, referenceSource, underTarget, change, reasons, score: Math.max(0, Math.min(100, score)) };
}

/** Budget-Planer: wählt Wants mit dem besten Score, bis das Budget (inkl. Versandschätzung) aufgebraucht ist */
export function planBudget<T extends { id: number; price: number; score: number; stars?: number }>(items: T[], budget: number, shippingPerItem: number) {
  const ranked = [...items].filter((x) => x.price > 0).sort((a, b) => b.score + (b.stars ?? 0) * 5 - (a.score + (a.stars ?? 0) * 5) || a.price - b.price);
  const picked: T[] = [];
  let total = 0;
  for (const x of ranked) {
    const cost = x.price + shippingPerItem;
    if (total + cost <= budget) {
      picked.push(x);
      total += cost;
    }
  }
  return { picked, total };
}
