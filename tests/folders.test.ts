import { describe, expect, it } from "vitest";
import { cleanFolderName, customFolders, sameFolder, stripFolder, wantFolderOf, withWantFolder } from "../shared/folders";

describe("Ordner", () => {
  it("liest und setzt die Ordner-Marke in der Want-Notiz, ohne die Notiz zu verlieren", () => {
    expect(wantFolderOf(undefined)).toBeNull();
    expect(wantFolderOf("nur im Laden kaufen")).toBeNull();
    const n = withWantFolder("nur im Laden kaufen", "Metal");
    expect(n).toBe("nur im Laden kaufen\n[Ordner: Metal]");
    expect(wantFolderOf(n)).toBe("Metal");
    expect(stripFolder(n)).toBe("nur im Laden kaufen");
    const m = withWantFolder(n, "Punk");
    expect(wantFolderOf(m)).toBe("Punk");
    expect(m.match(/Ordner/g)).toHaveLength(1);
    expect(withWantFolder(m, null)).toBe("nur im Laden kaufen");
    expect(withWantFolder("", "DJ")).toBe("[Ordner: DJ]");
  });
  it("bereinigt Namen und vergleicht ohne Groß- und Kleinschreibung", () => {
    expect(cleanFolderName("  Metal [alt]\n ")).toBe("Metal alt");
    expect(withWantFolder(null, "a]b")).toBe("[Ordner: a b]");
    expect(sameFolder("metal", "Metal ")).toBe(true);
    expect(sameFolder("DJ", null)).toBe(false);
  });
  it("eigene Ordner ohne Alle und Ohne Ordner", () => {
    expect(customFolders([{ id: 0, name: "All", count: 3 }, { id: 1, name: "Uncategorized", count: 1 }, { id: 9, name: "Punk", count: 1 }, { id: 7, name: "DJ", count: 1 }]).map((f) => f.name)).toEqual(["DJ", "Punk"]);
  });
});

import { SLEEVE_GRADES, SLEEVE_HINT } from "../shared/vinyl";
describe("Hüllen-Zustand", () => {
  it("hat für jede Stufe eine eigene Beschreibung ohne Klang-Begriffe", () => {
    for (const [, short] of SLEEVE_GRADES) {
      expect(SLEEVE_HINT[short]).toBeTruthy();
      expect(SLEEVE_HINT[short]).not.toMatch(/gespielt|Knistern|springt|rauscht|spielbar|läuft/i);
    }
  });
});

import { formatPaid, paidOf, parsePaidInput, stripPaid, withPaid } from "../shared/paid";
describe("Kaufpreis in der Notiz", () => {
  it("setzt, liest und entfernt den Kaufpreis, die Notiz bleibt", () => {
    const n = withPaid("Erstpressung, Hülle signiert", 50);
    expect(n).toBe("Erstpressung, Hülle signiert\n[Bezahlt: 50 €]");
    expect(paidOf(n)).toEqual({ value: 50, currency: "EUR" });
    expect(stripPaid(n)).toBe("Erstpressung, Hülle signiert");
    const m = withPaid(n, 49.9);
    expect(paidOf(m)?.value).toBe(49.9);
    expect(m.match(/Bezahlt/g)).toHaveLength(1);
    expect(withPaid(m, null)).toBe("Erstpressung, Hülle signiert");
    expect(withPaid("", 12.5)).toBe("[Bezahlt: 12,5 €]".replace("12,5", "12,50"));
  });
  it("liest Eingaben und Marken mitten in der Notiz", () => {
    expect(parsePaidInput("49,90 €")).toBe(49.9);
    expect(parsePaidInput("")).toBeNull();
    expect(parsePaidInput("abc")).toBeNull();
    expect(paidOf("[Bezahlt: 1.234,50 €]\nvon Hardwax")?.value).toBe(1234.5);
    expect(stripPaid("[Bezahlt: 30 €]\nvon Hardwax")).toBe("von Hardwax");
    expect(formatPaid(30, "USD")).toBe("30 USD");
  });
});
