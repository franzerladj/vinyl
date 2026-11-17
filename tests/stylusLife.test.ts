import { describe, expect, it } from "vitest";
import { stylusLife } from "../shared/stylusLife";

describe("Lebensdauer der Nadel laut Hersteller", () => {
  it("Ortofon", () => {
    for (const n of ["Ortofon Concorde Nightclub", "Concorde MkII Club", "Ortofon OM Pro S", "Ortofon 2M Red"]) expect(stylusLife(n)?.hours).toBe(1000);
  });
  it("Audio-Technica nach Schliff", () => {
    expect(stylusLife("Audio-Technica AT-XP5")?.hours).toBe(300);
    expect(stylusLife("Audio-Technica AT-XP3")?.hours).toBe(500);
    expect(stylusLife("AT-VM95ML")?.hours).toBe(1000);
    expect(stylusLife("Audio-Technica VM95SH")?.hours).toBe(800);
    expect(stylusLife("AT-VM95C")?.hours).toBe(500);
  });
  it("Shure vorsichtig", () => expect(stylusLife("Shure M44-7")?.hours).toBe(500));
  it("Unbekanntes bleibt leer", () => {
    expect(stylusLife("Stanton 680 HP")).toBeNull();
    expect(stylusLife("")).toBeNull();
  });
});
