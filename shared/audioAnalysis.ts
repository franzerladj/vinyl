// Audio-Analyse einer Hörprobe, komplett lokal und kostenlos:
// Tempo (Onset-Autokorrelation), Tonart (Chroma + Krumhansl-Profile) und Energie
// (Lautheit, Schlagdichte, Klanghelligkeit). Ergebnisse sind Schätzungen.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface AudioAnalysis {
  bpm: number | null;
  bpmConfidence: number; // 0..1
  key: string | null; // z.B. "Am", "F#"
  keyConfidence: number; // 0..1
  energy: number; // 1..10
  loudnessDb: number;
  brightnessHz: number;
  onsetsPerSecond: number;
}

/** In-place-FFT (Radix 2). re/im haben die Länge 2^n. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function hann(n: number) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function magnitudes(samples: Float32Array, start: number, size: number, win: Float64Array, re: Float64Array, im: Float64Array) {
  for (let i = 0; i < size; i++) {
    re[i] = (samples[start + i] ?? 0) * win[i];
    im[i] = 0;
  }
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const norm = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));

function pearson(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

export function estimateKey(chroma: number[]): { key: string | null; confidence: number } {
  const scores: { key: string; r: number }[] = [];
  for (let root = 0; root < 12; root++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - root + 12) % 12]);
    scores.push({ key: NOTE_NAMES[root], r: pearson(chroma, rot(MAJOR)) });
    scores.push({ key: `${NOTE_NAMES[root]}m`, r: pearson(chroma, rot(MINOR)) });
  }
  scores.sort((x, y) => y.r - x.r);
  const [best, second] = scores;
  if (!best || best.r < 0.3) return { key: null, confidence: 0 };
  return { key: best.key, confidence: clamp01((best.r - second.r) * 10) * clamp01((best.r - 0.3) * 2.5) };
}

export function analyzeSamples(samples: Float32Array, sampleRate: number): AudioAnalysis {
  // ---------- Lautheit ----------
  let sq = 0;
  for (let i = 0; i < samples.length; i++) sq += samples[i] * samples[i];
  const rms = Math.sqrt(sq / Math.max(1, samples.length));
  const loudnessDb = 20 * Math.log10(rms || 1e-9);

  // ---------- Onset-Hüllkurve (Spectral Flux) ----------
  const N = 1024;
  const hop = 256;
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const flux: number[] = [];
  let prev: Float64Array | null = null;
  let centroidSum = 0;
  let centroidWeight = 0;
  for (let start = 0; start + N <= samples.length; start += hop) {
    const mag = magnitudes(samples, start, N, win, re, im);
    let f = 0;
    let num = 0;
    let den = 0;
    for (let k = 1; k < mag.length; k++) {
      const m = Math.log1p(mag[k] * 10);
      if (prev) f += Math.max(0, m - prev[k]);
      num += k * mag[k];
      den += mag[k];
      mag[k] = m;
    }
    prev = mag;
    flux.push(f);
    if (den > 0) {
      centroidSum += (num / den) * (sampleRate / N) * den;
      centroidWeight += den;
    }
  }
  const brightnessHz = centroidWeight ? centroidSum / centroidWeight : 0;
  const fps = sampleRate / hop;

  // Mittelwert entfernen
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const env = flux.map((v) => Math.max(0, v - mean));

  // Onsets zählen (lokale Maxima über adaptiver Schwelle)
  let onsets = 0;
  const sd = Math.sqrt(env.reduce((a, b) => a + b * b, 0) / Math.max(1, env.length));
  for (let i = 1; i < env.length - 1; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > sd * 1.2) onsets++;
  const onsetsPerSecond = onsets / Math.max(1, env.length / fps);

  // ---------- Tempo per Autokorrelation ----------
  let bpm: number | null = null;
  let bpmConfidence = 0;
  if (env.length > fps * 4) {
    const minLag = Math.floor((60 / 190) * fps);
    const maxLag = Math.ceil((60 / 70) * fps);
    const ac: number[] = [];
    let zero = 0;
    for (let i = 0; i < env.length; i++) zero += env[i] * env[i];
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
      ac[lag] = s / (env.length - lag);
    }
    // Leichte Vorliebe für typische Club-Tempi (um 120 BPM)
    let bestLag = minLag;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const b = (60 * fps) / lag;
      const w = Math.exp(-0.5 * (Math.log2(b / 120) / 0.9) ** 2);
      // Harmonische Unterstützung: Vielfache des Lags verstärken die Wahl
      const harm = (ac[lag * 2] ?? 0) * 0.5;
      const score = (ac[lag] + harm) * (0.5 + w);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    // Parabolische Verfeinerung
    const y0 = ac[bestLag - 1] ?? ac[bestLag];
    const y1 = ac[bestLag];
    const y2 = ac[bestLag + 1] ?? ac[bestLag];
    const d = y0 - 2 * y1 + y2;
    const offset = d !== 0 ? (0.5 * (y0 - y2)) / d : 0;
    const lag = bestLag + Math.max(-0.5, Math.min(0.5, offset));
    bpm = Math.round(((60 * fps) / lag) * 10) / 10;
    // Wie deutlich sticht der Gipfel heraus? (z-Wert der Autokorrelation)
    const vals = ac.slice(minLag, maxLag + 1).filter((v) => Number.isFinite(v));
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sdv = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    bpmConfidence = clamp01(((y1 - m) / sdv - 1) / 3);
    void zero;
  }

  // ---------- Chroma für die Tonart ----------
  const NK = 8192;
  const winK = hann(NK);
  const reK = new Float64Array(NK);
  const imK = new Float64Array(NK);
  const chroma = new Array(12).fill(0);
  const lo = Math.floor((65 * NK) / sampleRate);
  const hi = Math.min(NK / 2 - 1, Math.ceil((2100 * NK) / sampleRate));
  for (let start = 0; start + NK <= samples.length; start += NK / 2) {
    const mag = magnitudes(samples, start, NK, winK, reK, imK);
    let frameMax = 0;
    for (let k = lo; k <= hi; k++) frameMax = Math.max(frameMax, mag[k]);
    if (frameMax <= 0) continue;
    for (let k = lo; k <= hi; k++) {
      const freq = (k * sampleRate) / NK;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const nearest = Math.round(midi);
      if (Math.abs(midi - nearest) > 0.35) continue; // nur Bins nah an einem Halbton
      chroma[((nearest % 12) + 12) % 12] += Math.log1p((mag[k] / frameMax) * 20);
    }
  }
  const { key, confidence: keyConfidence } = chroma.some((v) => v > 0) ? estimateKey(chroma) : { key: null, confidence: 0 };

  // ---------- Energie 1..10 ----------
  const e = 0.4 * norm(loudnessDb, -22, -6) + 0.35 * norm(onsetsPerSecond, 2, 9) + 0.25 * norm(brightnessHz, 1200, 4500);
  const energy = Math.max(1, Math.min(10, Math.round(1 + e * 9)));

  return { bpm, bpmConfidence, key, keyConfidence, energy, loudnessDb, brightnessHz, onsetsPerSecond };
}
