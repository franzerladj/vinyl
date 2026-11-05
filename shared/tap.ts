// Tap-Tempo: genauer als der Mittelwert der Abstände.
// Jeder Tipp bekommt eine Schlagnummer, dann wird eine Gerade durch (Nummer, Zeit) gelegt.
// Die Steigung ist die Schlaglänge. Verpasste Schläge (Lücke ≈ 2 Schläge) werden mitgezählt,
// doppelte Tipps (Abstand ≈ halber Schlag) verworfen. Der Fehler der Steigung ergibt die Genauigkeit.

export interface TapResult {
  bpm: number;
  /** ± BPM (Standardfehler) */
  error: number;
  /** Anzahl genutzter Tipps */
  taps: number;
  /** Tempo der letzten Tipps weicht vom Rest ab: man wird langsamer (-1) oder schneller (+1) */
  drift: -1 | 0 | 1;
}

/** Gerade durch (Schlag, Zeit): Schlaglänge und ihr Standardfehler */
function fit(pts: [number, number][]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const period = sxy / sxx;
  const a = my - period * mx;
  let sse = 0;
  for (const [x, y] of pts) sse += (y - (a + period * x)) ** 2;
  return { period, se: n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : period };
}

export function estimateTapTempo(times: number[]): TapResult | null {
  if (times.length < 3) return null;
  const iv = times.slice(1).map((t, i) => t - times[i]);
  const sorted = [...iv].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return null;
  // Schlagnummern vergeben
  const pts: [number, number][] = [[0, times[0]]];
  let beat = 0;
  let lastT = times[0];
  for (let i = 1; i < times.length; i++) {
    const r = (times[i] - lastT) / median;
    if (r < 0.6) continue; // doppelt getippt
    const steps = Math.round(r);
    if (steps > 3 || Math.abs(r - steps) > 0.3) {
      // Neu angesetzt oder völlig aus dem Takt: ab hier neu zählen wäre falsch, also überspringen
      lastT = times[i];
      beat += Math.max(1, steps);
      continue;
    }
    beat += steps;
    lastT = times[i];
    pts.push([beat, times[i]]);
  }
  if (pts.length < 3) return null;
  // Lineare Regression Zeit = a + Schlag · Periode
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  if (!sxx) return null;
  const period = sxy / sxx;
  const a = my - period * mx;
  let sse = 0;
  for (const [x, y] of pts) sse += (y - (a + period * x)) ** 2;
  const sePeriod = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : period;
  const bpm = 60000 / period;
  const error = (bpm * sePeriod) / period;
  // Abdriften erkennen: erste gegen zweite Hälfte. Nur melden, wenn der Unterschied mindestens
  // 1 BPM beträgt und deutlich (3 Standardfehler) über dem normalen Wackeln liegt.
  let drift: TapResult["drift"] = 0;
  if (n >= 20) {
    const h = Math.floor(n / 2);
    const f1 = fit(pts.slice(0, h));
    const f2 = fit(pts.slice(h));
    const b1 = 60000 / f1.period;
    const b2 = 60000 / f2.period;
    const se = Math.hypot((b1 * f1.se) / f1.period, (b2 * f2.se) / f2.period);
    const d = b2 - b1;
    if (Math.abs(d) >= 1 && Math.abs(d) > 3 * se) drift = d < 0 ? -1 : 1;
  }
  return { bpm, error, taps: n, drift };
}
