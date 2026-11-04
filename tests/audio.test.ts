import { describe, expect, it } from "vitest";
import { analyzeSamples } from "../shared/audioAnalysis";

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
