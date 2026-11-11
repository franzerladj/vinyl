import { describe, expect, it } from "vitest";
import { checkBpm, checkKey, rangeCenter, reconcileTempo, styleRange } from "../shared/bpmCheck";

const JAMI = { styles: ["Acid Jazz", "Soul"], siblings: [] as number[] };

describe("Tempo prüfen", () => {
  it("Jamiroquai: doppeltes Tempo wird zum echten", () => {
    expect(checkBpm(184, JAMI)).toEqual({ bpm: 92, fixed: "halbiert" });
    expect(checkBpm(195, JAMI)).toEqual({ bpm: 97.5, fixed: "halbiert" });
    // 130 lässt sich nicht passend drehen (65 ist zu langsam): unsicher
    expect(checkBpm(130, JAMI)).toEqual({ bpm: 130, unsure: true });
  });
  it("House: halbes Tempo wird verdoppelt, passende Werte bleiben", () => {
    expect(checkBpm(62, { styles: ["Deep House"], siblings: [] })).toEqual({ bpm: 124, fixed: "verdoppelt" });
    expect(checkBpm(124, { styles: ["House"], siblings: [] })).toEqual({ bpm: 124 });
    expect(checkBpm(87, { styles: ["Drum n Bass"], siblings: [] })).toEqual({ bpm: 174, fixed: "verdoppelt" });
    expect(checkBpm(250, { styles: ["House"], siblings: [] }).bpm).toBeNull();
  });
  it("ohne bekannten Style zählen die anderen Tracks", () => {
    expect(checkBpm(61, { styles: [], siblings: [122, 123] }).bpm).toBe(122);
    expect(checkBpm(125, { styles: [], siblings: [124, 62, 125] })).toEqual({ bpm: 125 });
    expect(checkBpm(95, { styles: [], siblings: [124, 125, 124] }).unsure).toBe(true);
  });
  it("Bereich und Mitte aus mehreren Styles", () => {
    expect(styleRange(["Deep House", "Disco"])).toEqual([100, 136]);
    expect(styleRange(["Unbekannt"])).toBeNull();
    expect(rangeCenter(["House"])).toBe(122);
  });
  it("Tonart muss lesbar sein", () => {
    expect(checkKey("Am")).toBe("Am");
    expect(checkKey("8A")).toBe("8A");
    expect(checkKey("unbekannt")).toBeNull();
  });
});

describe("Datenbank und Messung zusammenführen", () => {
  it("stimmen beide (auch über ×2), ist das Tempo sicher", () => {
    const r = reconcileTempo({ db: 184, dbSource: "Deezer (Album)", measured: 92.3, measuredConf: 0.7, ...JAMI });
    expect(r).toMatchObject({ bpm: 92, status: "sicher", source: "Deezer + Messung" });
    expect(reconcileTempo({ db: 124, dbSource: "Deezer", measured: 123.8, measuredConf: 0.4, styles: ["House"], siblings: [] }).status).toBe("sicher");
  });
  it("Widerspruch: unsicher, aber der plausiblere Wert steht drin", () => {
    const r = reconcileTempo({ db: 130, dbSource: "Deezer", measured: 92.1, measuredConf: 0.8, ...JAMI });
    expect(r.status).toBe("unsicher");
    expect(r.bpm).toBe(92.1);
    expect(r.note).toContain("Deezer sagt 130");
  });
  it("eine Quelle: benutzbar, unplausibel oder wackelige Messung: unsicher", () => {
    expect(reconcileTempo({ db: 124, dbSource: "Deezer", styles: ["House"], siblings: [] }).status).toBe("einfach");
    expect(reconcileTempo({ db: 184, dbSource: "Deezer", ...JAMI })).toMatchObject({ bpm: 92, status: "einfach", source: "Deezer (halbiert)" });
    expect(reconcileTempo({ measured: 128, measuredConf: 0.3, styles: ["Techno"], siblings: [] }).status).toBe("unsicher");
    expect(reconcileTempo({ measured: 128, measuredConf: 0.8, styles: ["Techno"], siblings: [] }).status).toBe("einfach");
    expect(reconcileTempo({ styles: [], siblings: [] }).bpm).toBeNull();
  });
});
