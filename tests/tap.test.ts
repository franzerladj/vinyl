import { describe, expect, it } from "vitest";
import { estimateTapTempo } from "../shared/tap";

// Tipps mit menschlicher Ungenauigkeit (± jitter ms), reproduzierbar
const taps = (bpm: number, n: number, jitter = 25, seed = 1) => {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Array.from({ length: n }, (_, i) => 1000 + (i * 60000) / bpm + rnd() * jitter);
};

describe("Tap-Tempo", () => {
  it("trifft das Tempo trotz Wackeln auf ±0,5 BPM", () => {
    for (const bpm of [92, 120, 124, 174]) {
      const r = estimateTapTempo(taps(bpm, 16))!;
      expect(Math.abs(r.bpm - bpm)).toBeLessThan(0.5);
    }
  });
  it("wird mit mehr Tipps genauer", () => {
    const few = estimateTapTempo(taps(123, 6))!;
    const many = estimateTapTempo(taps(123, 24))!;
    expect(many.error).toBeLessThan(few.error);
  });
  it("zählt verpasste Schläge mit und ignoriert Doppeltipper", () => {
    const t = taps(120, 16, 10);
    const missed = t.filter((_, i) => i !== 5 && i !== 11);
    const doubled = [...t.slice(0, 8), t[7] + 40, ...t.slice(8)];
    expect(Math.abs(estimateTapTempo(missed)!.bpm - 120)).toBeLessThan(0.5);
    expect(Math.abs(estimateTapTempo(doubled)!.bpm - 120)).toBeLessThan(0.5);
  });
  it("braucht mindestens drei Tipps", () => {
    expect(estimateTapTempo([0, 500])).toBeNull();
  });
  it("pendelt sich bei langem Tippen ein und meldet kein Abdriften", () => {
    const r = estimateTapTempo(taps(124, 48, 30, 7))!;
    expect(Math.abs(r.bpm - 124)).toBeLessThan(0.2);
    expect(r.drift).toBe(0);
  });
  it("erkennt, wenn man langsamer wird", () => {
    // von 124 auf 119 BPM abgerutscht
    const t: number[] = [];
    let at = 1000;
    for (let i = 0; i < 32; i++) {
      t.push(at);
      at += 60000 / (124 - (i * 5) / 31);
    }
    expect(estimateTapTempo(t)!.drift).toBe(-1);
  });
});
