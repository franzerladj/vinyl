// Suche, die verzeiht: Satzzeichen und Klammern egal, „&“ = „and“, Akzente und ß egal.
// „Love Story [Vs Finally] Layo & Bushwacka!“ findet „Layo And Bushwacka! – Love Story (Vs. Finally)“.

export function normText(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** Suchbegriff in Wörter zerlegen (gleich normalisiert wie der Text) */
export const queryTokens = (q: string) => normText(q).trim().split(" ").filter(Boolean);

/** Alle Wörter der Suche kommen im Text vor (auch als Wortanfang, z. B. „bush“ in „bushwacka“) */
export function matchesQuery(hay: string, q: string | string[]): boolean {
  const tokens = typeof q === "string" ? queryTokens(q) : q;
  if (!tokens.length) return true;
  const h = hay.startsWith(" ") ? hay : normText(hay);
  return tokens.every((t) => h.includes(` ${t}`) || (t.length >= 3 && h.includes(t)));
}

/** Rangfolge: Treffer im Titel und Artist vor Treffern nur in Tracks oder Label */
export function matchScore(primary: string, q: string | string[]): number {
  const tokens = typeof q === "string" ? queryTokens(q) : q;
  const p = normText(primary);
  return tokens.filter((t) => p.includes(` ${t}`)).length / Math.max(1, tokens.length);
}
