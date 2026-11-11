import { describe, expect, it } from "vitest";
import { splitVersion } from "../shared/trackTitle";

describe("Version im Tracktitel", () => {
  it("trennt Klammern am Ende ab", () => {
    expect(splitVersion("Keep Pushin' (Grant's Bouncing Dub Mix)")).toEqual({ main: "Keep Pushin'", version: "(Grant's Bouncing Dub Mix)" });
    expect(splitVersion("Do You Know Where You're Coming From (Original Mix)").version).toBe("(Original Mix)");
    expect(splitVersion("Track (Remix) [Edit]")).toEqual({ main: "Track", version: "(Remix) [Edit]" });
  });
  it("lässt Titel ohne Klammer am Ende in Ruhe", () => {
    expect(splitVersion("Bullet")).toEqual({ main: "Bullet", version: null });
    expect(splitVersion("A (feat. B) Dub")).toEqual({ main: "A (feat. B) Dub", version: null });
    expect(splitVersion("(Intro)")).toEqual({ main: "(Intro)", version: null });
  });
});
