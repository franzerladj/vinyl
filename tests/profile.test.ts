import { describe, expect, it } from "vitest";
import { linkText, parseLink, profileEmpty, sanitizeProfile } from "../shared/profile";

describe("Crate-Profil", () => {
  it("erkennt Dienste und kürzt die Anzeige", () => {
    expect(parseLink("soundcloud.com/djfranz")).toEqual({ url: "https://soundcloud.com/djfranz", kind: "soundcloud" });
    expect(parseLink("@djfranz")?.kind).toBe("instagram");
    expect(linkText(parseLink("https://www.instagram.com/djfranz/")!)).toBe("@djfranz");
    expect(linkText(parseLink("feuerpfeil.de")!)).toBe("feuerpfeil.de");
    expect(parseLink("https://ra.co/dj/franz")?.kind).toBe("residentadvisor");
    expect(parseLink("label.bandcamp.com")?.kind).toBe("bandcamp");
  });
  it("lehnt Unsinn und gefährliche Links ab", () => {
    expect(parseLink("javascript:alert(1)")).toBeNull();
    expect(parseLink("nur text")).toBeNull();
    expect(parseLink("https://user:pw@evil.com")).toBeNull();
  });
  it("begrenzt Eingaben", () => {
    const p = sanitizeProfile({ bio: "x".repeat(500), styles: ["House", "House", "Disco", "a", "b", "c", "d", "e"], links: ["a.de", "b.de", "c.de", "d.de", "e.de", "f.de"], spotlight: { id: 5, title: "T", artist: "A", cover: "https://evil.com/x.jpg" } });
    expect(p.bio).toHaveLength(300);
    expect(p.styles).toEqual(["House", "Disco", "a", "b", "c", "d"]);
    expect(p.links).toHaveLength(5);
    expect(p.spotlight?.cover).toBeUndefined();
  });
});

describe("Setup im Profil", () => {
  it("übernimmt nur bekannte Plätze und kürzt", () => {
    const p = sanitizeProfile({ links: [], styles: [], setup: { decks: " 2× Technics SL-1210 MK2 ", mixer: "x".repeat(200), hack: "<b>", carts: "" } as never, plays: "vinyl" });
    expect(p.setup).toEqual({ decks: "2× Technics SL-1210 MK2", mixer: "x".repeat(80) });
    expect(p.plays).toBe("vinyl");
    expect(profileEmpty(p)).toBe(false);
  });
  it("leeres Setup fällt weg, unbekannte Spielweise auch", () => {
    const p = sanitizeProfile({ links: [], styles: [], setup: { decks: "  " }, plays: "cdj" as never });
    expect(p.setup).toBeUndefined();
    expect(p.plays).toBeUndefined();
    expect(profileEmpty(p)).toBe(true);
  });
});
