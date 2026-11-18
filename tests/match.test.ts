import { describe, expect, it } from "vitest";
import { matchScore, matchVideo, parseDuration, artistSimilarity, searchTitles } from "../shared/match";

const videos = [
  { uri: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "Phat 'N' Phunky - Carwash (Phat 'N' Phunky Super Deelux Mix)", duration: 432 },
  { uri: "https://www.youtube.com/watch?v=bbbbbbbbbbb", title: "Phat N Phunky – Carwash (Red Hand Gang Mix) [1998]", duration: 390 },
  { uri: "https://www.youtube.com/watch?v=ccccccccccc", title: "Phat 'N' Phunky - Carwash (7\" Edit)", duration: 225 },
];

describe("match", () => {
  it("unterscheidet Mixe", () => {
    expect(matchVideo({ title: "Carwash (Red Hand Gang Mix)", artist: "Phat 'N' Phunky" }, videos)?.uri).toContain("bbbb");
    expect(matchVideo({ title: "Carwash (Phat 'N' Phunky Super Deelux Mix)", artist: "Phat 'N' Phunky" }, videos)?.uri).toContain("aaaa");
    expect(matchVideo({ title: "Carwash (Phat 'N' Phunky 7\" Edit)", artist: "Phat 'N' Phunky", duration: 225 }, videos)?.uri).toContain("cccc");
  });
  it("lehnt unpassende Videos ab", () => {
    expect(matchVideo({ title: "Shiny Disco Balls" }, videos)).toBeNull();
  });
  it("wertet falsche Länge ab", () => {
    const right = matchScore({ title: "Riding", duration: 362 }, "Moodymann - Riding", 360);
    const wrong = matchScore({ title: "Riding", duration: 362 }, "Moodymann - Riding", 180);
    expect(right).toBeGreaterThan(wrong);
    expect(parseDuration("6:02")).toBe(362);
  });
});

describe("Artist-Prüfung und Suchtitel", () => {
  it("wertet fremden Artist mit gleichem Titel stark ab", () => {
    const right = matchScore({ title: "Opener", artist: "Can" }, "Opener", null, "Can");
    const wrong = matchScore({ title: "Opener", artist: "Can" }, "Can Opener", null, "Great Grandpa");
    expect(right).toBeGreaterThan(0.6);
    expect(wrong).toBeLessThan(0.5);
  });
  it("erkennt Artist-Varianten", () => {
    expect(artistSimilarity("Roy Ayers Ubiquity", "Roy Ayers")).toBeGreaterThanOrEqual(0.5);
    expect(artistSimilarity("Ogawa & Tokoro", "Ogawa and Tokoro")).toBe(1);
  });
  it("prüft bei Compilations keinen Artist", () => {
    expect(matchScore({ title: "Spoon", artist: "Various" }, "Spoon", null, "Can")).toBeGreaterThan(0.6);
  });
  it("bereinigt Suchtitel", () => {
    expect(searchTitles("Planetary Exploration 惑星探査")).toContain("Planetary Exploration");
    expect(searchTitles("Timeloop (Remixes)")).toContain("Timeloop");
    expect(searchTitles("Black Moon EP").at(-1)).toBe("Black Moon");
  });
});

describe("Zuordnung für Hörproben (strictMix)", () => {
  const strict = { strictMix: true };
  it("nimmt das Original nicht als Treffer für einen Remix", () => {
    expect(matchScore({ title: "In The Beginning (DJ Astrid Remix)", artist: "2 Souls & Astrid" }, "In the Beginning", null, "2 Souls", strict)).toBeLessThan(0.55);
    expect(matchScore({ title: "Turn Me Out (Dylan Rhymes Remix)", artist: "Meat Katie & Christian J" }, "Turn Me Out (Dylan Rhymes Remix)", null, "Meat Katie", strict)).toBeGreaterThan(0.8);
  });

  it("lässt sich vom Wort „Mix“ nicht täuschen", () => {
    expect(matchScore({ title: "Flashback (Video Mix)", artist: "Laurent Garnier" }, "Flashback (Laboratoire Mix)", null, "Laurent Garnier", strict)).toBeLessThan(0.55);
    expect(matchScore({ title: "Indigo (Alectric Mix)", artist: "Neurotron & Alectric" }, "Indigo (Alectric Remix)", null, "Neurotron", strict)).toBeGreaterThan(0.7);
  });

  it("behandelt Original, Extended und Radio Edit als dieselbe Aufnahme", () => {
    expect(matchScore({ title: "Moss feat. Daniel Agust (Original Mix)", artist: "GusGus" }, "Moss (Radio Edit)", null, "Gusgus ft. Daniel Agust", strict)).toBeGreaterThan(0.7);
    expect(matchScore({ title: "Slow Back (Original Mix)", artist: "Kinder Atom" }, "Slow Back", null, "Kinder Atom", strict)).toBeGreaterThan(0.8);
  });

  it("erkennt Gäste in Klammern und Abkürzungen mit Punkten", () => {
    expect(matchScore({ title: "Mary's Wisdom (Original Mix)", artist: "The Timewriter & Mary Joe" }, "Mary's Wisdom (with Mary Joe)", null, "The Timewriter", strict)).toBeGreaterThan(0.7);
    expect(matchScore({ title: "Hush Now (501 Remix)", artist: "L.A.O.S & 501" }, "Hush Now (501 Remix)", null, "L.A.O.S", strict)).toBeGreaterThan(0.8);
    expect(artistSimilarity("L.A.O.S", "LAOS")).toBe(1);
  });

  it("lehnt einen fremden Artist mit gleichem Titel weiter ab", () => {
    expect(matchScore({ title: "Believe (Original Mix)", artist: "Popstitute" }, "Believe", null, "Cher", strict)).toBeLessThan(0.55);
  });
});
