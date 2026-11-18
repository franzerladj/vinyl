// Tonart aus einer Hörprobe.
//
// Vorgehen: Spektrum in kurzen Fenstern, je Fenster die stärksten Spitzen (Frequenz über Parabel genau
// bestimmt), Stimmung der Aufnahme ausgleichen (Platten laufen selten exakt auf 440 Hz), Spitzen auf die
// zwölf Töne verteilen, getrennt für Bass, Mitten und Höhen. Der Bass trägt in Tanzmusik meist den
// Grundton, deshalb zählt er eigens. Jede der 24 Tonarten bekommt einen Wert aus gelernten Gewichten.
//
// Die Gewichte sind an Tanzmusik gelernt, deren Tonart Menschen bestimmt haben (GiantSteps-Datensätze,
// rund 2000 Stücke von House bis Drum and Bass). Die üblichen Lehrbuch-Profile (Krumhansl) stammen aus
// Hörversuchen mit klassischer Musik und trafen bei 30 s Tanzmusik nur etwa jedes vierte Stück.
// Gemessen (auf einem Datensatz gelernt, auf dem anderen geprüft, 30 s je Stück): 61 % genau,
// 82 % genau oder harmonisch verwandt (Quinte, Paralleltonart, gleichnamig). Die Sicherheit trägt:
// ab 0,5 sind 75 % genau und 91 % mixbar, ab 0,7 sind es 85 % und 95 %.
// Nachmessen: tools/audio/keyeval.ts
import { fft, hann } from "./fft";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Bass, Mitten, Höhen (Hz) */
const BANDS: [number, number][] = [
  [27, 220],
  [220, 880],
  [880, 5000],
];
/** Spitzen je Fenster */
const TOP = 90;
/** Fensterlänge in Sekunden (8192 Werte bei 22050 Hz) */
const WINDOW_S = 8192 / 22050;

// Gelernte Gewichte: je Tonart-Geschlecht 3 Bänder x 12 Töne (Grundton zuerst), dazu ein Grundwert.
// In der App stecken die Gewichte aus beiden Datensätzen zusammen (die Messung oben nutzte nur einen).
const W_MAJOR = [0.5262, -0.005, -0.1357, -0.2105, 0.1597, 0.06, -0.1156, 0.1683, -0.0904, -0.118, -0.1228, -0.1207, 0.9149, -0.6359, 0.2619, -0.3848, 0.7637, -0.2685, -0.513, 0.7351, -0.4818, -0.0832, -0.3453, 0.0277, 0.2689, -0.1493, 0.1766, -0.2265, 0.2133, -0.0641, -0.1289, 0.2585, -0.1512, -0.0016, -0.214, 0.0173];
const W_MINOR = [0.4871, -0.0399, -0.1895, 0.0614, -0.0167, -0.2111, -0.1461, 0.122, -0.0547, -0.2346, -0.0391, -0.0801, 0.7711, -0.5359, 0.1531, 0.2823, 0.0197, -0.2581, -0.3665, 0.9316, -0.373, -0.6585, 0.2445, -0.4934, 0.3114, -0.1088, -0.0017, 0.0246, -0.1292, -0.0106, -0.042, 0.1782, -0.1928, -0.1326, 0.1607, -0.1145];
const B_MAJOR = -0.7919;
const B_MINOR = 0.7919;

export interface KeyResult {
  /** z. B. "Am", "F#" */
  key: string | null;
  /** 0..1: Wahrscheinlichkeit der gewählten Tonart */
  confidence: number;
  /** Abweichung der Stimmung in Halbtönen (−0,5 bis 0,5) */
  tuning: number;
}

