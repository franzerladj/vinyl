import { describe, expect, it } from "vitest";
import { matchesQuery, normText } from "../shared/textSearch";

describe("Verzeihende Suche", () => {
  const hay = "Layo And Bushwacka! Love Story (Vs. Finally) XL Recordings XLT 145";
  it("ignoriert Klammern, Satzzeichen und &/and", () => {
    expect(matchesQuery(hay, "Love Story [Vs Finally] Layo & Bushwacka!")).toBe(true);
    expect(matchesQuery(hay, "layo and bushwacka love story")).toBe(true);
    expect(matchesQuery(hay, "bushwack lov")).toBe(true);
    expect(matchesQuery(hay, "xlt145")).toBe(false);
    expect(matchesQuery(hay, "xlt 145")).toBe(true);
  });
  it("verlangt alle Wörter", () => {
    expect(matchesQuery(hay, "love story moodymann")).toBe(false);
  });
  it("normalisiert Akzente und ß", () => {
    expect(normText("Pépé Bradock – Straße")).toBe(" pepe bradock strasse ");
  });
});
