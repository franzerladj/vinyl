// Mithören: Mikrofon aufnehmen und alle paar Sekunden BPM und Key messen.
// Alles bleibt auf dem Gerät, es wird nichts hochgeladen oder gespeichert.
import type { AnalysisHints } from "../../../shared/audioAnalysis";
import { downsample, isDone, summarize, type Reading, type Summary } from "../../../shared/listen";
import { analyzeOffThread } from "./free";

export interface ListenUpdate {
  seconds: number;
  level: number; // 0..1, für die Pegelanzeige
  summary: Summary;
  done: boolean;
}

export type ListenError = "denied" | "nomic" | "unsupported";

const FIRST = 8; // erste Auswertung nach 8 s
const EVERY = 4; // dann alle 4 s
const WINDOW = 60; // höchstens die letzten 60 s auswerten
const MAX = 90; // nach 90 s automatisch aufhören

export function canListen() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
}

/**
 * Startet das Mithören. Muss direkt aus einem Tippen heraus aufgerufen werden (iOS).
 * Gibt eine Funktion zum Beenden zurück.
 */
export async function startListening(hints: AnalysisHints, onUpdate: (u: ListenUpdate) => void): Promise<() => void> {
  if (!canListen()) throw new Error("unsupported" satisfies ListenError);
  // AudioContext noch in der Tipp-Geste anlegen, sonst bleibt er auf iOS stumm
  const ctx = new AudioContext();
  void ctx.resume();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Sprach-Filter aus: die würden Bass und Dauerklänge (also genau Takt und Tonart) wegrechnen
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  } catch (e) {
    void ctx.close();
    const name = (e as DOMException).name;
    throw new Error((name === "NotAllowedError" || name === "SecurityError" ? "denied" : "nomic") satisfies ListenError);
  }

  const rate = ctx.sampleRate;
  const src = ctx.createMediaStreamSource(stream);
  // ScriptProcessor ist alt, läuft aber überall (auch ältere iPhones) ohne Extra-Datei
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);

  const chunks: Float32Array[] = [];
  let total = 0;
  let level = 0;
  let nextAt = FIRST * rate;
  let busy = false;
  let stopped = false;
  const readings: Reading[] = [];
  let summary: Summary = summarize([]);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    proc.onaudioprocess = null;
    src.disconnect();
    proc.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  const emit = (done = false) => onUpdate({ seconds: total / rate, level, summary, done });

  const analyze = async (final = false) => {
    busy = true;
    // Die letzten WINDOW Sekunden zusammensetzen
    const want = Math.min(total, WINDOW * rate);
    const buf = new Float32Array(want);
    let pos = want;
    for (let i = chunks.length - 1; i >= 0 && pos > 0; i--) {
      const c = chunks[i];
      const take = Math.min(pos, c.length);
      buf.set(c.subarray(c.length - take), pos - take);
      pos -= take;
    }
    const { samples, rate: r } = downsample(buf, rate);
    const res = await analyzeOffThread(samples === buf ? buf.slice() : samples, r, hints);
    busy = false;
    if (!res || (stopped && !final)) return;
    readings.push(res);
    summary = summarize(readings);
    const finished = final || (isDone(summary) && total >= 30 * rate);
    if (finished) stop();
    emit(finished);
  };

  let lastEmit = 0;
  proc.onaudioprocess = (e) => {
    if (stopped) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    total += data.length;
    // Alte Stücke wegwerfen, die nicht mehr ins Fenster fallen
    let kept = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      kept += chunks[i].length;
      if (kept > WINDOW * rate + data.length) {
        chunks.splice(0, i);
        break;
      }
    }
    let sq = 0;
    for (let i = 0; i < data.length; i++) sq += data[i] * data[i];
    const db = 20 * Math.log10(Math.sqrt(sq / data.length) || 1e-9);
    level = level * 0.6 + Math.max(0, Math.min(1, (db + 60) / 50)) * 0.4;
    if (total >= MAX * rate) {
      stop();
      if (!busy) void analyze(true);
      else emit(true);
      return;
    }
    if (total >= nextAt && !busy) {
      nextAt = total + EVERY * rate;
      void analyze();
    }
    const now = performance.now();
    if (now - lastEmit > 120) {
      lastEmit = now;
      emit();
    }
  };

  return stop;
}
