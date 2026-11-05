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
