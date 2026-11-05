import { describe, expect, it } from "vitest";
import { downsample, isDone, summarize, type Reading } from "../shared/listen";
import { analyzeSamples } from "../shared/audioAnalysis";

/** Kick im Tempo plus A-Moll-Akkord, dazu Rauschen wie aus einem Handy-Mikrofon im Raum */
function room(bpm: number, seconds: number, rate = 48000) {
  const n = seconds * rate;
  const out = new Float32Array(n);
  const beat = (60 / bpm) * rate;
  const chord = [220, 261.63, 329.63, 440, 523.25];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const since = (i % beat) / rate;
    // Handy-Mikros dämpfen tiefen Bass: Kick eher bei 120 Hz und mit Klick
    const kick = since < 0.15 ? Math.sin(2 * Math.PI * (120 + 200 * Math.exp(-since * 40)) * since) * Math.exp(-since * 18) : 0;
    let pad = 0;
    for (const f of chord) pad += Math.sin(2 * Math.PI * f * t) / chord.length;
    out[i] = 0.5 * kick + 0.25 * pad + 0.05 * rnd();
  }
  return out;
}

describe("Mithören", () => {
  it("verkleinert 48 kHz auf 24 kHz", () => {
    const { samples, rate } = downsample(new Float32Array([1, 3, 5, 7]), 48000);
    expect(rate).toBe(24000);
    expect([...samples]).toEqual([2, 6]);
  });

  it("findet Tempo und Tonart in einer Raumaufnahme", () => {
    const { samples, rate } = downsample(room(124, 40), 48000);
    const a = analyzeSamples(samples, rate, { expectedBpm: 124 });
    expect(a.bpm).not.toBeNull();
    expect(Math.abs(a.bpm! - 124)).toBeLessThan(1);
    expect(a.key).toBe("Am");
  });

  it("gilt erst als sicher, wenn drei Auswertungen übereinstimmen", () => {
    const r = (bpm: number, key: string): Reading => ({ bpm, bpmConfidence: 0.6, key, keyConfidence: 0.4 });
    expect(summarize([]).bpmState).toBe("listening");
    const two = summarize([r(124.1, "Am"), r(124, "Am")]);
    expect(two.bpmState).toBe("unsure");
    expect(two.key).toBe("Am");
    const three = summarize([r(124.1, "Am"), r(124, "Am"), r(123.9, "Am")]);
    expect(three).toEqual({ bpm: 124, bpmState: "stable", key: "Am", keyState: "stable" });
    expect(isDone(three)).toBe(true);
    const wobble = summarize([r(124, "Am"), r(124, "C"), r(124, "Am")]);
    expect(wobble.keyState).toBe("unsure");
    expect(wobble.key).toBe("Am");
  });

  it("ignoriert unsichere Tempi", () => {
    const s = summarize([{ bpm: 90, bpmConfidence: 0.05, key: null, keyConfidence: 0 }]);
    expect(s.bpm).toBeNull();
  });
});
