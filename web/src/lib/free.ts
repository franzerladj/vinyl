// Kostenlose Anreicherung ohne Claude: Texterkennung auf dem Gerät, Vibe-Regeln,
// Last.fm-Tags und Analyse der Deezer-Hörprobe im Browser.
import { retempo, isManualTempo } from "./tempo";
import { rangeCenter } from "../../../shared/bpmCheck";
import { db, type TrackMeta, autoUpdateTrack } from "./db";
import { api, fetchWithTimeout } from "./api";
import { getState, jobUpdate } from "./store";
import { analyzeSamples, type AnalysisHints, type AudioAnalysis } from "../../../shared/audioAnalysis";
import { estimateBpm, estimateVibe } from "../../../shared/vibes";
import { validBarcode } from "../../../shared/barcode";
import { parseDuration } from "../../../shared/match";
import { pool } from "./pool";

// ---------------------------------------------------------------------------
// Texterkennung (Tesseract, läuft im Browser)
// ---------------------------------------------------------------------------
export interface OcrGuess {
  text: string;
  catno: string;
  barcode: string;
  query: string;
}

const NOISE = /^(stereo|mono|side|seite|made in|manufactured|all rights|warning|unauthorized|rpm|33|45|lp|ep|\d+\s?rpm|p\s?\d{4}|c\s?\d{4})$/i;

export function parseOcrText(text: string): OcrGuess {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/[^\p{L}\p{N}\s.&'/+-]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 2 && !NOISE.test(l));
  const barcode = text.split(/\n+/).map((l) => l.replace(/[\s-]/g, "")).map((l) => l.match(/^\d{12,13}$/)?.[0]).find((c) => c && validBarcode(c)) ?? "";
  const catnos = [...text.toUpperCase().matchAll(/\b([A-Z]{1,8}[ .-]?\d{1,5}[A-Z]{0,2}(?:[ .-]?\d{1,3})?)\b/g)]
    .map((m) => m[1])
    .filter((c) => !/^(19|20)\d\d$/.test(c.replace(/\D/g, "")) || /[A-Z]{2}/.test(c))
    .filter((c) => !/^(RPM|SIDE|STEREO|MONO)/.test(c) && /\d/.test(c) && /[A-Z]/.test(c) && c.length <= 14);
  // Die längsten Zeilen mit Buchstaben sind meist Artist und Titel
  const words = lines.filter((l) => /\p{L}{3,}/u.test(l) && !/^\d/.test(l)).sort((a, b) => b.length - a.length);
  return { text, catno: catnos[0] ?? "", barcode, query: words.slice(0, 2).join(" ").slice(0, 80) };
}

export async function ocrImage(dataUrl: string, onProgress?: (p: number) => void): Promise<OcrGuess> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", undefined, {
    logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && onProgress?.(m.progress),
  });
  try {
    const r = await worker.recognize(dataUrl);
    return parseOcrText(r.data.text);
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Hörprobe analysieren
// ---------------------------------------------------------------------------
let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, (r: AudioAnalysis | null) => void>();

/** Rechnet die Analyse in einem Web Worker; ohne Worker-Unterstützung auf dem Hauptthread */
export function analyzeOffThread(samples: Float32Array, sr: number, hints: AnalysisHints = {}): Promise<AudioAnalysis | null> {
  if (!workerBroken && !worker) {
    try {
      worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<{ id: number; result?: AudioAnalysis; error?: string }>) => {
        pending.get(e.data.id)?.(e.data.result ?? null);
        pending.delete(e.data.id);
      };
      worker.onerror = () => {
        workerBroken = true;
        pending.forEach((res) => res(null));
        pending.clear();
      };
    } catch {
      workerBroken = true;
    }
  }
  if (!worker || workerBroken) return Promise.resolve(analyzeSamples(samples, sr, hints));
  const id = ++seq;
  return new Promise((res) => {
    pending.set(id, res);
    worker!.postMessage({ id, samples, sr, hints }, [samples.buffer]);
  });
}

export const previewUrl = (artist: string, title: string, duration?: number | null) =>
  `/api/audio/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}${duration ? `&duration=${duration}` : ""}`;

/** Der Server kommt gerade nicht an die Hörproben (Deezer ausgelastet) */
export class PreviewBusy extends Error {}
/** Bis dahin ruht das Messen, statt Track für Track gegen die Wand zu laufen */
let busyUntil = 0;

