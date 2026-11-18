import { describe, expect, it } from "vitest";
import { etaSeconds, etaText, jobText, overallEta, pauseText } from "../shared/syncText";

const now = 1_000_000;

describe("Abgleich in Klartext", () => {
  it("nennt Dauer grob und ohne falsche Genauigkeit", () => {
    expect(etaText(3)).toBe("gleich fertig");
    expect(etaText(27)).toBe("noch etwa 30 Sek.");
    expect(etaText(200)).toBe("noch etwa 3 Min.");
    expect(etaText(3600 + 22 * 60)).toBe("noch etwa 1 Std. 20 Min.");
    expect(etaText(7200)).toBe("noch etwa 2 Std.");
    expect(etaText(NaN)).toBe("");
  });

  it("beschreibt Tracklists mit Zahl, Einheit und Grund", () => {
    const j = { id: "details-collection", label: "x", done: 120, total: 800, startedAt: now - 150_000 };
    const t = jobText(j, [j], now);
    expect(t.title).toBe("Tracklists deiner Platten laden");
    expect(t.short).toBe("Tracklists");
    expect(t.count).toBe("120 von 800 Platten");
    expect(t.why).toContain("60 pro Minute");
    expect(t.part).toBeCloseTo(0.15);
    // 680 offen bei 50 pro Minute: rund eine Viertelstunde
    expect(t.eta).toMatch(/^noch etwa 1[2-5] Min\.$/);
  });

  it("lässt sich vom schnellen Anfang nicht täuschen", () => {
    // 40 in 10 s geschafft, 400 offen: das Minuten-Limit bestimmt den Rest, nicht das Anfangstempo
    const j = { id: "details-collection", label: "x", done: 40, total: 440, startedAt: now - 10_000 };
    expect(etaSeconds(j, [j], now)!).toBeGreaterThan(400);
  });

  it("teilt das Limit auf alle Discogs-Schritte auf", () => {
    const a = { id: "details-collection", label: "x", done: 40, total: 310, startedAt: now - 10_000 };
    const b = { id: "stats", label: "x", done: 10, total: 210, startedAt: now - 10_000 };
    const alone = etaSeconds(a, [a], now)!;
    const shared = etaSeconds(a, [a, b], now)!;
    expect(shared).toBeGreaterThan(alone * 1.5);
    expect(overallEta([a, b], now)).toMatch(/Min\./);
  });

  it("schätzt Schritte ohne Discogs aus dem bisherigen Tempo", () => {
    const j = { id: "free-vibes", label: "Hörproben ausmessen", done: 10, total: 40, startedAt: now - 60_000 };
    const t = jobText(j, [j], now);
    expect(t.title).toBe("Hörproben ausmessen");
    expect(t.eta).toBe("noch etwa 3 Min.");
  });

  it("zeigt nichts Erfundenes, solange nichts messbar ist", () => {
    const j = { id: "collection", label: "x", done: 0, total: 1, startedAt: now };
    const t = jobText(j, [j], now);
    expect(t.count).toBe("");
    expect(t.eta).toBe("");
  });

  it("benennt Freunde und Händler", () => {
    expect(jobText({ id: "friend-kumpel", label: "Sammlung von kumpel", done: 1, total: 4 }).title).toBe("Sammlung von kumpel ansehen");
    expect(jobText({ id: "inv-plattenladen", label: "x", done: 1, total: 4 }).title).toBe("Angebote bei plattenladen durchsehen");
    expect(jobText({ id: "unbekannt", label: "Irgendwas", done: 0, total: 0 }).title).toBe("Irgendwas");
  });

  it("rechnet die Pause von Discogs in die Restzeit ein", () => {
    // 24 offen, das ginge sofort, aber Discogs macht noch 40 s Pause
    const j = { id: "details-collection", label: "x", done: 21, total: 45, startedAt: now - 12_000 };
    expect(etaSeconds(j, [j], now)!).toBeLessThan(20);
    const paused = etaSeconds(j, [j], now, 40_000)!;
    expect(paused).toBeGreaterThanOrEqual(43);
    expect(paused).toBeLessThan(60);
    expect(jobText(j, [j], now, 40_000).eta).toBe("noch etwa 40 Sek.");
  });

  it("erklärt die Pause", () => {
    expect(pauseText(500)).toBe("");
    expect(pauseText(12_300)).toBe("Discogs lässt 60 Anfragen pro Minute zu. Weiter in 13 Sek.");
  });
});
