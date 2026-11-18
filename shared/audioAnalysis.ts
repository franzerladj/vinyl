// Audio-Analyse einer Hörprobe, komplett lokal und kostenlos:
// Tempo (Onset-Autokorrelation), Tonart (siehe keyDetect.ts) und Energie
// (Lautheit, Schlagdichte, Klanghelligkeit). Ergebnisse sind Schätzungen.

import { fft, hann } from "./fft";
import { detectKey } from "./keyDetect";


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

export interface AnalysisHints {
  /** Erwartetes Tempo, z. B. aus den Styles der Platte. Hilft bei Halb-/Doppel-/4:3-Verwechslungen. */
  expectedBpm?: number | null;
}

export function analyzeSamples(samples: Float32Array, sampleRate: number, hints: AnalysisHints = {}): AudioAnalysis {
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
  const lowFlux: number[] = [];
  // Bassdrum-Band (bis ca. 180 Hz): trägt den Grundschlag, Hi-Hats verführen sonst zu 4:3 oder doppelt
  const lowBins = Math.max(2, Math.round((180 * N) / sampleRate));
  let prev: Float64Array | null = null;
  let centroidSum = 0;
  let centroidWeight = 0;
  for (let start = 0; start + N <= samples.length; start += hop) {
    const mag = magnitudes(samples, start, N, win, re, im);
    let f = 0;
    let fl = 0;
    let num = 0;
    let den = 0;
    for (let k = 1; k < mag.length; k++) {
      const m = Math.log1p(mag[k] * 10);
      if (prev) {
        const d = Math.max(0, m - prev[k]);
        f += d;
        if (k <= lowBins) fl += d;
      }
      num += k * mag[k];
      den += mag[k];
      mag[k] = m;
    }
    prev = mag;
    flux.push(f);
    lowFlux.push(fl);
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

  // ---------- Tempo ----------
  const { bpm, bpmConfidence } = estimateTempo(flux, lowFlux, fps, hints.expectedBpm ?? null);

  // ---------- Tonart ----------
  const { key, confidence: keyConfidence } = detectKey(samples, sampleRate);

  // ---------- Energie 1..10 ----------
  const e = 0.4 * norm(loudnessDb, -22, -6) + 0.35 * norm(onsetsPerSecond, 2, 9) + 0.25 * norm(brightnessHz, 1200, 4500);
  const energy = Math.max(1, Math.min(10, Math.round(1 + e * 9)));

  return { bpm, bpmConfidence, key, keyConfidence, energy, loudnessDb, brightnessHz, onsetsPerSecond };
}

/** Envelope ohne Gleichanteil, auf Standardabweichung 1 normiert */
function prepEnv(x: number[]) {
  const n = x.length;
  // Gleitenden Mittelwert (ca. 0,5 s) abziehen: entfernt Lautstärkeschwankungen
  const w = 43;
  const out = new Float64Array(n);
  let acc = 0;
  const pre: number[] = [0];
  for (let i = 0; i < n; i++) pre.push((acc += x[i]));
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(n, i + w + 1);
    out[i] = Math.max(0, x[i] - (pre[b] - pre[a]) / (b - a));
  }
  let sq = 0;
  for (let i = 0; i < n; i++) sq += out[i] * out[i];
  const sd = Math.sqrt(sq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

/**
 * Tempo aus Onset-Hüllkurven: Autokorrelation, Kammfilter über vier Schläge
 * (der echte Grundschlag hat bei jedem Vielfachen einen Gipfel), dann Auswahl
 * zwischen verwandten Tempi (½, ¾, 4/3, 2) mit leichter Vorliebe fürs erwartete Tempo.
 */
export function estimateTempo(flux: number[], lowFlux: number[], fps: number, expected: number | null): { bpm: number | null; bpmConfidence: number } {
  if (flux.length < fps * 4) return { bpm: null, bpmConfidence: 0 };
  const full = prepEnv(flux);
  const low = prepEnv(lowFlux);
  const n = full.length;
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = low[i] * 1.2 + full[i];

  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 60) * fps);
  const top = Math.min(n - 1, maxLag * 4 + 2);
  const ac = new Float64Array(top + 1);
  for (let lag = 1; lag <= top; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (n - lag);
  }
  // Wert an gebrochenem Lag (lineare Interpolation)
  const at = (l: number) => {
    if (l < 1 || l >= top) return 0;
    const i = Math.floor(l);
    return ac[i] + (ac[i + 1] - ac[i]) * (l - i);
  };
  // Kleines Fenster, damit leichte Tempo-Ungenauigkeit nicht bestraft wird
  const peak = (l: number) => Math.max(at(l - 1), at(l), at(l + 1));
  const comb = (l: number) => peak(l) + 0.6 * peak(2 * l) + 0.4 * peak(3 * l) + 0.5 * peak(4 * l);
  const center = expected && expected > 50 ? expected : 120;
  const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / center) / (expected ? 0.42 : 0.5)) ** 2);

  let bestLag = minLag;
  let best = -Infinity;
  for (let l = minLag; l <= maxLag; l += 0.25) {
    const v = comb(l) * (0.35 + prior((60 * fps) / l));
    if (v > best) {
      best = v;
      bestLag = l;
    }
  }
  // Verwandte Tempi gegeneinander abwägen
  let lag = bestLag;
  let score = best;
  for (const f of [2, 0.5, 4 / 3, 3 / 4, 3 / 2, 2 / 3]) {
    const l = bestLag * f;
    if (l < minLag || l > maxLag) continue;
    // Feinsuche um den Kandidaten
    for (let d = -1; d <= 1; d += 0.25) {
      const v = comb(l + d) * (0.35 + prior((60 * fps) / (l + d)));
      if (v > score * 1.0001) {
        score = v;
        lag = l + d;
      }
    }
  }
  // Feinjustage auf 1/20 Frame
  let fine = lag;
  let fv = -Infinity;
  for (let l = lag - 0.6; l <= lag + 0.6; l += 0.05) {
    const v = at(l) + 0.5 * at(2 * l) + 0.5 * at(4 * l);
    if (v > fv) {
      fv = v;
      fine = l;
    }
  }
  // Lange Aufnahmen (Mithören): über weit entfernte Schläge (8, 16, 32 Schläge) nachmessen.
  // Je größer der Abstand, desto feiner die Auflösung, ±0,05 BPM statt ±0,2.
  if (n > fps * 15) {
    const cache = new Map<number, number>();
    const acAt = (L: number) => {
      let v = cache.get(L);
      if (v == null) {
        let s = 0;
        for (let i = 0; i + L < n; i++) s += env[i] * env[i + L];
        v = s / (n - L);
        cache.set(L, v);
      }
      return v;
    };
    const atFar = (l: number) => {
      const i = Math.floor(l);
      return acAt(i) + (acAt(i + 1) - acAt(i)) * (l - i);
    };
    for (const k of [8, 16, 32]) {
      if (k * fine > n * 0.6) break;
      // Innerhalb eines halben Frames auf dem k-fachen Lag suchen
      let bestL = fine;
      let bv = -Infinity;
      for (let l = fine - 0.5 / k * 2; l <= fine + 0.5 / k * 2; l += 0.02 / k) {
        const v = atFar(k * l) + 0.5 * atFar((k / 2) * l);
        if (v > bv) {
          bv = v;
          bestL = l;
        }
      }
      fine = bestL;
    }
  }
  const bpm = Math.round(((60 * fps) / fine) * 10) / 10;
  // Sicherheit: Wie deutlich sticht der Kammwert gegenüber allen anderen Lags heraus?
  const vals: number[] = [];
  for (let l = minLag; l <= maxLag; l++) vals.push(comb(l));
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
  const bpmConfidence = clamp01(((comb(fine) - m) / sd - 1) / 2.5);
  return { bpm, bpmConfidence };
}
