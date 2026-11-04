import { describe, expect, it } from "vitest";
import { matchScore, matchVideo, parseDuration } from "../shared/match";

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
