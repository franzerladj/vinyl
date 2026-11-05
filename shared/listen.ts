// Mithören über das Mikrofon: reine Logik ohne Browser.
// Die Aufnahme wird alle paar Sekunden neu ausgewertet. Ein Wert gilt erst als sicher,
// wenn er über mehrere Auswertungen gleich bleibt.

export interface Reading {
  bpm: number | null;
  bpmConfidence: number;
  key: string | null;
  keyConfidence: number;
}

export type ReadState = "listening" | "unsure" | "stable";

export interface Summary {
  bpm: number | null;
  bpmState: ReadState;
  key: string | null;
  keyState: ReadState;
}

/** Auf etwa 22 kHz verkleinern (Mittelwert über ganze Faktoren, wirkt zugleich als Tiefpass) */
export function downsample(input: Float32Array, rate: number, target = 22050): { samples: Float32Array; rate: number } {
  const f = Math.max(1, Math.floor(rate / target));
  if (f === 1) return { samples: input, rate };
  const out = new Float32Array(Math.floor(input.length / f));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = 0; j < f; j++) s += input[i * f + j];
    out[i] = s / f;
  }
  return { samples: out, rate: rate / f };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Fasst die bisherigen Auswertungen zusammen. Tempo: die letzten drei liegen innerhalb ±0,6 BPM.
 * Tonart: die letzten drei sind gleich. Vorher zeigen wir den häufigsten Wert als „unsicher“.
 */
export function summarize(readings: Reading[]): Summary {
  const bpms = readings.filter((r) => r.bpm && r.bpmConfidence >= 0.2).map((r) => r.bpm!);
  const keys = readings.filter((r) => r.key && r.keyConfidence > 0).map((r) => r.key!);

  let bpm: number | null = null;
  let bpmState: ReadState = "listening";
  if (bpms.length) {
    const last = bpms.slice(-3);
    const m = median(last);
    bpm = Math.round(m * 10) / 10;
    bpmState = last.length === 3 && last.every((b) => Math.abs(b - m) <= 0.6) ? "stable" : "unsure";
  }

  let key: string | null = null;
  let keyState: ReadState = "listening";
  if (keys.length) {
    const last = keys.slice(-3);
    if (last.length === 3 && last.every((k) => k === last[0])) {
      key = last[0];
      keyState = "stable";
    } else {
      const count = new Map<string, number>();
      for (const k of keys.slice(-5)) count.set(k, (count.get(k) ?? 0) + 1);
      key = [...count].sort((a, b) => b[1] - a[1] || (a[0] === keys.at(-1) ? -1 : 1))[0][0];
      keyState = "unsure";
    }
  }
  return { bpm, bpmState, key, keyState };
}

/** Ab wann sich das Weiterhören nicht mehr lohnt */
export const isDone = (s: Summary) => s.bpmState === "stable" && s.keyState === "stable";