export async function analyzePreview(artist: string, title: string, duration?: number | null, deezerId?: number | null, hints: AnalysisHints = {}): Promise<AudioAnalysis | null> {
  // Mit Zeitlimit: eine hängende Hörprobe hielte sonst die ganze Messung an
  const res = await fetchWithTimeout(deezerId ? `/api/audio/preview/${deezerId}` : previewUrl(artist, title, duration), { credentials: "include" }, 30_000);
  // 404 = keine passende Hörprobe (endgültig); andere Fehler = später nochmal versuchen
  if (res.status === 404) return null;
  // 503/429 = Deezer bremst gerade: kein Fehlversuch für diesen Track, die Messung macht eine Pause
  if (res.status === 503 || res.status === 429) throw new PreviewBusy();
  if (!res.ok) throw new Error(`Hörprobe ${res.status}`);
  const buf = await res.arrayBuffer();
  const sr = 22050;
  // OfflineAudioContext dekodiert direkt in der gewünschten Abtastrate
  const ctx = new OfflineAudioContext(1, sr * 31, sr);
  const audio = await ctx.decodeAudioData(buf);
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
  }
  return analyzeOffThread(mono, sr, hints);
}

// ---------------------------------------------------------------------------
// Vibes & Energie gratis ergänzen
// ---------------------------------------------------------------------------
interface TagsResp {
  tags: { name: string; count: number }[];
}

export interface FreeOptions {
  /** Hörprobe laden und analysieren (ca. 0,5 MB je Track) */
  audio: boolean;
  /** Vorhandene, automatisch geschätzte Werte überschreiben */
  refresh?: boolean;
  /** Nur Tempo/Tonart messen, Vibes nicht anfassen (wenn Claude die Vibes macht) */
  measureOnly?: boolean;
}

/** Ab dieser Sicherheit wird eine gemessene Tonart übernommen */
export const KEY_MIN_CONFIDENCE = 0.5;
/** Ab dieser Sicherheit gilt sie als sicher (ohne „?“) */
export const KEY_SURE_CONFIDENCE = 0.7;
export const KEY_SOURCE_SURE = "Analyse (sicher)";
export const KEY_SOURCE_GUESS = "Analyse (Schätzung)";

const rank = (t: TrackMeta) => (t.tempoCheck === "unsicher" ? 0 : t.tempoCheck === "einfach" ? 1 : 2);

/** So lange gilt „keine Hörprobe“, bevor ein Track nochmal gesucht wird */
const NO_PREVIEW_RETRY_MS = 90 * 86_400_000;
const noPreview = (t: TrackMeta) => t.noPreviewAt != null && Date.now() - t.noPreviewAt < NO_PREVIEW_RETRY_MS;

