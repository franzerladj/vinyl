// „Gut zu wissen“: die Karten müssen vollständig, belegt und in sich stimmig sein
import { describe, expect, it } from "vitest";
import { cardsOf, cardText, GUIDE, GUIDE_AREAS, guideCard, nextCard } from "../shared/guide";
import { matchesQuery } from "../shared/textSearch";

describe("Gut zu wissen", () => {
  it("jede Karte hat eine eigene Adresse, einen Bereich und genug Inhalt", () => {
    const slugs = GUIDE.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of GUIDE) {
      expect(c.slug).toMatch(/^[a-z0-9-]+$/);
      expect(GUIDE_AREAS.some((a) => a.id === c.area)).toBe(true);
      expect(c.title.length).toBeGreaterThan(5);
      expect(c.title.length).toBeLessThanOrEqual(46);
      expect(c.lead.length).toBeGreaterThan(20);
      expect(c.lead.length).toBeLessThanOrEqual(190);
      expect(c.todo.length).toBeGreaterThanOrEqual(3);
      expect(c.todo.length).toBeLessThanOrEqual(6);
    }
    // Jeder Bereich hat Karten, Einsteiger stehen vorn
    for (const a of GUIDE_AREAS) expect(cardsOf(a.id).length).toBeGreaterThanOrEqual(3);
    expect(GUIDE_AREAS[0].id).toBe("start");
  });

  it("jeder Ratschlag ist belegt, oder die Karte sagt offen, dass sie aus der Praxis kommt", () => {
    for (const c of GUIDE) {
      if (!c.practice) expect(c.sources.length, c.slug).toBeGreaterThanOrEqual(1);
      for (const s of c.sources) {
        expect(s.url, c.slug).toMatch(/^https:\/\/[a-z0-9.-]+\//);
        expect(s.label.length).toBeGreaterThan(8);
      }
    }
    expect(GUIDE.filter((c) => c.practice).length).toBeLessThanOrEqual(3);
    // Das Auflegen selbst stützt sich auf Digital DJ Tips: jede Karte im Bereich „Mixen“ nennt den Artikel
    for (const c of GUIDE.filter((x) => x.area === "mixen")) expect(c.sources.some((x) => x.url.startsWith("https://www.digitaldjtips.com/")), c.slug).toBe(true);
  });

  it("Verweise zeigen auf Karten und Seiten, die es gibt", () => {
    for (const c of GUIDE) {
      for (const s of c.see ?? []) {
        expect(guideCard(s), `${c.slug} → ${s}`).toBeTruthy();
        expect(s).not.toBe(c.slug);
      }
      for (const m of c.more ?? []) expect(m.to).toMatch(/^\/(sets|collection|settings\/stylus)$/);
    }
    expect(nextCard(GUIDE[0].slug)?.slug).toBe(GUIDE[1].slug);
    expect(nextCard(GUIDE.at(-1)!.slug)).toBeUndefined();
    expect(guideCard("gibt-es-nicht")).toBeUndefined();
  });

  it("Texte halten sich an die Hausregeln: keine Gedankenstriche, keine Werbesprache, kein „KI“", () => {
    const all = [...GUIDE.map(cardText), ...GUIDE_AREAS.map((a) => `${a.title} ${a.sub}`)].join("\n");
    expect(all).not.toMatch(/[—–]/);
    expect(all).not.toMatch(/Game-?Changer|revolution|KI\b|analysier/i);
    // Sätze enden sauber
    for (const c of GUIDE) for (const line of [c.lead, ...c.todo, ...(c.avoid ?? [])]) expect(line, c.slug).toMatch(/[.!?“)]$/);
  });

  it("die Suche findet Karten über Inhalt, nicht nur über den Titel", () => {
    const find = (q: string) => GUIDE.filter((c) => matchesQuery(cardText(c), q)).map((c) => c.slug);
    expect(find("antiskating")).toContain("auflagekraft");
    expect(find("erdungskabel")).toEqual(expect.arrayContaining(["phono-oder-line", "brummen-und-droehnen"]));
    expect(find("gehörschutz")).toContain("gehoer");
    expect(find("camelot")).toContain("harmonisch-mixen");
    expect(find("bassdrum")).toEqual(expect.arrayContaining(["takte-und-phrasen", "bass-tauschen"]));
    expect(find("xyzzy")).toEqual([]);
  });
});