export function detectKey(samples: Float32Array, sampleRate: number): KeyResult {
  const none: KeyResult = { key: null, confidence: 0, tuning: 0 };
  const N = 2 ** Math.round(Math.log2(WINDOW_S * sampleRate));
  if (samples.length < N * 4) return none;
  const hop = N / 4;
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(N / 2);
  const binHz = sampleRate / N;
  const lo = Math.ceil(27 / binHz);
  const hi = Math.min(N / 2 - 1, Math.ceil(5000 / binHz));

  // Spitzen aller Fenster: Tonhöhe (MIDI, gebrochen), Gewicht, Band
  const midi: number[] = [];
  const weight: number[] = [];
  const band: number[] = [];
  const pk: number[] = [];
  for (let start = 0; start + N <= samples.length; start += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = lo - 1; k <= hi; k++) mag[k] = Math.hypot(re[k], im[k]);
    pk.length = 0;
    for (let k = lo + 1; k < hi - 1; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) pk.push(k);
    if (!pk.length) continue;
    if (pk.length > TOP) {
      pk.sort((a, b) => mag[b] - mag[a]);
      pk.length = TOP;
    }
    const first = midi.length;
    let frameMax = 0;
    for (const k of pk) {
      const a = mag[k - 1];
      const b = mag[k];
      const c = mag[k + 1];
      const d = (0.5 * (a - c)) / (a - 2 * b + c + 1e-12);
      const freq = (k + d) * binHz;
      const m = b - 0.25 * (a - c) * d;
      const bi = BANDS.findIndex(([f0, f1]) => freq >= f0 && freq < f1);
      if (bi < 0 || !(m > 0)) continue;
      midi.push(69 + 12 * Math.log2(freq / 440));
      weight.push(m);
      band.push(bi);
      if (m > frameMax) frameMax = m;
    }
    // Je Fenster auf die stärkste Spitze beziehen (laute und leise Stellen zählen gleich), Wurzel dämpft die Bassdrum
    for (let i = first; i < midi.length; i++) weight[i] = Math.sqrt(weight[i] / (frameMax + 1e-9));
  }
  if (midi.length < 50) return none;

  // Stimmung: mittlere Abweichung vom Halbton-Raster (als Winkel gemittelt, damit ±0,5 kein Sprung ist)
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < midi.length; i++) {
    const ang = 2 * Math.PI * (midi[i] - Math.round(midi[i]));
    sx += weight[i] * Math.cos(ang);
    sy += weight[i] * Math.sin(ang);
  }
  const tuning = Math.atan2(sy, sx) / (2 * Math.PI);

  const chroma = BANDS.map(() => new Float64Array(12));
  for (let i = 0; i < midi.length; i++) {
    const m = midi[i] - tuning;
    const near = Math.round(m);
    const c = Math.cos(((Math.PI / 2) * (m - near)) / 0.67);
    chroma[band[i]][((near % 12) + 12) % 12] += weight[i] * c * c;
  }
  for (const c of chroma) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += c[i];
    if (sum > 0) for (let i = 0; i < 12; i++) c[i] /= sum;
  }

  // Mittelwert und Streuung über alle 36 Werte (für jede Drehung gleich)
  let mean = 0;
  for (const c of chroma) for (let i = 0; i < 12; i++) mean += c[i];
  mean /= 36;
  let sd = 0;
  for (const c of chroma) for (let i = 0; i < 12; i++) sd += (c[i] - mean) ** 2;
  sd = Math.sqrt(sd / 36) + 1e-9;

  const scores = new Float64Array(24);
  for (let root = 0; root < 12; root++) {
    let major = B_MAJOR;
    let minor = B_MINOR;
    for (let b = 0; b < BANDS.length; b++) {
      for (let i = 0; i < 12; i++) {
        const v = (chroma[b][(i + root) % 12] - mean) / sd;
        major += W_MAJOR[b * 12 + i] * v;
        minor += W_MINOR[b * 12 + i] * v;
      }
    }
    scores[root] = major;
    scores[root + 12] = minor;
  }
  let best = 0;
  for (let i = 1; i < 24; i++) if (scores[i] > scores[best]) best = i;
  let total = 0;
  for (let i = 0; i < 24; i++) total += Math.exp(scores[i] - scores[best]);
  return { key: NOTE_NAMES[best % 12] + (best >= 12 ? "m" : ""), confidence: 1 / total, tuning };
}
