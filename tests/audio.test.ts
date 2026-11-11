import { describe, expect, it } from "vitest";
import { analyzeSamples } from "../shared/audioAnalysis";

// Fester Zufall: gleiche Testdaten bei jedem Lauf (sonst schwankt das Rauschen der Hi-Hats)
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** Testsignal: A-Moll-Akkord plus Kick-artige Impulse in festem Tempo */
function synth(bpm: number, seconds = 20, sr = 22050, chord = [220, 261.63, 329.63, 110]) {
  const out = new Float32Array(sr * seconds);
  const beat = (60 / bpm) * sr;
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (const f of chord) v += Math.sin((2 * Math.PI * f * i) / sr) * 0.12;
    const t = i % beat;
    if (t < sr * 0.06) v += Math.sin((2 * Math.PI * 60 * t) / sr) * Math.exp(-t / (sr * 0.015)) * 0.8 + (Math.random() - 0.5) * 0.3 * Math.exp(-t / (sr * 0.005));
    out[i] = v;
  }
  return out;
}

describe("audio analysis", () => {
  it("erkennt das Tempo", () => {
    for (const bpm of [118, 124, 132]) {
      const r = analyzeSamples(synth(bpm), 22050);
      expect(Math.abs((r.bpm ?? 0) - bpm)).toBeLessThan(2);
    }
  });
  it("erkennt die Tonart eines Moll-Akkords", () => {
    const r = analyzeSamples(synth(120), 22050);
    expect(["Am", "C"]).toContain(r.key);
  });
  it("liefert Energie im Bereich 1..10", () => {
    const r = analyzeSamples(synth(126), 22050);
    expect(r.energy).toBeGreaterThanOrEqual(1);
    expect(r.energy).toBeLessThanOrEqual(10);
  });
});

describe("Tempo mit Bassdrum und Hi-Hats", () => {
  // Synthetischer House-Beat: Kick auf jedem Schlag, offene Hi-Hat auf den Offbeats, 16tel-Hats leise
  const beat = (bpm: number, sr = 22050, secs = 30) => {
    const s = new Float32Array(sr * secs);
    const beatLen = (60 / bpm) * sr;
    for (let b = 0; b * beatLen < s.length; b++) {
      const k = Math.round(b * beatLen);
      for (let i = 0; i < 2500 && k + i < s.length; i++) s[k + i] += Math.sin((2 * Math.PI * 55 * i) / sr) * Math.exp(-i / 600) * 0.9;
      for (const [off, amp] of [[0.5, 0.5], [0.25, 0.15], [0.75, 0.15]] as const) {
        const h = Math.round((b + off) * beatLen);
        for (let i = 0; i < 400 && h + i < s.length; i++) s[h + i] += (rnd() * 2 - 1) * Math.exp(-i / 80) * amp;
      }
    }
    return s;
  };
  for (const bpm of [96, 120, 124, 135]) {
    it(`erkennt ${bpm} BPM`, () => {
      const r = analyzeSamples(beat(bpm), 22050);
      expect(Math.abs(r.bpm! - bpm)).toBeLessThan(1.5);
    });
  }
  it("nutzt den Style-Hinweis für schnelle Tempi", () => {
    const r = analyzeSamples(beat(172), 22050, { expectedBpm: 170 });
    expect(Math.abs(r.bpm! - 172)).toBeLessThan(2);
  });
});