export async function enrichFree(trackIds: string[] | undefined, opts: FreeOptions) {
  const all = trackIds ? ((await db.tracks.bulkGet(trackIds)).filter(Boolean) as TrackMeta[]) : await db.tracks.toArray();
  const collIds = new Set((await db.collection.toArray()).map((c) => c.releaseId));
  // Messen, wenn noch nie gemessen oder (ältere Einträge) nur ohne gespeichertes Mess-Tempo; eigene Tempi nicht.
  // Gibt es zu einem Track keine Hörprobe, ist das gemerkt (noPreviewAt): sonst wurde er bei jedem Öffnen der App
  // erneut gesucht, und das trifft mehr als die Hälfte aller Tracks. Nach einem Vierteljahr darf er nochmal.
  const wantsMeasure = (t: TrackMeta) => opts.audio && (t.analyzeTries ?? 0) < 3 && !noPreview(t) && (!t.analyzedAt || (t.measuredBpm === undefined && !isManualTempo(t)));
  // Deezer hat eben gebremst: diese Runde auslassen (die nächste kommt von selbst), außer man hat es selbst angestoßen
  if (!trackIds && Date.now() < busyUntil) return 0;
  const todo = all
    .filter((t) => (trackIds || collIds.has(t.releaseId)) && (opts.measureOnly ? wantsMeasure(t) : opts.refresh || t.energy == null || wantsMeasure(t)))
    // Unsichere zuerst, dann die mit nur einer Quelle
    .sort((a, b) => rank(a) - rank(b));
  if (!todo.length) return 0;
  const rels = new Map((await db.releases.bulkGet([...new Set(todo.map((t) => t.releaseId))])).filter(Boolean).map((r) => [r!.id, r!]));
  const lastfm = getState().me?.features.lastfm;
  const durationOf = (t: TrackMeta) => parseDuration(rels.get(t.releaseId)?.tracklist?.find((x) => x.position === t.position)?.duration);
  const job = "free-vibes";
  jobUpdate(job, { label: opts.measureOnly ? "Tempo gegenprüfen" : opts.audio ? "Hörproben ausmessen" : "Stimmung und Energie einschätzen", done: 0, total: todo.length });
  let changed = 0;
  try {
    let done = 0;
    // Zwei Tracks gleichzeitig: Download und Analyse überlappen sich
    await pool(todo, 2, async (t) => {
      // Deezer bremst: den Rest dieser Runde stehen lassen, nichts als „keine Hörprobe“ oder Fehlversuch merken
      if (Date.now() < busyUntil) return;
      const patch: Partial<TrackMeta> = {};
      let analysis: AudioAnalysis | null = null;
      if (wantsMeasure(t)) {
        let failed = false;
        try {
          // Erwartung aus dem Style-Bereich, nicht aus Datenbank-Werten: die Messung soll unabhängig gegenprüfen
          const styles = rels.get(t.releaseId)?.styles ?? [];
          const siblings = all.filter((x) => x.releaseId === t.releaseId && x.id !== t.id && x.tempoCheck === "sicher" && x.bpm).map((x) => x.bpm!);
          const expectedBpm = rangeCenter(styles) ?? estimateBpm(styles, siblings);
          analysis = await analyzePreview(t.artist, t.title, durationOf(t), t.deezerId, { expectedBpm });
        } catch (e) {
          if (e instanceof PreviewBusy) {
            busyUntil = Date.now() + 60_000;
            return;
          }
          failed = true;
          console.warn("Analyse", t.id, e);
        }
        if (!failed) patch.analyzedAt = Date.now();
        // Ohne Netz zählt der Versuch nicht: sonst gäbe die App nach drei Funklöchern für immer auf
        else if (navigator.onLine !== false) patch.analyzeTries = (t.analyzeTries ?? 0) + 1;
        // Keine Hörprobe zu diesem Track: merken, nicht bei jedem Start wieder fragen
        if (!failed && !analysis) patch.noPreviewAt = Date.now();
        if (analysis) {
          patch.audioEnergy = analysis.energy;
          // Messung immer merken; welches Tempo gilt, entscheidet retempo() zusammen mit dem Datenbank-Wert
          patch.measuredBpm = analysis.bpm ? Math.round(analysis.bpm * 10) / 10 : null;
          patch.measuredConf = Math.round(analysis.bpmConfidence * 100) / 100;
          // Ab 0,5 stimmen gemessen drei von vier genau und neun von zehn sind mixbar; darunter lieber keine Tonart
          if (!t.key && analysis.key && analysis.keyConfidence >= KEY_MIN_CONFIDENCE) {
            patch.key = analysis.key;
            // Ab 0,7 stimmen gemessen 85 % genau: gilt als sicher. Darunter bleibt es eine Schätzung mit „?“
            patch.keySource = analysis.keyConfidence >= KEY_SURE_CONFIDENCE ? KEY_SOURCE_SURE : KEY_SOURCE_GUESS;
          }
        }
      }
      const manual = t.vibeSource === "manuell";
      // Stimmung nur einschätzen, wenn sie fehlt oder die Messung etwas Neues gebracht hat (und nur dann Last.fm fragen)
      const needVibe = !manual && !opts.measureOnly && (opts.refresh || t.energy == null || analysis != null);
      let tags: TagsResp["tags"] = [];
      if (needVibe && lastfm) {
        try {
          tags = (await api<TagsResp>(`/api/lastfm/tags?artist=${encodeURIComponent(t.artist)}&track=${encodeURIComponent(t.title)}`)).tags;
        } catch {
          /* kein Treffer */
        }
      }
      if (needVibe) {
        const v = estimateVibe({
          styles: rels.get(t.releaseId)?.styles ?? [],
          bpm: patch.bpm ?? t.bpm,
          tags,
          audioEnergy: patch.audioEnergy ?? t.audioEnergy,
        });
        patch.energy = v.energy;
        patch.moods = [...new Set([...v.moods, v.slot])];
        patch.vibeSource = v.sources.join(" + ");
      }
      await autoUpdateTrack(t.id, patch);
      if ("measuredBpm" in patch) await retempo([t.id]);
      changed++;
      jobUpdate(job, { done: ++done });
    });
  } finally {
    jobUpdate(job, null);
  }
  return changed;
}
