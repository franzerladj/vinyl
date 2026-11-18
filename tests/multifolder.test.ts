// Mehrere Ordner je Platte: Marken in der Notiz und der echte Discogs-Ordner
import { describe, expect, it } from "vitest";
import { addFolder, filedNames, filedOf, noteFolders, removeFolder, renameIn, stripFolder, wantFolderOf, withFolders, withWantFolder } from "../shared/folders";
import { paidOf, stripPaid, withPaid } from "../shared/paid";

describe("Ordner-Marken in der Notiz", () => {
  it("liest eine und mehrere Marken, auch die alte Schreibweise am Ende", () => {
    expect(noteFolders("Mint, vom Flohmarkt\n[Ordner: Metal]")).toEqual(["Metal"]);
    expect(noteFolders("[Ordner: Auflegen] [Ordner: Sommer]")).toEqual(["Auflegen", "Sommer"]);
    expect(noteFolders("[Ordner: Auflegen]\n[Ordner: auflegen]")).toEqual(["Auflegen"]);
    expect(noteFolders("nur Text")).toEqual([]);
    expect(wantFolderOf("x [Ordner: A] [Ordner: B]")).toBe("A");
    expect(wantFolderOf(null)).toBeNull();
  });
  it("schreibt Marken und lässt den Rest der Notiz stehen", () => {
    expect(withFolders("Mint", ["Auflegen", "Sommer"])).toBe("Mint\n[Ordner: Auflegen] [Ordner: Sommer]");
    expect(withFolders("Mint\n[Ordner: Alt]", ["Neu"])).toBe("Mint\n[Ordner: Neu]");
    expect(withFolders("Mint\n[Ordner: Alt]", [])).toBe("Mint");
    expect(withFolders(null, ["A", "a", " A "])).toBe("[Ordner: A]");
    expect(withWantFolder("x", null)).toBe("x");
    expect(stripFolder("Mint\n[Ordner: A] [Ordner: B]")).toBe("Mint");
  });
  it("verträgt sich mit dem Kaufpreis in derselben Notiz", () => {
    const note = withFolders(withPaid("Mint", 50), ["Auflegen", "Sommer"]);
    expect(note).toBe("Mint\n[Bezahlt: 50 €]\n[Ordner: Auflegen] [Ordner: Sommer]");
    expect(paidOf(note)?.value).toBe(50);
    expect(noteFolders(withPaid(note, 60))).toEqual(["Auflegen", "Sommer"]);
    expect(paidOf(withFolders(note, []))?.value).toBe(50);
    expect(stripFolder(stripPaid(note))).toBe("Mint");
  });
});

describe("Exemplar in mehreren Ordnern", () => {
  it("der erste Ordner wird der echte Discogs-Ordner, weitere kommen in die Notiz", () => {
    let f = filedOf(null, "");
    f = addFolder(f, "Auflegen");
    expect(f).toEqual({ primary: "Auflegen", extra: [] });
    f = addFolder(f, "Sommer");
    f = addFolder(f, "sommer");
    expect(f).toEqual({ primary: "Auflegen", extra: ["Sommer"] });
    expect(filedNames(f)).toEqual(["Auflegen", "Sommer"]);
  });
  it("beim Rausnehmen rückt der nächste nach", () => {
    const f = { primary: "Auflegen", extra: ["Sommer", "Hören"] };
    expect(removeFolder(f, "auflegen")).toEqual({ primary: "Sommer", extra: ["Hören"] });
    expect(removeFolder(f, "Sommer")).toEqual({ primary: "Auflegen", extra: ["Hören"] });
    expect(removeFolder({ primary: "A", extra: [] }, "A")).toEqual({ primary: null, extra: [] });
    expect(removeFolder(f, "gibt es nicht")).toEqual(f);
  });
  it("Marke, die den echten Ordner wiederholt, zählt nicht doppelt", () => {
    expect(filedNames(filedOf("Auflegen", "[Ordner: Auflegen] [Ordner: Sommer]"))).toEqual(["Auflegen", "Sommer"]);
  });
  it("Umbenennen trifft beide Stellen", () => {
    expect(renameIn({ primary: "A", extra: ["B"] }, "b", "C")).toEqual({ primary: "A", extra: ["C"] });
    expect(renameIn({ primary: "A", extra: ["B"] }, "A", "Z")).toEqual({ primary: "Z", extra: ["B"] });
  });
});
