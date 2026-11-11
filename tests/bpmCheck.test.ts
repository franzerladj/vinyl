import { describe, expect, it } from "vitest";
import { checkBpm, checkKey } from "../shared/bpmCheck";

describe("Tempo aus Datenbanken prüfen", () => {
  it("dreht halbes Tempo bei House auf das echte", () => {
    expect(checkBpm(62, { styles: ["Deep House"], siblings: [] })).toEqual({ bpm: 124, fixed: "verdoppelt" });
    expect(checkBpm(250, { styles: ["House"], siblings: [] }).bpm).toBeNull();
    expect(checkBpm(256, { styles: ["Techno"], siblings: [] }).bpm).toBeNull();
    expect(checkBpm(170, { styles: ["Deep House"], siblings: [] }).bpm).toBe(170); // halbiert wäre 85, passt auch nicht
  });
  it("lässt passende und ungewöhnliche, aber mögliche Werte stehen", () => {
    expect(checkBpm(124, { styles: ["House"], siblings: [] })).toEqual({ bpm: 124 });
    expect(checkBpm(98, { styles: ["Downtempo"], siblings: [] })).toEqual({ bpm: 98 });
    expect(checkBpm(174, { styles: ["Drum n Bass"], siblings: [] })).toEqual({ bpm: 174 });
    expect(checkBpm(87, { styles: ["Drum n Bass"], siblings: [] })).toEqual({ bpm: 174, fixed: "verdoppelt" });
    expect(checkBpm(123.456, { styles: [], siblings: [] })).toEqual({ bpm: 123.5 });
  });
  it("die anderen Tracks der Platte zählen mehr als der Style", () => {
    expect(checkBpm(61, { styles: ["Techno"], siblings: [122, 123] }).bpm).toBe(122);
    // passt auch gedreht nicht zu den anderen Tracks: lieber selbst messen
    expect(checkBpm(95, { styles: ["House"], siblings: [124, 125, 124] })).toEqual({ bpm: null, rejected: true });
    // ein Ausreißer unter den anderen Tracks verschiebt die Erwartung nicht
    expect(checkBpm(125, { styles: [], siblings: [124, 62, 125] }).bpm).toBe(125);
  });
  it("Tonart muss lesbar sein", () => {
    expect(checkKey("Am")).toBe("Am");
    expect(checkKey("8A")).toBe("8A");
    expect(checkKey("unbekannt")).toBeNull();
    expect(checkKey("")).toBeNull();
  });
});
