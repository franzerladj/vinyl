import { describe, expect, it } from "vitest";
import { detectKey } from "../shared/keyDetect";

const SR = 22050;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Einfaches Stück: Bass auf dem Grundton, Akkorde darüber, jeder Ton mit ein paar Obertönen */
function piece(chords: number[][], opts: { seconds?: number; detune?: number } = {}) {
  const n = Math.round((opts.seconds ?? 20) * SR);
  const out = new Float32Array(n);
  const beat = SR / 2;
  const cents = opts.detune ?? 0;
  for (let i = 0; i < n; i++) {
    const chord = chords[Math.floor(i / (beat * 4)) % chords.length];
    const t = i / SR;
    const env = Math.exp(-3 * ((i % beat) / beat));
    let v = 0;
    const tone = (midi: number, amp: number) => {
      const f = hz(midi + cents / 100);
      v += amp * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t));
    };
    tone(chord[0] - 24, 0.5);
    for (const m of chord) tone(m, 0.18 * env + 0.05);
    out[i] = v * 0.4;
  }
  return out;
}

describe("Tonart aus der Hörprobe", () => {
  it("erkennt a-Moll (Am, F, C, G)", () => {
    const r = detectKey(piece([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [57, 60, 64]]), SR);
    expect(r.key).toBe("Am");
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it("erkennt C-Dur (C, F, G, C)", () => {
    const r = detectKey(piece([[60, 64, 67], [53, 57, 60], [55, 59, 62], [60, 64, 67]]), SR);
    expect(r.key).toBe("C");
  });

  it("erkennt f-Moll auf einem einzigen Akkord (wie in vielen House-Platten)", () => {
    const r = detectKey(piece([[53, 56, 60, 63]]), SR);
    expect(r.key).toBe("Fm");
  });

  it("gleicht eine verstimmte Aufnahme aus (Platte läuft 30 Cent zu hoch)", () => {
    const r = detectKey(piece([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [57, 60, 64]], { detune: 30 }), SR);
    expect(r.key).toBe("Am");
    expect(r.tuning).toBeGreaterThan(0.2);
    expect(r.tuning).toBeLessThan(0.4);
  });

  it("kommt mit anderer Abtastrate zurecht", () => {
    const at22 = piece([[53, 56, 60, 63]], { seconds: 12 });
    const at11 = new Float32Array(Math.floor(at22.length / 2));
    for (let i = 0; i < at11.length; i++) at11[i] = (at22[2 * i] + at22[2 * i + 1]) / 2;
    expect(detectKey(at11, SR / 2).key).toBe("Fm");
  });

  it("sagt bei Stille oder zu kurzem Material nichts", () => {
    expect(detectKey(new Float32Array(SR * 5), SR).key).toBeNull();
    expect(detectKey(new Float32Array(1000), SR).key).toBeNull();
  });
});
